export const MAX_U64 = 0xffffffffffffffffn;

/**
 * Represents token's number of decimal place).
 * Valid range: 0-18. WART uses 8 decimal places.
 */
export class TokenDecimals {
    /** Pre-configured WART decimals (8 decimals) */
    public static readonly WART = new TokenDecimals(8);
    /** Pre-configured Liquidity decimals (8 decimals) */
    public static readonly LIQUIDITY = new TokenDecimals(8);

    /**
     * Create a TokenDecimals instance.
     * @param decimals - Number of decimal places (0-18)
     * @throws Error if decimals is out of range
     */
    constructor(public readonly decimals: number) {
        if (decimals < 0 || decimals > 18) {
            throw new Error("Invalid decimals");
        }
    }
}

/**
 * Represents a parsed decimal string as a 64-bit integer with decimal place info.
 * Used internally for parsing currency strings.
 *
 * This is the counterpart of the node's `FundsDecimal`: the funds (the digits
 * with the decimal point removed) together with the number of decimal places
 * the funds are scaled by.
 */
export class FundsDecimal {
    /** The funds: the digits of the amount, with the decimal point removed */
    funds: bigint;
    /** The number of decimal places the funds are scaled by */
    decimals: TokenDecimals;

    constructor(funds: bigint, decimals: number | TokenDecimals) {
        this.funds = funds;
        this.decimals = typeof decimals === "number" ? new TokenDecimals(decimals) : decimals;
    }

    /**
     * Parse a decimal string into a FundsDecimal.
     * @param s - Decimal string (e.g., "123.45")
     * @returns FundsDecimal or null if invalid
     */
    public static parse(s: string): FundsDecimal | null {
        const MAX_DIGITS = 20;

        let str = "";
        let digitsAfterDot = 0;
        let dotFound = false;

        for (const char of s) {
            if (char >= "0" && char <= "9") {
                if (str.length >= MAX_DIGITS) {
                    return null;
                }
                str += char;
                if (dotFound) {
                    digitsAfterDot++;
                }
            } else if (char === ".") {
                if (dotFound) {
                    return null;
                }
                dotFound = true;
            } else {
                return null;
            }
        }

        if (str.length === 0) {
            return null;
        }

        const val = BigInt(str);

        if (val > MAX_U64) {
            return null;
        }

        // the node stores the number of decimal places as a TokenDecimals,
        // which cannot hold more than 18
        if (digitsAfterDot > 18) {
            return null;
        }

        return new FundsDecimal(val, digitsAfterDot);
    }

    /**
     * Rescale this amount to the given number of decimal places.
     *
     * When the target has more decimal places, the funds are scaled up. When
     * it has fewer, the funds are scaled down, but only if that does not lose
     * precision: extra decimal places that are not zeros are rejected.
     *
     * This mirrors the node's `FundsDecimal::adjust_decimals`. It mutates
     * this instance, so call it on a copy if the original must be kept.
     *
     * @param target - The number of decimal places to rescale to
     * @returns true on success, false if the rescale would overflow or lose precision
     */
    public adjustDecimals(target: TokenDecimals): boolean {
        const vd = this.decimals.decimals;
        const newvd = target.decimals;

        if (vd < newvd) {
            let v = this.funds;
            for (let i = 0; i < newvd - vd; i++) {
                if (MAX_U64 / 10n < v) {
                    return false;
                }
                v *= 10n;
            }
            this.funds = v;
            this.decimals = target;
        } else if (vd > newvd) {
            let pow10 = 10n;
            for (let i = 1; i < vd - newvd; i++) {
                pow10 *= 10n;
            }
            const v = this.funds;
            if (v % pow10 !== 0n) {
                // would lose precision
                return false;
            }
            this.funds = v / pow10;
            this.decimals = target;
        }
        return true;
    }

    /**
     * Render the amount as a decimal string.
     *
     * The number of decimal places is always the full amount of decimal
     * places of this instance, so trailing zeros are kept: funds of 150 with 2
     * decimal places render as "1.50".
     *
     * This mirrors the node's `FundsDecimal::to_string`.
     */
    public toString(): string {
        const d = this.decimals.decimals;
        const v = this.funds;

        if (v === 0n) {
            return "0";
        }

        const s = v.toString();
        const p = s.length;

        if (d === 0) {
            return s;
        }

        if (p > d) {
            return `${s.slice(0, p - d)}.${s.slice(p - d)}`;
        }

        return `0.${"0".repeat(d - p)}${s}`;
    }
}

