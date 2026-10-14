import { test, expect, describe } from "bun:test";
import { HistoryCacheRunner, HistoryBlocks } from "../HistoryCache";
import type {
  HistoryBlock,
  HistoryPage,
  RefreshChange,
  LoadMoreChange,
} from "../HistoryCache";

const HASH_X = "x".repeat(64);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const HASH_G = "g".repeat(64);
const HASH_H = "h".repeat(64);
const HASH_I = "i".repeat(64);
const HASH_J = "j".repeat(64);
const HASH_Y = "y".repeat(64);

const MAX_CURSOR = Number.MAX_SAFE_INTEGER;

// Build a block with a given hash and height. historyId is set to
// height for simplicity.
function block(hash: string, height: number, historyId?: number): HistoryBlock {
    return {
        header: { hash, height },
        body: {},
        confirmations: 10,
        height,
        historyId: historyId ?? height,
    };
}

function page(fromId: number, blocks: HistoryBlock[]): HistoryPage {
    return { fromId, perBlock: blocks };
}

function blockHashes(blocks: readonly HistoryBlock[]): string[] {
    return blocks.map(b => b.header.hash);
}

function kind(change: RefreshChange | LoadMoreChange | null): string {
    if (change === null) return "null";
    return "deleteFrom" in change ? "refresh" : "append";
}

// Apply a refresh change to a consumer-held list. This is the documented
// contract: keep everything strictly below deleteFrom, put newBlocks on top.
function applyRefresh(current: readonly HistoryBlock[], change: RefreshChange): HistoryBlock[] {
    return [...change.newBlocks, ...current.filter(b => b.height < change.deleteFrom)];
}

// A null change means nothing happened, so the list is untouched.
function applyRefreshOrNull(current: readonly HistoryBlock[], change: RefreshChange | null): HistoryBlock[] {
    return change === null ? [...current] : applyRefresh(current, change);
}

