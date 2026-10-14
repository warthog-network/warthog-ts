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
  replaceAll(stitch: HistoryBlocks): void {
    this.data = stitch;
    this.knownHashes.clear();
    for (const b of this.data.blocks) this.knownHashes.add(b.header.hash);
    this.version += 1;
  }

  // Try to consume the stitch. Returns true if the cache was updated
  // (commit; the loop should break), false if the loop should continue
  // (no join found yet, and not walked past the bottom).
  //
  // Commit cases (return true):
  // - First time: the cache is empty. Wholesale replace.
  // - Stitch is exhausted: the loop walked to the bottom of the new
  //   chain. Wholesale replace.
  // - Walked past bottom: the stitch extends below the cache's bottom.
  //   No future page can have a join. Wholesale replace.
  // - Join found: splice. The cache's at-and-below-join is kept; the
  //   stitch's data below the join is discarded.
  //
  // Continue case (return false):
  // - No join in the stitch, and the stitch hasn't walked past the
  //   bottom. The loop should fetch more pages.
  tryConsume(stitch: HistoryBlocks): boolean {
    const isFirstTime = this.data.blocks.length === 0;
    if (isFirstTime || stitch.exhausted) {
      this.replaceAll(stitch);
      return true;
    }
    if (stitch.blocks.length === 0) return false;

    // Walked past bottom first. If the stitch extends below the cache's
    // bottom, no future page can have a join (subsequent pages are even
    // deeper). Wholesale replace immediately, skip the join search.
    const cacheEarliestHeight = this.data.blocks[this.data.blocks.length - 1]!.height;
    const stitchEarliestHeight = stitch.blocks[stitch.blocks.length - 1]!.height;
    if (stitchEarliestHeight < cacheEarliestHeight) {
      this.replaceAll(stitch);
      return true;
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
          this.knownHashes.delete(this.data.blocks[drop]!.header.hash);
          drop++;
        }
        this.data.blocks.splice(0, drop);
        const newTop = stitch.blocks.slice(0, i);
        this.data.blocks.unshift(...newTop);
        for (const b of newTop) this.knownHashes.add(b.header.hash);
        this.data.exhausted = false;
        return true;
      }
    }

    // No join found, not walked past. Continue the loop.
    return false;
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

  // Consume a response. Returns -1 (stale), 0 (committed), or 1 (need
  // more). All the decision logic is in current.tryConsume.
  onHistory(nonce: number, page: HistoryPage): -1 | 0 | 1 {
    if (nonce !== this.requestNonce) return -1;
    this.stitch.blocks.push(...page.perBlock);
    this.stitch.exhausted = page.perBlock.length === 0;
    if (this.current.tryConsume(this.stitch)) {
      this.resetStitch();
      return 0;
    }
    return 1;
  }

  // Append an earlier page. Returns false if stale (version changed).
  appendEarlier(page: HistoryPage, expectedVersion: number): boolean {
    const pageBlocks = new HistoryBlocks();
    pageBlocks.blocks = page.perBlock;
    pageBlocks.exhausted = page.perBlock.length === 0;
    return this.current.appendEarlier(pageBlocks, expectedVersion);
  }

  // Clear the cache. Used on account switch.
  clear(): void {
    this.current.clear();
    this.stitch = new HistoryBlocks();
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
    private onUpdate: (blocks: readonly HistoryBlock[]) => void,
  ) {}

  // Refresh: walk the loop, terminate on join. The cache's bottom is
  // preserved (anything in the stitch below the join is discarded).
  async refresh(): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    try {
      this.cache.resetStitch();
      for (let i = 0; i < 100; i++) {  // safety bound
        const req = this.cache.getNextRequest();
        const page = await this.fetcher(req.beforeId);
        const result = this.cache.onHistory(req.nonce, page);
        if (result === 0) break;
        if (result === -1) return;
      }
    } finally {
      this.isRefreshing = false;
      this.onUpdate(this.cache.getBlocks());
    }
  }

  // loadMore: fetch one page below the cache and append it. No loop.
  // The consumer calls this multiple times if they need more pages.
  async loadMore(): Promise<boolean> {
    if (this.isPaginating) return false;
    if (this.cache.isExhausted()) return false;
    const versionAtRequest = this.cache.getVersion();
    const cursor = this.cache.earliestHistoryId();
    if (cursor <= 0) return false;
    this.isPaginating = true;
    try {
      const page = await this.fetcher(cursor);
      if (!this.cache.appendEarlier(page, versionAtRequest)) {
        return false;
      }
      this.onUpdate(this.cache.getBlocks());
      return true;
    } finally {
      this.isPaginating = false;
    }
  }

  // Clear the cache. Used on account switch.
  clear(): void {
    this.cache.clear();
    this.onUpdate(this.cache.getBlocks());
  }
}
