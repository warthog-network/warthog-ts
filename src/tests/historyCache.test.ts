import { test, expect, describe } from "bun:test";
import { HistoryCacheRunner, HistoryBlocks } from "../HistoryCache";
import type { HistoryBlock, HistoryPage } from "../HistoryCache";

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

describe("HistoryCacheRunner", () => {
    test("first time: stores the page as the cache", async () => {
        const blocks = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8)];
        const fetcher = async (beforeId: number) => page(beforeId === MAX_CURSOR ? 8 : 0, blocks);
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        await runner.refresh();
        expect(blockHashes(latestBlocks)).toEqual([HASH_X, HASH_A, HASH_B]);
    });

    test("steady state: cache unchanged when no new entries", async () => {
        const blocks = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8)];
        const fetcher = async (beforeId: number) =>
            beforeId === MAX_CURSOR ? page(8, blocks) : page(0, []);
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        await runner.refresh();
        expect(blockHashes(latestBlocks)).toEqual([HASH_X, HASH_A, HASH_B]);
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
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        // First refresh: populate the cache.
        await runner.refresh();
        expect(blockHashes(latestBlocks)).toEqual([
            HASH_X, HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F,
        ]);
        // Second refresh: the loop fetches the appended page. The stitch's
        // earliest (J, height 0) is below the cache's earliest (F, height
        // 4), so the walked-past check fires and the cache is wholesale-
        // replaced with the full stitch. The full stitch is kept (we don't
        // discard downloaded information).
        await runner.refresh();
        expect(callCount).toBe(2);
        expect(blockHashes(latestBlocks)).toEqual([
            HASH_Y, HASH_X, HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F,
            HASH_G, HASH_H, HASH_I, HASH_J,
        ]);
    });

    test("reorg: cache replaced with new chain on wholesale", async () => {
        // First poll: old chain [X, A, B, C, D, E, F].
        const old = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8),
            block(HASH_C, 7), block(HASH_D, 6), block(HASH_E, 5), block(HASH_F, 4)];
        // Second poll: entirely new chain [X', A', B', C', D', E', F'].
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
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        // First refresh: populate the cache.
        await runner.refresh();
        expect(blockHashes(latestBlocks)).toEqual([
            HASH_X, HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F,
        ]);
        // Second refresh: the reorg. X', A', B' replace X, A, B.
        // C, D, E, F are in both, so the join is at C. The splice keeps
        // C, D, E, F and prepends X', A', B'.
        await runner.refresh();
        expect(blockHashes(latestBlocks)).toEqual([
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
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        // First refresh: populate the cache.
        await runner.refresh();
        expect(blockHashes(latestBlocks)).toEqual([
            HASH_X, HASH_A, HASH_B, HASH_C, HASH_D, HASH_E, HASH_F,
        ]);
        // Second refresh: the reorg. A, B, C are replaced; X, D, E, F stay.
        await runner.refresh();
        expect(blockHashes(latestBlocks)).toEqual([
            HASH_X, HASH_A2, HASH_B2, HASH_C2, HASH_D, HASH_E, HASH_F,
        ]);
    });

    test("loadMore: appends a page below the cache", async () => {
        const initial = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8)];
        const more = [block(HASH_C, 7), block(HASH_D, 6)];
        const fetcher = async (beforeId: number) => {
            if (beforeId === MAX_CURSOR) return page(8, initial);
            if (beforeId === 8) return page(6, more);
            return page(0, []);
        };
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        await runner.refresh();
        expect(blockHashes(latestBlocks)).toEqual([HASH_X, HASH_A, HASH_B]);
        const result = await runner.loadMore();
        expect(result).toBe(true);
        expect(blockHashes(latestBlocks)).toEqual([
            HASH_X, HASH_A, HASH_B, HASH_C, HASH_D,
        ]);
    });

    test("loadMore: empty page means exhausted; returns false on next call", async () => {
        const initial = [block(HASH_X, 10), block(HASH_A, 9), block(HASH_B, 8)];
        const fetcher = async (beforeId: number) => {
            if (beforeId === MAX_CURSOR) return page(8, initial);
            return page(0, []);
        };
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        await runner.refresh();
        // First loadMore: the page is empty, but the append succeeds and
        // marks the cache as exhausted. loadMore returns true.
        expect(await runner.loadMore()).toBe(true);
        // After exhausted, subsequent loadMore returns false without fetching.
        expect(await runner.loadMore()).toBe(false);
        expect(await runner.loadMore()).toBe(false);
    });

    test("clear: resets the cache", async () => {
        const initial = [block(HASH_X, 10), block(HASH_A, 9)];
        const fetcher = async (beforeId: number) =>
            beforeId === MAX_CURSOR ? page(9, initial) : page(0, []);
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        await runner.refresh();
        expect(latestBlocks.length).toBe(2);
        runner.clear();
        // clear invokes onUpdate with an empty array.
        expect(latestBlocks.length).toBe(0);
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
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        const p1 = runner.refresh();
        const p2 = runner.refresh();
        await Promise.all([p1, p2]);
        // Only one response is accepted; latestBlocks has the data.
        expect(blockHashes(latestBlocks)).toEqual([HASH_X]);
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
        //   4 < 7. Walked past. Wholesale replace.
        // Result: cache = [Y, X', A', B', C, D, E, F].
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
        let latestBlocks: readonly HistoryBlock[] = [];
        const runner = new HistoryCacheRunner(fetcher, b => { latestBlocks = b; });
        await runner.refresh();
        // First refresh: isFirstTime, cache = [X, A, B, C].
        expect(blockHashes(latestBlocks)).toEqual([HASH_X, HASH_A, HASH_B, HASH_C]);
        // Second refresh: the loop walks backward. Page 1 has no join.
        // Page 2 walks past the cache's bottom (F's height 4 < C's height
        // 7). The cache is wholesale-replaced with the full stitch
        // (including D, E, F). The full stitch is kept; we don't discard
        // downloaded information.
        await runner.refresh();
        expect(pollCount).toBe(3);
        expect(blockHashes(latestBlocks)).toEqual([
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