describe("HistoryCacheRunner", () => {
    test("first time: stores the page as the cache", async () => {
        const blocks = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8)];
        const fetcher = async (beforeId: number) =>
            page(beforeId === MAX_CURSOR ? 8 : 0, blocks);
        const runner = new HistoryCacheRunner(fetcher);
        const change = await runner.refresh();
        expect(kind(change)).toBe("refresh");
        if (change === null) throw new Error("expected a change");
        // First poll replaces wholesale, so nothing is kept.
        expect(change.deleteFrom).toBe(0);
        expect(blockHashes(change.newBlocks)).toEqual([HASH_X, HASH_A, HASH_B]);
    });

    test("steady state: first poll replaces, repeat poll is a no-op", async () => {
        const blocks = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8)];
        const fetcher = async (beforeId: number) =>
            beforeId === MAX_CURSOR ? page(8, blocks) : page(0, []);
        const runner = new HistoryCacheRunner(fetcher);
        const first = await runner.refresh();
        expect(kind(first)).toBe("refresh");
        let current = applyRefreshOrNull([], first);
        expect(blockHashes(current)).toEqual([HASH_X, HASH_A, HASH_B]);
        // Second poll returns the identical chain. The splice would drop and
        // reinsert the same blocks, so this resolves to null: a poller must
        // not be handed a fork on an idle chain.
        const second = await runner.refresh();
        expect(second).toBeNull();
        current = applyRefreshOrNull(current, second);
        expect(blockHashes(current)).toEqual([HASH_X, HASH_A, HASH_B]);
    });

    test("append: stitch extends below cache's bottom, full stitch kept", async () => {
        // First poll: F is the bottom.
        const initial = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8),
            block(HASH_C, 7), block(HASH_D, 6), block(HASH_E, 5), block(HASH_F, 4)];
        // Second poll: Y is new at the top, G..J are new below F.
        const appended = [block(HASH_Y, 11), block(HASH_X, 10), block(HASH_A, 9),
            block(HASH_B, 8), block(HASH_C, 7), block(HASH_D, 6),
            block(HASH_E, 5), block(HASH_F, 4),
            block(HASH_G, 3), block(HASH_H, 2), block(HASH_I, 1), block(HASH_J, 0)];
        // Sequential fetcher: first call returns initial, second returns
        // appended (which has the join at F).
        let callCount = 0;
        const fetcher = async (_beforeId: number) => {
            callCount++;
            if (callCount === 1) return page(4, initial);
            return page(0, appended);
        };
        const runner = new HistoryCacheRunner(fetcher);
        // First refresh: populate the cache.
        let current = applyRefreshOrNull([], await runner.refresh());
        expect(blockHashes(current)).toEqual([
            HASH_X, HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F,
        ]);
        // Second refresh: the loop fetches the appended page. The stitch's
        // earliest (J, height 0) is below the cache's earliest (F, height
        // 4), so the walked-past check fires and the cache is wholesale-
        // replaced with the full stitch. The full stitch is kept (we don't
        // discard downloaded information).
        const change = await runner.refresh();
        expect(callCount).toBe(2);
        expect(kind(change)).toBe("refresh");
        if (change === null) throw new Error("expected a change");
        // Walked past the bottom, so nothing from the old cache is kept.
        expect(change.deleteFrom).toBe(0);
        current = applyRefresh(current, change);
        expect(blockHashes(current)).toEqual([
            HASH_Y, HASH_X, HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F,
            HASH_G, HASH_H, HASH_I, HASH_J,
        ]);
    });

    test("reorg: fork reports deleteFrom and only the replaced top", async () => {
        // First poll: old chain [X, A, B, C, D, E, F].
        const old = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8),
            block(HASH_C, 7), block(HASH_D, 6), block(HASH_E, 5), block(HASH_F, 4)];
        // Second poll: entirely new chain [X', A', B', C, D, E, F].
        const HASH_X2 = "x2".repeat(32);
        const HASH_A2 = "a2".repeat(32);
        const HASH_B2 = "b2".repeat(32);
        const reorg = [block(HASH_X2, 10), block(HASH_A2, 9), block(HASH_B2, 8),
            block(HASH_C, 7), block(HASH_D, 6), block(HASH_E, 5), block(HASH_F, 4)];
        // Sequential fetcher: first call returns old, subsequent return reorg.
        let pollCount = 0;
        const fetcher = async (_beforeId: number) => {
            pollCount++;
            if (pollCount === 1) return page(4, old);
            return page(4, reorg);
        };
        const runner = new HistoryCacheRunner(fetcher);
        // First refresh: populate the cache.
        let current = applyRefreshOrNull([], await runner.refresh());
        expect(blockHashes(current)).toEqual([
            HASH_X, HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F,
        ]);
        // Second refresh: the reorg. X', A', B' replace X, A, B; C, D, E, F
        // are unchanged and already cached, so they are trimmed from the
        // payload. deleteFrom is the lowest reorged height (B' at 8), so
        // the consumer keeps C and below and replaces the top.
        const change = await runner.refresh();
        expect(kind(change)).toBe("refresh");
        if (change === null) throw new Error("expected a change");
        expect(change.deleteFrom).toBe(8);
        expect(blockHashes(change.newBlocks)).toEqual([HASH_X2, HASH_A2, HASH_B2]);
        current = applyRefresh(current, change);
        expect(blockHashes(current)).toEqual([
            HASH_X2, HASH_A2, HASH_B2, HASH_C, HASH_D, HASH_E, HASH_F,
        ]);
    });

    test("partial reorg: A, B, C reorged; X, D, E, F unchanged", async () => {
        // First poll: [X, A, B, C, D, E, F].
        const old = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8),
            block(HASH_C, 7), block(HASH_D, 6), block(HASH_E, 5), block(HASH_F, 4)];
        // Second poll: [X, A', B', C', D, E, F]. X, D, E, F unchanged.
        const HASH_A2 = "a2".repeat(32);
        const HASH_B2 = "b2".repeat(32);
        const HASH_C2 = "c2".repeat(32);
        const reorg = [block(HASH_X, 10), block(HASH_A2, 9), block(HASH_B2, 8),
            block(HASH_C2, 7), block(HASH_D, 6), block(HASH_E, 5), block(HASH_F, 4)];
        // Sequential fetcher: first call returns the initial, subsequent
        // calls return the reorg.
        let pollCount = 0;
        const fetcher = async (_beforeId: number) => {
            pollCount++;
            if (pollCount === 1) return page(4, old);
            return page(4, reorg);
        };
        const runner = new HistoryCacheRunner(fetcher);
        // First refresh: populate the cache.
        let current = applyRefreshOrNull([], await runner.refresh());
        expect(blockHashes(current)).toEqual([
            HASH_X, HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F,
        ]);
        // Second refresh: the reorg. A, B, C are replaced; X, D, E, F stay and
        // are trimmed from the payload. deleteFrom is C2's height (7).
        const change = await runner.refresh();
        expect(kind(change)).toBe("refresh");
        if (change === null) throw new Error("expected a change");
        expect(change.deleteFrom).toBe(7);
        expect(blockHashes(change.newBlocks)).toEqual([HASH_X, HASH_A2, HASH_B2, HASH_C2]);
        current = applyRefresh(current, change);
        expect(blockHashes(current)).toEqual([
            HASH_X, HASH_A2, HASH_B2, HASH_C2, HASH_D, HASH_E, HASH_F,
        ]);
    });

    test("loadMore: returns an append carrying only the new entries", async () => {
        const initial = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8)];
        const more = [block(HASH_C, 7), block(HASH_D, 6)];
        const fetcher = async (beforeId: number) => {
            if (beforeId === MAX_CURSOR) return page(8, initial);
            if (beforeId === 8) return page(6, more);
            return page(0, []);
        };
        const runner = new HistoryCacheRunner(fetcher);
        let current = applyRefreshOrNull([], await runner.refresh());
        expect(blockHashes(current)).toEqual([HASH_X, HASH_A, HASH_B]);
        // The append carries only C and D, not the whole cache. That is the
        // point: the consumer extends its list without a full re-render.
        const change = await runner.loadMore();
        expect(kind(change)).toBe("append");
        if (change === null || change.kind !== "append") {
            throw new Error("expected append");
        }
        expect(blockHashes(change.blocks)).toEqual([HASH_C, HASH_D]);
        current = [...current, ...change.blocks];
        expect(blockHashes(current)).toEqual([
            HASH_X, HASH_A, HASH_B, HASH_C, HASH_D,
        ]);
    });

    test("loadMore: empty page means exhausted; returns none on next call", async () => {
        const initial = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8)];
        const fetcher = async (beforeId: number) => {
            if (beforeId === MAX_CURSOR) return page(8, initial);
            return page(0, []);
        };
        const runner = new HistoryCacheRunner(fetcher);
        await runner.refresh();
        // First loadMore: the page is empty, but the append succeeds and marks
        // the cache as exhausted. It is reported as an append with no entries.
        const change = await runner.loadMore();
        expect(kind(change)).toBe("append");
        if (change === null || change.kind !== "append") {
            throw new Error("expected append");
        }
        expect(change.blocks.length).toBe(0);
        // After exhausted, subsequent loadMore resolves to null without fetching.
        expect(await runner.loadMore()).toBeNull();
        expect(await runner.loadMore()).toBeNull();
    });

    test("clear: resets the cache and returns nothing", async () => {
        const initial = [block(HASH_X, 10), block(HASH_A, 9)];
        const fetcher = async (beforeId: number) =>
            beforeId === MAX_CURSOR ? page(9, initial) : page(0, []);
        const runner = new HistoryCacheRunner(fetcher);
        let current = applyRefreshOrNull([], await runner.refresh());
        expect(current.length).toBe(2);
        // clear is void: the caller initiated it and empties its own list.
        expect(runner.clear()).toBeUndefined();
    });

    test("clear during an in-flight walk: stale response is dropped", async () => {
        // Account switch. A refresh for the old account is in flight when
        // clear() lands. clear must invalidate the walk, otherwise the old
        // account's response gets applied to the fresh cache.
        const oldAccount = [block(HASH_X, 10), block(HASH_A, 9)];
        const newAccount = [block(HASH_Y, 20)];
        let callCount = 0;
        const fetcher = async (_beforeId: number) => {
            callCount++;
            if (callCount === 1) {
                await new Promise(r => setTimeout(r, 10));  // slow
                return page(9, oldAccount);
            }
            return page(20, newAccount);
        };
        const runner = new HistoryCacheRunner(fetcher);

        // Start the walk, switch accounts while its fetch is pending.
        const inFlight = runner.refresh();
        runner.clear();
        expect(await inFlight).toBeNull();   // response dropped, not applied

        // The next refresh sees only the new account.
        const change = await runner.refresh();
        expect(kind(change)).toBe("refresh");
        if (change === null) throw new Error("expected a change");
        expect(blockHashes(change.newBlocks)).toEqual([HASH_Y]);
    });

    test("stale response: nonce mismatch is rejected", async () => {
        // The first refresh starts but we trigger a second before the
        // first's response arrives. The first response is rejected.
        const initial = [block(HASH_X, 10)];
        const fetcher = async (beforeId: number) => {
            // Slow response.
            await new Promise(r => setTimeout(r, 10));
            return page(9, initial);
        };
        const runner = new HistoryCacheRunner(fetcher);
        const p1 = runner.refresh();
        const p2 = runner.refresh();
        const [c1, c2] = await Promise.all([p1, p2]);
        // Exactly one of the two calls reports the data; the loser resolves
        // to null. Only one response is accepted.
        const changes = [c1, c2].filter((c): c is RefreshChange => c !== null);
        expect(changes.length).toBe(1);
        expect(blockHashes(applyRefreshOrNull([], changes[0]!))).toEqual([HASH_X]);
    });

    test("walked past bottom: loop terminates, full stitch kept", async () => {
        // First, populate the cache with [X, A, B, C]. bottom is C.
        const initial = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8),
            block(HASH_C, 7)];
        // Second poll: a partial reorg at the top. The new chain has Y
        // at the top, then reorged blocks X', A', B' (no join with the
        // cache), then the original C, D, E, F.
        // Page 1 (cursor=MAX): [Y, X', A', B']. bottom is B' (height 8).
        //   cache's bottom is C (height 7). 8 > 7. No walked past. Join
        //   search: B', A', X', Y are not in cache. No join. Continue.
        // Page 2 (cursor=4): [C, D, E, F]. bottom is F (height 4).
        //   4 < 7. Walked past. Wholesale replace with the full stitch.
        // Result: cache = [Y, X', A', B', C, D, E, F] (full stitch kept).
        const HASH_X2 = "x2".repeat(32);
        const HASH_A2 = "a2".repeat(32);
        const HASH_B2 = "b2".repeat(32);
        const page1 = [block(HASH_Y, 11), block(HASH_X2, 10), block(HASH_A2, 9),
            block(HASH_B2, 8)];
        const page2 = [block(HASH_C, 7), block(HASH_D, 6), block(HASH_E, 5),
            block(HASH_F, 4)];
        // Sequential fetcher: first call returns initial, then page1, then
        // page2, then empty.
        let pollCount = 0;
        const fetcher = async (_beforeId: number) => {
            pollCount++;
            if (pollCount === 1) return page(7, initial);
            if (pollCount === 2) return page(8, page1);
            if (pollCount === 3) return page(4, page2);
            return page(0, []);
        };
        const runner = new HistoryCacheRunner(fetcher);
        // First refresh: isFirstTime, cache = [X, A, B, C].
        let current = applyRefreshOrNull([], await runner.refresh());
        expect(blockHashes(current)).toEqual([HASH_X, HASH_A, HASH_B, HASH_C]);
        // Second refresh: the loop walks backward. Page 1 has no join.
        // Page 2 walks past the cache's bottom (F's height 4 < C's height
        // 7). The cache is wholesale-replaced with the full stitch
        // (including D, E, F). The full stitch is kept; we don't discard
        // downloaded information.
        const change = await runner.refresh();
        expect(pollCount).toBe(3);
        expect(kind(change)).toBe("refresh");
        if (change === null) throw new Error("expected a change");
        expect(change.deleteFrom).toBe(0);
        current = applyRefresh(current, change);
        expect(blockHashes(current)).toEqual([
            HASH_Y, HASH_X2, HASH_A2, HASH_B2, HASH_C, HASH_D, HASH_E, HASH_F,
        ]);
    });
});

describe("HistoryBlocks", () => {
    test("earliestHistoryId: returns last block's historyId", () => {
        const hb = new HistoryBlocks();
        expect(hb.earliestHistoryId()).toBe(Number.MAX_SAFE_INTEGER);
        hb.blocks = [block(HASH_X, 10, 11), block(HASH_A, 9, 10), block(HASH_B, 8, 9)];
        expect(hb.earliestHistoryId()).toBe(9);
    });
});