// A block as it appears in a history page response.
// Same shape as the Warthog API's Block, with a `historyId` field
// (the lowest historyId in the block) added by the consumer's fetcher.
// `historyId` is a page-level cursor: the node returns one per page, so a
// fetcher stamps every block in the page with it.
export type HistoryBlock = {
  header: { hash: string; height: number; [k: string]: unknown };
  body: Record<string, unknown>;
  confirmations: number;
  height: number;
  historyId: number;   // lowest historyId in this block; added by the fetcher
  [k: string]: unknown;
};

// =====================================================================
// HistoryBlocks: a list of blocks (newest-first) with an exhausted flag.
// Used for the aggregator's data and the in-flight stitch.
//
// Not on the package barrel: nothing public accepts one. Exported from this
// module only so the colocated tests can reach earliestHistoryId.
// =====================================================================

// What refresh() committed. Returned rather than pushed through a callback,
// so the consumer stays in control of how it applies a change. Apply it
// with a single rule:
//   next = [...newBlocks, ...current.filter(b => b.height < deleteFrom)]
// deleteFrom = 0 means discard everything, which is how a wholesale
// replace is told apart from a fork at a glance.
export interface RefreshChange {
  newBlocks: readonly HistoryBlock[];
  deleteFrom: number;
}

// What loadMore() committed. loadMore only ever extends the cache
// downward, so this is the single outcome it can report.
export type LoadMoreChange = { kind: "append"; blocks: readonly HistoryBlock[] };

// A null result from either method means nothing changed and there is
// nothing to do. That covers an idle chain (a splice that would reinsert
// the blocks it dropped), a call skipped because one is already in flight,
// and a response that lost a race and was discarded as stale. Note that
// replace with an empty block list is NOT null: it is a real change that
// tells the consumer to clear its list, which is exactly the case where
// returning null would leave stale blocks on screen.

export class HistoryBlocks {
  blocks: HistoryBlock[] = [];   // newest-first
  exhausted: boolean = false;

  // The earliest (lowest) historyId. Derived from the ordering: the
  // oldest block is the last one.
  earliestHistoryId(): number {
    if (this.blocks.length === 0) return Number.MAX_SAFE_INTEGER;
    return this.blocks[this.blocks.length - 1]!.historyId;
  }
}

// =====================================================================
// HistoryAggregator: file-private inner. Owns the committed block list.
// Folds incoming pages into that list: tryConsume stitches a walked-back
// page against what it holds, and appendEarlier extends it further into
// the past for pagination. Both lists are newest-first, which is what
// lets tryConsume find a join by walking them together.
// =====================================================================

class HistoryAggregator {
  private data = new HistoryBlocks();

  // Monotonic counter that changes exactly when the cache's bottom (the
  // pagination cursor target, earliestHistoryId) moves. Used by appendEarlier
  // as a staleness guard: a caller records the version before fetching a page
  // with a cursor derived from the bottom, then hands that version back; if
  // the bottom moved while the page was in flight, the page is no longer the
  // correct next page and the append is rejected. This is a data-level guard
  // that lives in the mutation itself, so it rejects a stale append regardless
  // of who calls it or how many callers overlap, independent of scheduling
  // guards like isPaginating. Every mutation that moves the bottom must bump
  // it: replaceAll, clear, and appendEarlier. The splice branch deliberately
  // does not, because it preserves the bottom.
  private version: number = 0;

  // Return a fresh snapshot of the blocks array. The internal cache mutates
  // this.data.blocks in place (the splice branch and appendEarlier), so we
  // must not hand consumers the live array. Without the copy, a consumer
  // holding a previous snapshot would see it mutate under them, and React
  // setState(sameRef) would bail out of the re-render.
  getBlocks(): readonly HistoryBlock[] {
    return [...this.data.blocks];
  }

  getVersion(): number {
    return this.version;
  }

  earliestHistoryId(): number {
    return this.data.earliestHistoryId();
  }

  isExhausted(): boolean {
    return this.data.exhausted;
  }

  clear(): void {
    this.data = new HistoryBlocks();
    this.version += 1;
  }

  // Wholesale replace. Takes ownership of the stitch. Bumps the version.
  // Returns the resulting change, which is always a full replace.
  replaceAll(stitch: HistoryBlocks): RefreshChange {
    this.data = stitch;
    this.version += 1;
    return { newBlocks: this.getBlocks(), deleteFrom: 0 };
  }

