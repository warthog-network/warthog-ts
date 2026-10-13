import type { WarthogApiVersion } from './Api';

/**
 * A proposed chain pin — the (height, hash) pair that transactions are built
 * against.
 *
 * Pin heights are always multiples of 32: a block header stores a 1-byte
 * *relative* pin (`PinNonce::relativePin`) and the absolute height is
 * `relativePin << 5`, so at most 256 distinct pins exist in a chain.
 * `core/defi`'s `PinHeight` type throws `ENOPINHEIGHT` for any height that
 * isn't one of them.
 *
 * A pin is not a single permanent thing — the chain advances through a
 * sequence of them, each at a height >= the last. `/chain/head` reports the
 * most recently proposed one, which is what a client needs in order to build
 * a valid transaction.
 */
export class ChainPin {
    /**
     * Pin heights are always multiples of 32 (1-byte relative pin).
     */
    public static readonly PIN_HEIGHT_MULTIPLE = 32;

    constructor(
        public readonly pinHash: string,
        public readonly pinHeight: number,
    ) {}

    /**
     * Check that a pair of raw values forms a well-formed pin.
     */
    public static validate(pinHash: unknown, pinHeight: unknown): boolean {
        return (
            typeof pinHash === 'string' &&
            pinHash.length === 64 &&
            typeof pinHeight === 'number' &&
            Number.isInteger(pinHeight) &&
            pinHeight % ChainPin.PIN_HEIGHT_MULTIPLE === 0
        );
    }

    /**
     * Extract the pin from a `/chain/head` payload.
     *
     * @param data - The `data` payload of the response.
     * @param version - Which API generation `data` came from. Determines
     *   whether the pin is read from `data` (V1) or `data.chainHead` (V2).
     * @returns The pin, or null if the payload does not match `version`.
     */
    public static parse(data: unknown, version: WarthogApiVersion): ChainPin | null {
        const src = chainHeadSource(data, version);
        if (!src || !ChainPin.validate(src.pinHash, src.pinHeight)) {
            return null;
        }
        return new ChainPin(src.pinHash as string, src.pinHeight as number);
    }
}

/**
 * Locate the ChainHead fields within a `/chain/head` payload for a given API
 * generation.
 *
 * Both generations serialize the same C++ type, `Head { ChainHead chainHead;
 * bool synced; }`. V1 (core/master, core/dev) uses a hand-written
 * `to_json(API::Head&)` that flattens ChainHead into the top level; V2
 * (core/defi) uses glaze, which reflects the nesting automatically.
 *
 * @returns The ChainHead fields, or undefined when the payload isn't the
 *   expected shape.
 */
export function chainHeadSource(
    data: unknown,
    version: WarthogApiVersion,
): Record<string, unknown> | undefined {
    const payload = data as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    // V1 puts the fields at the top level; V2 wraps them in `chainHead`.
    const src = version === 'v2' ? payload.chainHead : payload;

    return src && typeof src === 'object' ? (src as Record<string, unknown>) : undefined;
}