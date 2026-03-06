import type { ParsedFunds } from "./ParsedFunds";
import { TokenPrecision } from "./TokenPrecision";
import { MAX_U64 } from "../utils/int";

function valueFrom(fd: ParsedFunds, precision: number): bigint | null {
    if (fd.decimalPlaces > precision) {
        return null;
    }

    const zeros = precision - fd.decimalPlaces;
    let value = fd.val;

    for (let i = 0; i < zeros; i++) {
        if (MAX_U64 / 10n < value) {
            return null;
        }
        value *= 10n;
    }

    return value;
}

export class Funds {
    amount: bigint;

    constructor(amount: bigint) {
        this.amount = amount;
    }

    public static parse(fd: ParsedFunds, digits: TokenPrecision): Funds | null {
        const value = valueFrom(fd, digits.precision);
        if (value === null) return null;
        return new Funds(value);
    }
}

export class Wart {
    amount: bigint;

    constructor(amount: bigint) {
        this.amount = amount;
    }

    public static parse(fd: ParsedFunds): Wart | null {
        const value = valueFrom(fd, 8);
        if (value === null) return null;
        return new Wart(value);
    }

    // round to fee representable value, 0 is always rounded to lowest representable fee which is 0.00000001 WART even if ceil == false
    // parameter ceil determines ceiling in rounding behavior
    public feeRounded(ceil: boolean): Wart{
        return toCompactFee(ceil).toWart();
    }

    public toCompactFee(ceil: boolean): CompactFee {
        return CompactFee.fromWart(this);
    }
}

export class CompactFee {
    constructor(public exponent: number, public mantissa: number) {}
    public static fromWart(wart: Wart, ceil: boolean): CompactFee {
        if (wart.amount === 0n)
            return new CompactFee(0, 0); // ignore ceil and return smallest fee which corresponds to 0.00000001 WART
        let e = 10;
        const threshold = 0x07FFn;
        let e8 = wart.amount;
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
        return new CompactFee(e, Number(e8));
    }
    public toWart(): Wart {
        if (this.exponent < 10) {
            return new Wart(BigInt(1024 + this.mantissa) >> BigInt(10 - this.exponent));
        } else {
            return new Wart(BigInt(1024 + this.mantissa) << BigInt(this.exponent - 10));
        }
    }
}
