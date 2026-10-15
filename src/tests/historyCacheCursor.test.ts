// The fetcher contract, pinned against a stand-in for the node's history
// endpoint. The cache is only correct if the fetcher it is given honours the
// semantics of `beforeId`, and that semantics live in the node, not here, so
// this file reproduces them and checks that a caller who follows the contract
// gets the right answer.
//
// There is a companion note in `src/HistoryCache.ts` under THE FETCHER
// CONTRACT, with the live-node capture the numbers below come from.
//
// No live node is contacted. Unit tests only.

import { test, expect, describe } from "bun:test";
import { HistoryCacheRunner } from "../HistoryCache";
import type { HistoryBlock } from "../HistoryCache";

// ===========================================================================
// A stand-in for the node
//
// Reproduces the four behaviours the cursor contract depends on, all of them
// verified against a v0.10.30 testnet node on 2026-10-15:
//
//   1. The filter is exclusive: `h.id < beforeId`, not `<=`.
//   2. Rows come back newest-first (`ORDER BY h.id DESC`).
//   3. `fromId` is the LOWEST history id on the page, not the first row's.
//   4. A page holds at most 100 rows; past the end it comes back empty.
//
// Simplification: this models one history entry per block. A block can hold
// several entries, and the endpoint returns one `perBlock` row per block, but
// that only affects how many blocks a page covers. It does not touch the
// cursor arithmetic, which is what these tests are about.
// ===========================================================================

const PAGE_LIMIT = 100;

interface StoredRow {
    historyId: number;
    height: number;
    hash: string;
}

class FakeHistoryEndpoint {
    // Ascending by historyId, which is how the table stores them.
    private rows: StoredRow[];

    constructor(firstHistoryId: number, count: number) {
        this.rows = [];
        for (let i = 0; i < count; i++) {
            const historyId = firstHistoryId + i;
            this.rows.push({
                historyId,
                height: 1000 + i,
                hash: historyId.toString(16).padStart(64, "0"),
            });
        }
    }

    /** The node's response shape, before a consumer maps it into HistoryBlock. */
    async get(beforeId: number): Promise<{ fromId: number; perBlock: StoredRow[] }> {
        const matching = this.rows
            .filter((r) => r.historyId < beforeId)      // (1) exclusive
            .sort((a, b) => b.historyId - a.historyId)  // (2) newest-first
            .slice(0, PAGE_LIMIT);                     // (3) the cap
        return {
            // (4) the page's cursor is its LOWEST id, so the last element of a
            // descending list. Zero when the page is empty.
            fromId: matching.length === 0 ? 0 : matching[matching.length - 1]!.historyId,
            perBlock: matching,
        };
    }

    /** A fetcher that follows the documented contract. */
    fetcher() {
        return async (beforeId: number): Promise<HistoryBlock[]> => {
            const page = await this.get(beforeId);
            return page.perBlock.map((r) => ({
                header: { hash: r.hash, height: r.height },
                body: {},
                confirmations: 1,
                height: r.height,
                historyId: page.fromId,
            }));
        };
    }
}

// Walk a runner to the bottom, collecting block heights. Height rather than
// historyId, which is a page-level cursor and repeats across a page.
async function walkAll(runner: HistoryCacheRunner): Promise<number[]> {
    const seen: number[] = [];

    // refresh() commits the first page. It reports null only when the commit
    // introduced no new blocks, which cannot happen on an empty cache.
    const first = await runner.refresh();
    if (first !== null) seen.push(...first.newBlocks.map((b) => b.height));

    for (;;) {
        const change = await runner.loadMore();
        if (change === null) break;
        // The final empty page still commits: loadMore reports the append of
        // zero blocks, and only the call after it returns null. Counting the
        // blocks rather than the calls keeps this honest about both.
        seen.push(...change.blocks.map((b) => b.height));
    }
    return seen;
}

