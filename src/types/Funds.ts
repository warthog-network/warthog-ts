export const MAX_U64 = 0xffffffffffffffffn;


// Class to represent Warthog's token precision
export class TokenPrecision {
    constructor(public precision: number) {
        if (precision < 0 || precision > 18) {
            throw new Error("Invalid precision");
        }
    }
}

// Class to represent a parsed string as a 64 bit integer with information about the
// decimals
export class ParsedFunds {
    val: bigint;
    decimalPlaces: number;

    constructor(val: bigint, decimalPlaces: number) {
        this.val = val;
        this.decimalPlaces = decimalPlaces;
    }

    public static parse(s: string): ParsedFunds | null {
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

        return new ParsedFunds(val, digitsAfterDot);
    }
}

// Helper function used in Funds and Wart
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

// Class to represent token amounts
export class Funds {
    amount: bigint;

    constructor(amount: bigint) {
        this.amount = amount;
    }

    public static parse(string: string, digits: TokenPrecision): Funds | null {
        const fd = ParsedFunds.parse(string);
        if (fd === null) return null;
        return Funds.fromParsedFunds(fd, digits);
    }
    public static fromParsedFunds(fd: ParsedFunds, digits: TokenPrecision): Funds | null {
        const value = valueFrom(fd, digits.precision);
        if (value === null) return null;
        return new Funds(value);
    }
}

// Class to represent Wart amounts
export class Wart {
    amount: bigint;

    constructor(amount: bigint) {
        this.amount = amount;
    }

    public static parse(string: string): Wart | null {
        const fd = ParsedFunds.parse(string);
        if (fd === null) return null;
        return Wart.fromParsedFunds(fd);
    }
    public static fromParsedFunds(fd: ParsedFunds): Wart | null {
        const value = valueFrom(fd, 8);
        if (value === null) return null;
        return new Wart(value);
    }

    // round to fee representable value, 0 is always rounded to lowest
    // representable fee which is 0.00000001 WART even if ceil == false
    // parameter ceil determines ceiling in rounding behavior
    public feeRounded(ceil: boolean): Wart {
        return this.toCompactFee(ceil).toWart();
    }

    // round to Warthog's internal 16 bit representation
    public toCompactFee(ceil: boolean): CompactFee {
        return CompactFee.fromWart(this, ceil);
    }
}

// Class to represent Warthog's internal fee representation in 16 bits
export class CompactFee {
    private constructor(public exponent: number, public mantissa: number) {}
    public static fromWart(wart: Wart, ceil: boolean): CompactFee {
        if (wart.amount === 0n){
            // ignore ceil and return smallest fee which corresponds to
            // 0.00000001 WART
            return new CompactFee(0, 0);
        }
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
        return new CompactFee(e, Number(e8 - 0x0400n));
    }
    public toWart(): Wart {
        if (this.exponent < 10) {
            return new Wart(BigInt(1024 + this.mantissa) >> BigInt(10 - this.exponent));
        } else {
            return new Wart(BigInt(1024 + this.mantissa) << BigInt(this.exponent - 10));
        }
    }
}