/**
 * Represents token amounts with specific number of decimals.
 */
export class Funds {
    amount: bigint;

    private constructor(amount: bigint) {
        this.amount = amount;
    }

    /**
     * Parse a decimal string to Funds.
     *
     * The parsed amount may have fewer decimal places than the token, in which
     * case it is scaled up. It may not have more: the node rejects an amount
     * whose decimal places exceed the token's, even when the excess places are
     * zeros.
     *
     * @param string - Decimal string (e.g., "123.45")
     * @param decimals - Token decimals
     * @returns Funds or null if invalid
     */
    public static parse(string: string, decimals: TokenDecimals): Funds | null {
        const fd = FundsDecimal.parse(string);
        if (fd === null) return null;

        // the node rejects an amount with more decimal places than the token's
        if (fd.decimals.decimals > decimals.decimals) {
            return null;
        }
        // fd is local, so this may mutate it in place
        if (!fd.adjustDecimals(decimals)) {
            return null;
        }
        return new Funds(fd.funds);
    }

    /**
     * Create Funds from a raw amount in the token's smallest units.
     *
     * The decimals are not part of a Funds: they only matter when a decimal
     * string is scaled into the token's units, which `parse` does. Use this
     * when the amount is already scaled, for example when it comes from a
     * node that reports it.
     *
     * @param amount - Amount in the token's smallest units
     * @returns Funds or null if invalid (negative or exceeds MAX_U64)
     */
    public static fromAmount(amount: bigint): Funds | null {
        if (amount < 0n || amount > MAX_U64) {
            return null;
        }
        return new Funds(amount);
    }
}

/**
 * Represents Warthog's native token (WART) with 8 decimal places.
 */
export class Wart {
    /** Amount in E8 (1 WART = 100,000,000 E8) */
    E8: bigint;

    private constructor(E8: bigint) {
        this.E8 = E8;
    }

    /**
     * Parse a decimal string to Wart.
     * @param string - Decimal string (e.g., "1.5")
     * @returns Wart or null if invalid
     */
    public static parse(string: string): Wart | null {
        const funds = Funds.parse(string, TokenDecimals.WART);
        if (funds === null) return null;
        return new Wart(funds.amount);
    }

    /**
     * Create Wart from E8 value.
     * @param E8 - Amount in E8 (1 WART = 100,000,000 E8)
     * @returns Wart or null if invalid (negative or exceeds MAX_U64)
     */
    public static fromE8(E8: bigint): Wart | null {
        if (E8 < 0n || E8 > MAX_U64) {
            return null;
        }
        return new Wart(E8);
    }

    /**
     * Render the amount as a WART decimal string.
     *
     * The amount always carries the full 8 decimal places of WART, so
     * trailing zeros are kept: 150000000 E8 renders as "1.50000000".
     */
    public toString(): string {
        return new FundsDecimal(this.E8, TokenDecimals.WART).toString();
    }

    /**
     * Convert to rounded fee.
     * @param ceil - If true, round up; otherwise round down
     * @returns RoundedFee
     */
    public roundedFee(ceil: boolean): RoundedFee {
        return RoundedFee.fromWart(this, ceil);
    }
}

/**
 * Represents liquidity pool tokens with 8 decimal places.
 * Used for liquidity deposit/withdrawal transactions.
 */
export class Liquidity {
    /** Amount in E8 (1 liquidity unit = 100,000,000 E8) */
    E8: bigint;

    private constructor(E8: bigint) {
        this.E8 = E8;
    }

    /**
     * Parse a decimal string to Liquidity.
     * @param string - Decimal string (e.g., "1.5")
     * @returns Liquidity or null if invalid
     */
    public static parse(string: string): Liquidity | null {
        const funds = Funds.parse(string, TokenDecimals.LIQUIDITY);
        if (funds === null) return null;
        return new Liquidity(funds.amount);
    }