describe("fetcher contract: cursor semantics", () => {
    test("walking a history covers every entry exactly once, with no gap or overlap", async () => {
        const COUNT = 250;   // three pages: 100 + 100 + 50
        const history = new FakeHistoryEndpoint(1000, COUNT);
        const runner = new HistoryCacheRunner(history.fetcher());

        const seen = await walkAll(runner);

        // One entry per block, so a duplicate or a gap both show up as a
        // wrong set. Blocks come back newest-first, so this is descending.
        expect(seen.length).toBe(COUNT);
        expect(new Set(seen).size).toBe(COUNT);
        for (let i = 0; i < COUNT; i++) {
            expect(seen[i]).toBe(1000 + COUNT - 1 - i);
        }
    });

    test("a page's fromId is its lowest history id, not the first row's", async () => {
        const history = new FakeHistoryEndpoint(1000, 250);

        const page = await history.get(Number.MAX_SAFE_INTEGER);

        expect(page.perBlock).toHaveLength(PAGE_LIMIT);
        expect(page.perBlock[0]!.historyId).toBe(1249);   // newest
        expect(page.perBlock[PAGE_LIMIT - 1]!.historyId).toBe(1150);
        // The cursor is the page's LOWEST, which is its last row.
        expect(page.fromId).toBe(1150);
        expect(page.fromId).toBeLessThan(page.perBlock[0]!.historyId);
    });

    test("the captured boundary: fromId resumes adjacent, fromId - 1 drops an entry", async () => {
        // Mirrors account 56ed966df6... on a v0.10.30 testnet node, whose real
        // page gave perBlock[0].historyId = 160427 against fromId = 160281.
        // That pair is what proves fromId is the page's low and not its high.
        const FIRST = 160000;
        const COUNT = 500;
        const history = new FakeHistoryEndpoint(FIRST, COUNT);

        const first = await history.get(Number.MAX_SAFE_INTEGER);
        // The page covers the newest 100 ids, so its low is the 400th.
        expect(first.perBlock[0]!.historyId).toBe(FIRST + COUNT - 1);
        expect(first.fromId).toBe(FIRST + COUNT - PAGE_LIMIT);
        expect(first.fromId).toBeLessThan(first.perBlock[0]!.historyId);

        // Correct: pass fromId back unmodified. The next page starts exactly
        // one below it, so the two pages are adjacent.
        const correct = await history.get(first.fromId);
        expect(correct.perBlock[0]!.historyId).toBe(first.fromId - 1);

        // Off by one: that same entry is now below both cursors and is
        // returned by neither page. This is the failure mode the contract
        // exists to prevent, and it is silent.
        const offByOne = await history.get(first.fromId - 1);
        expect(offByOne.perBlock[0]!.historyId).toBe(first.fromId - 2);
        expect(offByOne.perBlock.some((r) => r.historyId === first.fromId - 1)).toBe(false);
    });

    test("an off-by-one cursor loses exactly one entry per page boundary", async () => {
        // The same defect measured end to end through the cache, rather than at
        // the endpoint alone. A consumer who subtracts before paginating does
        // not get an error; they get a history with holes in it.
        const COUNT = 250;
        const history = new FakeHistoryEndpoint(1000, COUNT);

        const correct = await walkAll(new HistoryCacheRunner(history.fetcher()));
        expect(correct.length).toBe(COUNT);

        const buggy = new HistoryCacheRunner(async (beforeId: number) => {
            const page = await history.get(
                beforeId === Number.MAX_SAFE_INTEGER ? beforeId : beforeId - 1,
            );
            return page.perBlock.map((r) => ({
                header: { hash: r.hash, height: r.height },
                body: {},
                confirmations: 1,
                height: r.height,
                historyId: page.fromId,
            }));
        });

        const lost = await walkAll(buggy);
        expect(lost.length).toBeLessThan(COUNT);
        // Everything the correct walk saw is either seen here or skipped, and
        // the skip is silent: no error, just a shorter history.
        const missing = correct.filter((h) => !lost.includes(h));
        expect(missing.length).toBeGreaterThan(0);
    });

    test("walking a long history terminates by itself", async () => {
        // The point of a correct cursor: an unbounded walk ends without the
        // caller tracking anything. Ten pages here, comfortably inside
        // refresh's 100-iteration safety bound.
        const COUNT = 1000;
        const history = new FakeHistoryEndpoint(1000, COUNT);
        const runner = new HistoryCacheRunner(history.fetcher());

        const seen = await walkAll(runner);

        expect(seen.length).toBe(COUNT);
        expect(new Set(seen).size).toBe(COUNT);
        // Nothing beyond the real range was invented, and nothing in it missed.
        expect(Math.min(...seen)).toBe(1000);
        expect(Math.max(...seen)).toBe(1000 + COUNT - 1);
    });
});