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

test("ParsedFunds parses 101.123000 into val=101123000 and decimalPlaces=6", () => {
    const s = "101.123000";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(101123000n);
    expect(pf!.decimalPlaces).toBe(6);
});

test("Funds.parse for parsed 101.123000 at precisions 0, 4, 12, 16", () => {
    const s = "101.123000";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();

    // Funds_uint64(pf, 0): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(0))).toBeNull();

    // Funds_uint64(pf, 4): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(4))).toBeNull();

    // Funds_uint64(pf, 12) = 101123000000000
    const f12 = Funds.parse(pf!, new TokenPrecision(12));
    expect(f12).not.toBeNull();
    expect(f12!.amount).toBe(101123000000000n);

    // Funds_uint64(pf, 16) = 1011230000000000000
    const f16 = Funds.parse(pf!, new TokenPrecision(16));
    expect(f16).not.toBeNull();
    expect(f16!.amount).toBe(1011230000000000000n);
});

test("ParsedFunds parses 101.1230001111 into val=1011230001111 and decimalPlaces=10", () => {
    const s = "101.1230001111";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(1011230001111n);
    expect(pf!.decimalPlaces).toBe(10);
});

test("Funds.parse for parsed 101.1230001111 at precisions 0, 4, 12, 16", () => {
    const s = "101.1230001111";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();

    // Funds_uint64(pf, 0): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(0))).toBeNull();

    // Funds_uint64(pf, 4): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(4))).toBeNull();

    // Funds_uint64(pf, 12) = 101123000111100
    const f12 = Funds.parse(pf!, new TokenPrecision(12));
    expect(f12).not.toBeNull();
    expect(f12!.amount).toBe(101123000111100n);

    // Funds_uint64(pf, 16) = 1011230001111000000
    const f16 = Funds.parse(pf!, new TokenPrecision(16));
    expect(f16).not.toBeNull();
    expect(f16!.amount).toBe(1011230001111000000n);
});

test("ParsedFunds parses 101.00000000000000 into val=10100000000000000 and decimalPlaces=14", () => {
    const s = "101.00000000000000";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(10100000000000000n);
    expect(pf!.decimalPlaces).toBe(14);
});

test("Funds.parse for parsed 101.00000000000000 at precisions 0, 4, 12, 16", () => {
    const s = "101.00000000000000";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();

    // Funds_uint64(pf, 0): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(0))).toBeNull();

    // Funds_uint64(pf, 4): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(4))).toBeNull();

    // Funds_uint64(pf, 12): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(12))).toBeNull();

    // Funds_uint64(pf, 16) = 1010000000000000000
    const f16 = Funds.parse(pf!, new TokenPrecision(16));
    expect(f16).not.toBeNull();
    expect(f16!.amount).toBe(1010000000000000000n);
});

test("ParsedFunds parses 123123101.001 into val=123123101001 and decimalPlaces=3", () => {
    const s = "123123101.001";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(123123101001n);
    expect(pf!.decimalPlaces).toBe(3);
});

test("Funds.parse for parsed 123123101.001 at precisions 0, 4, 12, 16", () => {
    const s = "123123101.001";
    const pf = ParsedFunds.parse(s);

    expect(pf).not.toBeNull();

    // Funds_uint64(pf, 0): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(0))).toBeNull();

    // Funds_uint64(pf, 4) = 1231231010010
    const f4 = Funds.parse(pf!, new TokenPrecision(4));
    expect(f4).not.toBeNull();
    expect(f4!.amount).toBe(1231231010010n);

    // Funds_uint64(pf, 12): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(12))).toBeNull();

    // Funds_uint64(pf, 16): <no value>
    expect(Funds.parse(pf!, new TokenPrecision(16))).toBeNull();
});