    /**
     * Create Liquidity from E8 value.
     * @param E8 - Amount in E8 (1 liquidity = 100,000,000 E8)
     * @returns Liquidity or null if invalid (negative or exceeds MAX_U64)
     */
    public static fromE8(E8: bigint): Liquidity | null {
        if (E8 < 0n || E8 > MAX_U64) {
            return null;
        }
        return new Liquidity(E8);
    }

    /**
     * Render the amount as a liquidity decimal string.
     *
     * The amount always carries the full 8 decimal places of a liquidity
     * unit, so trailing zeros are kept: 150000000 E8 renders as "1.50000000".
     */
    public toString(): string {
        return new FundsDecimal(this.E8, TokenDecimals.LIQUIDITY).toString();
    }
}

/**
 * Transaction fee in rounded WART format.
 *
 * This is NOT the 16-bit compact representation itself. Instead, it is the result of:
 * 1. Converting WART to 16-bit compact format (CompactFee)
 * 2. Converting back to WART scale
 *
 * This is a lossy operation - the original WART value cannot be restored from RoundedFee.
 * Warthog nodes require rounded values on the 64-bit WART scale in API calls, not the
 * raw 16-bit compact representation.
 */
export class RoundedFee {
    private constructor(public readonly E8: bigint) {}

    /**
     * Create RoundedFee from Wart.
     * @param wart - Wart amount
     * @param ceil - If true, round up; otherwise round down
     * @returns RoundedFee
     */
    public static fromWart(wart: Wart, ceil: boolean): RoundedFee {
        const compactFee = CompactFee.fromWart(wart, ceil);
        const roundedWart = compactFee.toWart();
        return new RoundedFee(roundedWart.E8);
    }

    /**
     * Create RoundedFee from E8 value.
     * @param E8 - Fee in E8
     * @param ceil - If true, round up; otherwise round down
     * @returns RoundedFee or null if invalid
     */
    public static fromE8(E8: bigint, ceil: boolean): RoundedFee | null {
        const wart = Wart.fromE8(E8);
        if (wart === null) return null;
        return RoundedFee.fromWart(wart, ceil);
    }

    /**
     * Get minimum possible fee (0.00000001 WART = 1 E8).
     * @returns Minimum RoundedFee
     */
    public static min(): RoundedFee {
        return RoundedFee.fromE8(0n, false)!;
    }

    /**
     * Convert to Wart.
     * @returns Wart representation
     */
    public toWart(): Wart {
        return Wart.fromE8(this.E8)!;
    }
}

/**
 * Warthog's internal 16-bit compact fee representation.
 * Used for compact storage and transmission of transaction fees within the protocol.
 * Note: This is NOT used in transaction submission API - use RoundedFee instead.
 */
export class CompactFee {
    private constructor(public exponent: number, public mantissa: number) {}

    /**
     * Create CompactFee from Wart amount.
     * @param wart - Wart amount
     * @param ceil - If true, round up; otherwise round down
     * @returns CompactFee
     */
    public static fromWart(wart: Wart, ceil: boolean): CompactFee {
        if (wart.E8 === 0n){
            // ignore ceil and return smallest fee which corresponds to
            // 0.00000001 WART
            return new CompactFee(0, 0);
        }
        let e = 10;
        const threshold = 0x07FFn;
        let e8 = wart.E8;
        let exact = true;
        while (e8 > threshold) {
            e += 1;
            if (ceil && ((e8 & 1n) !== 0n)) {
                exact = false;
            }
            e8 >>= 1n;
        }
        if (ceil && exact === false) {
            e8 += 1n;
            if (e8 > threshold) {
                e8 >>= 1n;
                e += 1;
                if (e > 53)
                    return new CompactFee(15, 1023);
            }
        }
        while (e8 < 0x0400n) {
            e -= 1;
            e8 <<= 1n;
        }
        return new CompactFee(e, Number(e8 - 0x0400n));
    }

    /**
     * Convert CompactFee to Wart.
     * @returns Wart representation
     */
    public toWart(): Wart {
        if (this.exponent < 10) {
            return Wart.fromE8(BigInt(1024 + this.mantissa) >> BigInt(10 - this.exponent))!;
        } else {
            return Wart.fromE8(BigInt(1024 + this.mantissa) << BigInt(this.exponent - 10))!;
        }
    }
}