  // Try to consume the stitch. Returns the change that was committed, or
  // null if the loop should fetch another page (no join found yet, and not
  // walked past the bottom).
  //
  // The commit cases:
  // - First time: the cache is empty. Wholesale replace.
  // - Stitch is exhausted: the loop walked to the bottom of the new
  //   chain. Wholesale replace.
  // - Walked past bottom: the stitch extends below the cache's bottom.
  //   No future page can have a join. Wholesale replace.
  // - Join found: splice. The cache's at-and-below-join is kept; the
  //   stitch's data below the join is discarded. Everything the stitch
  //   brought above the join is new, so a steady-state poll returns
  //   empty newBlocks and the runner reports nothing changed.
  //
  // Continue case:
  // - No join in the stitch, and the stitch hasn't walked past the
  //   bottom. The loop should fetch more pages.
  tryConsume(stitch: HistoryBlocks): RefreshChange | null{
    const cblocks = this.data.blocks;
    const isFirstTime = cblocks.length === 0;
    if (isFirstTime || stitch.exhausted) {
      return this.replaceAll(stitch);
    }
    if (stitch.blocks.length === 0) return null;

    // Walked past bottom first. If the stitch extends below the cache's
    // bottom, no future page can have a join (subsequent pages are even
    // deeper). Wholesale replace immediately, skip the join search. This
    // has to come first: the join search stops at the highest agreeing
    // pair, which it finds at the top, so it would never notice that the
    // stitch reached deeper and would discard what it found there.
    const cacheEarliestHeight = cblocks[cblocks.length - 1]!.height;
    const stitchEarliestHeight = stitch.blocks[stitch.blocks.length - 1]!.height;
    if (stitchEarliestHeight < cacheEarliestHeight) {
      return this.replaceAll(stitch);
    }

    // Not walked past. Find the join: the first height at which the stitch
    // and the cache agree. Both are newest-first, so walk them together
    // from the top, advancing whichever is taller until their heights line
    // up. A pair whose hashes differ is a fork, so step past it too.
    //
    // Stopping at the highest agreeing pair is what makes the result
    // simple. Every stitch block above the join is genuinely new: a
    // pointer is only ever advanced past an element that has no
    // counterpart at any height in the other list. So the blocks above
    // the join need no trimming, and ci doubles as the count of cache
    // blocks above the join.
    let ci = 0; // cache index
    for (let si = 0; si < stitch.blocks.length; si++) { // si is stitch index
      const sb = stitch.blocks[si]!;
      while (ci < cblocks.length && cblocks[ci]!.height > sb.height) ci++;
      // The cache holds nothing at or below this height, so nothing
      // deeper can join either.
      if (ci >= cblocks.length) break;
      const cb = cblocks[ci]!;
      if (cb.height !== sb.height) continue;
      if (cb.header.hash !== sb.header.hash) continue;
      // Join at stitch index si. The cache's blocks above ci go, the
      // stitch's blocks below si go, and the stitch's above si land on
      // top. Both lists stay newest-first, so the bottom is preserved.
      const newTop = stitch.blocks.slice(0, si);
      this.data.blocks.splice(0, ci);
      this.data.blocks.unshift(...newTop);
      this.data.exhausted = false;
      // newTop empty means the join is the cache's top block, so the
      // splice was the identity: refresh turns the empty newBlocks into
      // null.
      return {
        newBlocks: newTop,
        deleteFrom: newTop.length === 0 ? sb.height : stitch.blocks[si - 1]!.height,
      };
    }

    // No join found, not walked past. Continue the loop.
    return null;
  }

  // Append an earlier page. Takes a HistoryBlocks (the page). The page's
  // `exhausted` flag is inherited by the cache. Returns false if the
  // version changed (stale). On success, bumps the version because the
  // bottom moved: any in-flight pagination with an older expectedVersion
  // is now provably wrong, even if it was about to be checked.
  appendEarlier(page: HistoryBlocks, expectedVersion: number): boolean {
    if (expectedVersion !== this.version) return false;
    this.data.blocks.push(...page.blocks);
    this.data.exhausted = page.exhausted;
    this.version += 1;
    return true;
  }
}

// =====================================================================
// HistoryCache: file-private outer. Drives the loop, tracks the stitch,
// manages the nonce. The consumer (runner) drives the I/O.
// =====================================================================

class HistoryCache {
  private aggregator = new HistoryAggregator();
  private stitch = new HistoryBlocks();
  private requestNonce = 0;

  // Reset the stitch and bump the nonce. Called at the start of each
  // walk (in refresh) and at the end (in onHistory's commit path).
  // The nonce bump invalidates any in-flight responses from a previous
  // walk.
  resetStitch(): void {
    this.stitch = new HistoryBlocks();
    this.requestNonce += 1;
  }

  // The next request the consumer should make. Cursor is the stitch's
  // lowest historyId, or MAX if the stitch is empty.
  getNextRequest(): { nonce: number; beforeId: number } {
    this.requestNonce += 1;
    const cursor = this.stitch.blocks.length === 0
      ? Number.MAX_SAFE_INTEGER
      : this.stitch.earliestHistoryId();
    return { nonce: this.requestNonce, beforeId: cursor };
  }

