import { Funds, TokenDecimals, Wart } from './Funds';

/**
 * A WART amount as a node reports it: the decimal string and the integer
 * E8 value.
 */
type NodeWart = { str?: string; E8?: number };

/**
 * A token amount as a node reports it: the decimal string, the integer
 * amount and the number of decimals it is scaled by.
 */
type NodeFundsDecimal = { str?: string; u64?: number; decimals?: number };

/**
 * Read a WART amount out of a node response.
 *
 * The decimal string is used, not the integer: the integer is a JSON number,
 * and a balance above 2^53 does not survive that.
 */
export function parseNodeWart(value: unknown): Wart | null {
    const node = value as NodeWart | null | undefined;
    if (!node || typeof node.str !== 'string') {
        return null;
    }
    return Wart.parse(node.str);
}

/**
 * Read a token amount out of a node response.
 *
 * The decimal string is used, not the integer, for the same reason as
 * {@link parseNodeWart}.
 */
export function parseNodeFunds(value: unknown): Funds | null {
    const node = value as NodeFundsDecimal | null | undefined;
    if (!node || typeof node.str !== 'string' || typeof node.decimals !== 'number') {
        return null;
    }
    const decimals = new TokenDecimals(node.decimals);
    return Funds.parse(node.str, decimals);
}

/**
 * WART balance of an account on the DeFi node.
 *
 * The DeFi node reports the balance three ways: what the account owns in
 * total, what is locked in open limit orders, and what is locked by
 * transactions still sitting in the mempool. The spendable amount is what is
 * left of the total after those two.
 */
export class DeFiWartBalance {
    constructor(
        /** What the account owns. */
        public readonly total: Wart,
        /** Locked in open limit orders. */
        public readonly locked: Wart,
        /** Locked by transactions in the mempool. */
        public readonly mempool: Wart,
    ) {}

    /**
     * Read a balance out of a `/account/{address}/wart_balance` response.
     *
     * @param data - The `data` payload of the response.
     * @returns The balance, or null if the payload is malformed or the three
     *   amounts do not add up.
     */
    public static parse(data: unknown): DeFiWartBalance | null {
        const wart = (data as { wart?: { total?: unknown; locked?: unknown; mempool?: unknown } } | null)
            ?.wart;

        const total = parseNodeWart(wart?.total);
        const locked = parseNodeWart(wart?.locked);
        const mempool = parseNodeWart(wart?.mempool);

        if (!total || !locked || !mempool) {
            return null;
        }

        // The node computes the spendable amount by subtracting the two
        // locked parts from the total, and asserts the result. A response
        // that does not add up is not a balance we can use.
        if (total.E8 < locked.E8 + mempool.E8) {
            return null;
        }

        return new DeFiWartBalance(total, locked, mempool);
    }

    /**
     * The amount that can be spent now: total - locked - mempool.
     *
     * @throws If the balance does not add up, which the node also treats as
     *   an error rather than a balance.
     */
    public free(): Wart {
        const free = this.total.E8 - this.locked.E8 - this.mempool.E8;
        if (free < 0n) {
            throw new Error('Inconsistent balance: total is less than locked plus mempool');
        }
        return Wart.fromE8(free)!;
    }
}

/**
 * Token balance of an account on the DeFi node.
 */
export class TokenBalance {
    constructor(
        /** Name of the token. */
        public readonly name: string,
        /** Number of decimals the token is scaled by. */
        public readonly decimals: TokenDecimals,
        /** What the account owns. */
        public readonly total: Funds,
        /** Locked in open limit orders. */
        public readonly locked: Funds,
        /** Locked by transactions in the mempool. */
        public readonly mempool: Funds,
    ) {}

    /**
     * Read a balance out of a `/account/{address}/balance/asset:{hash}`
     * response.
     *
     * @param data - The `data` payload of the response.
     * @returns The balance, or null if the payload is malformed or the three
     *   amounts do not add up.
     */
    public static parse(data: unknown): TokenBalance | null {
        const payload = data as
            | {
                  token?: { name?: string; decimals?: number };
                  balance?: { total?: unknown; locked?: unknown; mempool?: unknown };
              }
            | null
            | undefined;

        const token = payload?.token;
        if (!token || typeof token.name !== 'string' || typeof token.decimals !== 'number') {
            return null;
        }

        const total = parseNodeFunds(payload?.balance?.total);
        const locked = parseNodeFunds(payload?.balance?.locked);
        const mempool = parseNodeFunds(payload?.balance?.mempool);

        if (!total || !locked || !mempool) {
            return null;
        }

        if (total.amount < locked.amount + mempool.amount) {
            return null;
        }

        return new TokenBalance(
            token.name,
            new TokenDecimals(token.decimals),
            total,
            locked,
            mempool,
        );
    }

    /**
     * The amount that can be spent now: total - locked - mempool.
     *
     * @throws If the balance does not add up, which the node also treats as
     *   an error rather than a balance.
     */
    public free(): Funds {
        const free = this.total.amount - this.locked.amount - this.mempool.amount;
        if (free < 0n) {
            throw new Error('Inconsistent balance: total is less than locked plus mempool');
        }
        return Funds.fromAmount(free)!;
    }
}
