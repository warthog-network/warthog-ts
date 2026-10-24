/**
 * The version a node reports about itself.
 *
 * Every node family reports the same five fields, in the same flat shape:
 *
 *   core/master (mainnet) — `GET /tools/version`, nlohmann
 *                            `to_json(PrintNodeVersion&)`
 *   core/dev              — `GET /tools/version`, nlohmann
 *                            `to_json(PrintNodeVersion&)`
 *   core/defi (testnet)   — `GET /version`, glaze `NodeVersion`
 *
 * So unlike `/chain/head`, which differs between API generations, the version
 * payload needs no per-family handling. Only the URL differs, and that is the
 * caller's business, not the parser's.
 */
export class NodeVersion {
    constructor(
        /**
         * The node's version string, e.g. `v0.10.3 "dd054a2"`.
         *
         * This is the `CMDLINE_PARSER_VERSION` macro: the semantic version
         * with a `v` in front, then the commit hash in quotes.
         */
        public readonly name: string,
        /** Major version. */
        public readonly major: number,
        /** Minor version. */
        public readonly minor: number,
        /** Patch version. */
        public readonly patch: number,
        /** The commit hash the node was built from. */
        public readonly commit: string,
    ) {}

    /**
     * The version as a dotted triple, e.g. `0.10.3`.
     *
     * This is the numeric form, without the `v` prefix and without the
     * commit hash. It is what a version comparison wants.
     */
    public get version(): string {
        return `${this.major}.${this.minor}.${this.patch}`;
    }

    /**
     * Read the version out of a node response.
     *
     * @param data - The `data` payload of the response.
     * @returns The version, or null if the payload is missing a field or a
     *   field has the wrong type.
     */
    public static parse(data: unknown): NodeVersion | null {
        const payload = data as
            | {
                  name?: unknown;
                  major?: unknown;
                  minor?: unknown;
                  patch?: unknown;
                  commit?: unknown;
              }
            | null
            | undefined;

        if (!payload) {
            return null;
        }

        const { name, major, minor, patch, commit } = payload;

        if (typeof name !== 'string' || typeof commit !== 'string') {
            return null;
        }

        if (
            typeof major !== 'number' ||
            !Number.isInteger(major) ||
            typeof minor !== 'number' ||
            !Number.isInteger(minor) ||
            typeof patch !== 'number' ||
            !Number.isInteger(patch)
        ) {
            return null;
        }

        return new NodeVersion(name, major, minor, patch, commit);
    }
}