  // Consume a response. Returns the change that was committed, or null when
  // the walk should fetch another page. All the decision logic is in
  // aggregator.tryConsume. Staleness is not checked here: the caller
  // compares the nonce it was given against isCurrentNonce before calling.
  onHistory(blocks: HistoryBlock[]): RefreshChange | null {
    this.stitch.blocks.push(...blocks);
    this.stitch.exhausted = blocks.length === 0;
    const change = this.aggregator.tryConsume(this.stitch);
    if (change === null) return null;
    this.resetStitch();
    return change;
  }

  // Whether a nonce handed out by getNextRequest is still the live one. A
  // walk is invalidated by resetStitch, which clear() also calls, so a
  // response for a previous account is rejected rather than applied.
  isCurrentNonce(nonce: number): boolean {
    return nonce === this.requestNonce;
  }

  // Append an earlier page. Returns false if stale (version changed).
  appendEarlier(blocks: HistoryBlock[], expectedVersion: number): boolean {
    const stitch = new HistoryBlocks();
    stitch.blocks = blocks;
    stitch.exhausted = blocks.length === 0;
    return this.aggregator.appendEarlier(stitch, expectedVersion);
  }

  // Clear the cache. Used on account switch. resetStitch also bumps the
  // nonce, so a response from a walk started for the previous account is
  // rejected instead of being applied to the fresh cache.
  clear(): void {
    this.aggregator.clear();
    this.resetStitch();
  }

  earliestHistoryId(): number {
    return this.aggregator.earliestHistoryId();
  }

  isExhausted(): boolean {
    return this.aggregator.isExhausted();
  }

  getVersion(): number {
    return this.aggregator.getVersion();
  }

  getBlocks(): readonly HistoryBlock[] {
    return this.aggregator.getBlocks();
  }
}

// =====================================================================
// HistoryCacheRunner: the async wrapper. Drives the I/O. The only
// thing a consumer interacts with.
//
// THE FETCHER CONTRACT
//
// `beforeId` is exclusive and is the lowest history id already held, not the
// highest. The node filters `h.id < beforeId`, returns `perBlock` newest-first,
// and sets the page's `fromId` to that page's lowest history id, not its first
// row's. Pass `fromId` back unmodified; subtracting one skips an entry. See
// src/tests/historyCacheCursor.test.ts.
// =====================================================================

export class HistoryCacheRunner {
  private cache = new HistoryCache();
  private isRefreshing = false;
  private isPaginating = false;

  constructor(
    private fetcher: (beforeId: number) => Promise<HistoryBlock[]>,
  ) {}

  // Refresh: walk the loop, terminate on a join, and return the change
  // that was committed, or null if nothing changed. See RefreshChange for
  // how to apply it.
  // A fetch failure rejects the promise and the caller keeps whatever it
  // already had; there is no catch-all notification.
  async refresh(): Promise<RefreshChange | null> {
    if (this.isRefreshing) return null;
    this.isRefreshing = true;
    try {
      this.cache.resetStitch();
      for (let i = 0; i < 100; i++) {  // safety bound
        const req = this.cache.getNextRequest();
        const blocks = await this.fetcher(req.beforeId);
        // The walk may have been invalidated while the fetch was in flight
        // (a clear for an account switch). Drop the response.
        if (!this.cache.isCurrentNonce(req.nonce)) return null;
        const change = this.cache.onHistory(blocks);
        if (change !== null) {
          // A commit that introduced no new blocks changed nothing, so
          // report null rather than a change the caller must inspect.
          return change.newBlocks.length === 0 ? null : change;
        }
      }
      return null;  // safety bound reached without committing
    } finally {
      this.isRefreshing = false;
    }
  }

  // loadMore: fetch one page below the cache and append it. No loop.
  // Returns an "append" carrying just the newly added entries, so the
  // consumer extends its list without re-rendering everything. Null means
  // the cache is exhausted, the call was skipped because one is already in
  // flight, or the response lost a race and was discarded.
  async loadMore(): Promise<LoadMoreChange | null> {
    if (this.isPaginating) return null;
    if (this.cache.isExhausted()) return null;
    const versionAtRequest = this.cache.getVersion();
    const cursor = this.cache.earliestHistoryId();
    if (cursor <= 0) return null;
    this.isPaginating = true;
    try {
      const blocks = await this.fetcher(cursor);
      if (!this.cache.appendEarlier(blocks, versionAtRequest)) {
        return null;
      }
      return { kind: "append", blocks };
    } finally {
      this.isPaginating = false;
    }
  }

  // Clear the cache. Used on account switch. Returns nothing: the caller
  // initiated it and knows to empty its own list.
  clear(): void {
    this.cache.clear();
  }
}
