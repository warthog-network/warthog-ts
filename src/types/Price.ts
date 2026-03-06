const MIN_MANTISSA = 0x8000; // 0x8000 - minimum normalized mantissa (high bit set)
const MAX_MANTISSA = 0xFFFF; // 0xFFFF - maximum mantissa (16 bits)
const MAX_EXPONENT = 0xFF;   // 0xFF - maximum exponent (8 bits)

import { frexp } from '../util/frexp';
import { TokenPrecision } from './Funds';

export class Price {
    private constructor(
        public readonly mantissa: number,  // 16 bits
        public readonly exponent: number    // 8 bits
    ) {}

    public static isMantissa(m: number): boolean {
        // Must have high bit set (normalized): 0x8000 <= m <= 0xFFFF
        return m >= MIN_MANTISSA && m <= MAX_MANTISSA;
    }

    public static isExponent(e: number): boolean {
        // Raw exponent (before +63 adjustment): 0 <= e < 128
        return e >= 0 && e < 128;
    }

    public static max(): Price {
        // Returns 0xFFFF mantissa with 0x7F exponent
        return new Price(0xFFFF, 127);
    }

    private exponentBase2(): number {
        return this.exponent - 63;
    }

    public mantissaExponent2(): number {
        return this.exponentBase2() - 16;
    }

    public toDoubleRaw(): number {
        // Equivalent to std::ldexp(m, e2) = m * 2^e2
        return this.mantissa * Math.pow(2, this.mantissaExponent2());
    }

    public toDoubleAdjusted(prec: TokenPrecision): number {
        // Compute double price respecting the asset precision
        const b10e = this.base10_precision_exponent(prec);
        return this.toDoubleRaw() * Math.pow(10, -b10e);
    }

    public base10_precision_exponent(prec: TokenPrecision): number {
        return TokenPrecision.WART.precision - prec.precision;
    }

    public static fromMantissaExponent(mantissa: number, exponent: number): Price | null {
        exponent += 63;
        if (!Price.isExponent(exponent) || !Price.isMantissa(mantissa)) {
            return null;
        }
        return new Price(mantissa, exponent);
    }

    public static fromDoubleAdjusted(d: number, basePrec: TokenPrecision, ceil: boolean = false): Price | null {
        const adjusted = d * Math.pow(10, 8 - basePrec.precision);
        return Price.fromDouble(adjusted, ceil);
    }

    public static fromDouble(d: number, ceil: boolean = false): Price | null {
        if (d <= 0 || !Number.isFinite(d)) {
            return null;
        }
        
        const [mantissa, exponent] = frexp(d);
        let mantissa32 = Math.floor(mantissa * 65536);
        let exp = exponent;
        
        const exact = (mantissa * 65536) === mantissa32;
        
        if (ceil && !exact) {
            mantissa32 += 1;
            if (mantissa32 >= 65536) { // carry
                mantissa32 >>= 1;
                exp += 1;
            }
        }
        return Price.fromMantissaExponent(mantissa32, exp);
    }

    public toHex(): string {
        const mantissaHex = this.mantissa.toString(16).padStart(4, '0');
        const exponentHex = this.exponent.toString(16).padStart(2, '0');
        return mantissaHex + exponentHex;
    }

    public static fromHex(hex: string): Price | null {
        if (hex.length !== 6) {
            return null;
        }

        const parsed = parseInt(hex, 16);
        if (isNaN(parsed)) {
            return null;
        }

        const mantissa = parsed >> 8;
        const exponent = parsed & 0xFF;

        if (mantissa > MAX_MANTISSA || exponent > MAX_EXPONENT) {
            return null;
        }

        return new Price(mantissa, exponent);
    }
}
