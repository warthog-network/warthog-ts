import { test, expect } from "bun:test";
import { Funds } from "../types/Funds";
import { ParsedFunds } from "../types/ParsedFunds";
import { TokenPrecision } from "../types/TokenPrecision";

test("ParsedFunds parses 1.123 into val=1123 and decimalPlaces=3", () => {
    const s = "1.123";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(1123n);
    expect(pf!.decimalPlaces).toBe(3);
});

test("Funds.parse (uint64 conversion behavior) for parsed 1.123 at precisions 0, 4, 12, 16", () => {
    const s = "1.123";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();

    // Funds_uint64(pf, 0): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(0))).toBeNull();

    // Funds_uint64(pf, 4) = 11230
    const f4 = Funds.parse(pf!, new TokenPrecision(4));
    expect(f4).not.toBeNull();
    expect(f4!.amount).toBe(11230n);

    // Funds_uint64(pf, 12) = 1123000000000
    const f12 = Funds.parse(pf!, new TokenPrecision(12));
    expect(f12).not.toBeNull();
    expect(f12!.amount).toBe(1123000000000n);

    // Funds_uint64(pf, 16) = 11230000000000000
    const f16 = Funds.parse(pf!, new TokenPrecision(16));
    expect(f16).not.toBeNull();
    expect(f16!.amount).toBe(11230000000000000n);
});
