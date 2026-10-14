// A block as it appears in a history page response.
// Same shape as the Warthog API's Block, with a `historyId` field
// (the lowest historyId in the block) added by the consumer's fetcher.
export type HistoryBlock = {
  header: { hash: string; height: number; [k: string]: unknown };
  body: Record<string, unknown>;
  confirmations: number;
  height: number;
  historyId: number;   // lowest historyId in this block; added by the fetcher
  [k: string]: unknown;
};

export type HistoryPage = {
  fromId: number;              // lowest historyId in the page; 0 if empty
  perBlock: HistoryBlock[];   // newest-first
};

// =====================================================================
// HistoryBlocks: a list of blocks (newest-first) with an exhausted flag.
// Used for the cache, the stitch, and the page in appendEarlier.
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
// HistorySplicer: file-private inner. Owns the cache's data and a
// known-hash set. Provides tryConsume (the loop's decision logic) and
// appendEarlier (for pagination).
// =====================================================================

class HistorySplicer {
  private data = new HistoryBlocks();
  private knownHashes = new Set<string>();

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

  hasHash(hash: string): boolean {
    return this.knownHashes.has(hash);
  }

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
    this.knownHashes.clear();
    this.version += 1;
  }

  // Wholesale replace. Takes ownership of the stitch. Bumps the version.
  // Returns the resulting change, which is always a full replace.
  replaceAll(stitch: HistoryBlocks): RefreshChange {
    this.data = stitch;
    this.knownHashes.clear();
    for (const b of this.data.blocks) this.knownHashes.add(b.header.hash);
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
  //   stitch's data below the join is discarded. The returned change is
  //   trimmed to the blocks the cache had not seen, so a steady-state poll
  //   returns empty newBlocks and the runner reports nothing changed.
  //
  // Continue case:
  // - No join in the stitch, and the stitch hasn't walked past the
  //   bottom. The loop should fetch more pages.
  tryConsume(stitch: HistoryBlocks): RefreshChange | null{
    const isFirstTime = this.data.blocks.length === 0;
    if (isFirstTime || stitch.exhausted) {
      return this.replaceAll(stitch);
    }
    if (stitch.blocks.length === 0) return null;

    // Walked past bottom first. If the stitch extends below the cache's
    // bottom, no future page can have a join (subsequent pages are even
    // deeper). Wholesale replace immediately, skip the join search.
    const cacheEarliestHeight = this.data.blocks[this.data.blocks.length - 1]!.height;
    const stitchEarliestHeight = stitch.blocks[stitch.blocks.length - 1]!.height;
    if (stitchEarliestHeight < cacheEarliestHeight) {
      return this.replaceAll(stitch);
    }

    // Not walked past. Try to find a join. Walk the stitch from the
    // earliest toward the newest. The first match is the join (the
    // deepest in the stitch that's in the cache).
    const cacheMaxHeight = this.data.blocks[0]!.height;
    for (let i = stitch.blocks.length - 1; i >= 0; i--) {
      const stitchBlock = stitch.blocks[i]!;
      // A stitch block taller than the cache's newest block cannot be a
      // known hash (that would need a SHA-256 collision between two
      // distinct blocks). Testing the height first is a cheap integer
      // compare that skips the Set lookup for blocks that cannot match.
      if (stitchBlock.height > cacheMaxHeight) continue;
      if (this.knownHashes.has(stitchBlock.header.hash)) {
        // Join found. Splice. The cache's at-and-below-join is kept.
        // The stitch's data at-and-above-join replaces the cache's
        // above-join. The stitch's data below the join is discarded
        // (the cache's bottom is preserved).
        const joinHeight = stitchBlock.height;
        let drop = 0;
        while (
          drop < this.data.blocks.length &&
          this.data.blocks[drop]!.height > joinHeight
        ) {
          drop++;
        }
        const newTop = stitch.blocks.slice(0, i);

        // Known blocks in newTop are always a contiguous run at the bottom:
        // if a block at height h is in the cache, the one at h-1 is too (an
        // equal hash means an equal prevHash). So scan back from the deepest
        // end and stop at the first block the cache has not seen. Everything
        // from there up is genuinely new; everything below is already held
        // and does not need resending.
        let k = newTop.length;
        while (k > 0 && this.knownHashes.has(newTop[k - 1]!.header.hash)) k--;

        for (let d = 0; d < drop; d++) {
          this.knownHashes.delete(this.data.blocks[d]!.header.hash);
        }
        this.data.blocks.splice(0, drop);
        this.data.blocks.unshift(...newTop);
        for (const b of newTop) this.knownHashes.add(b.header.hash);
        this.data.exhausted = false;
        // k === 0 means the stitch brought nothing the cache lacked, which
        // is the steady state: the splice was an identity. Returned with no
        // newBlocks, and refresh turns that into null.
        return {
          newBlocks: newTop.slice(0, k),
          deleteFrom: k === 0 ? this.data.blocks[0]!.height : newTop[k - 1]!.height,
        };
      }
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
    for (const b of page.blocks) {
      this.data.blocks.push(b);
      this.knownHashes.add(b.header.hash);
    }
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
  private current = new HistorySplicer();
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
  // current.tryConsume. Staleness is not checked here: the caller compares
  // the nonce it was given against isCurrentNonce before calling this.
  onHistory(page: HistoryPage): RefreshChange | null {
    this.stitch.blocks.push(...page.perBlock);
    this.stitch.exhausted = page.perBlock.length === 0;
    const change = this.current.tryConsume(this.stitch);
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
  appendEarlier(page: HistoryPage, expectedVersion: number): boolean {
    const pageBlocks = new HistoryBlocks();
    pageBlocks.blocks = page.perBlock;
    pageBlocks.exhausted = page.perBlock.length === 0;
    return this.current.appendEarlier(pageBlocks, expectedVersion);
  }

  // Clear the cache. Used on account switch. resetStitch also bumps the
  // nonce, so a response from a walk started for the previous account is
  // rejected instead of being applied to the fresh cache.
  clear(): void {
    this.current.clear();
    this.resetStitch();
  }

  earliestHistoryId(): number {
    return this.current.earliestHistoryId();
  }

  isExhausted(): boolean {
    return this.current.isExhausted();
  }

  getVersion(): number {
    return this.current.getVersion();
  }

  getBlocks(): readonly HistoryBlock[] {
    return this.current.getBlocks();
  }
}

// =====================================================================
// HistoryCacheRunner: the async wrapper. Drives the I/O. The only
// thing the consumer (browser-wallet, client-explorer) interacts with.
// =====================================================================

export class HistoryCacheRunner {
  private cache = new HistoryCache();
  private isRefreshing = false;
  private isPaginating = false;

  constructor(
    private fetcher: (beforeId: number) => Promise<HistoryPage>,
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
        const page = await this.fetcher(req.beforeId);
        // The walk may have been invalidated while the fetch was in flight
        // (a clear for an account switch). Drop the response.
        if (!this.cache.isCurrentNonce(req.nonce)) return null;
        const change = this.cache.onHistory(page);
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
      const page = await this.fetcher(cursor);
      if (!this.cache.appendEarlier(page, versionAtRequest)) {
        return null;
      }
      return { kind: "append", blocks: page.perBlock };
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
