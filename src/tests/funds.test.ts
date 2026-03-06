import { test, expect } from "bun:test";
import { Funds, ParsedFunds, TokenPrecision, Wart, CompactFee } from "../types/Funds";

// Token Precision tests
test("TokenPrecision rejects invalid precision", () => {
    expect(() => new TokenPrecision(-1)).toThrow();
    expect(() => new TokenPrecision(19)).toThrow();
});

// ParsedFunds tests
test("ParsedFunds.parse valid input", () => {
    const pf = ParsedFunds.parse("1.123");
    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(1123n);
    expect(pf!.decimalPlaces).toBe(3);
});
test("ParsedFunds.parse 101.123000", () => {
    const pf = ParsedFunds.parse("101.123000");
    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(101123000n);
    expect(pf!.decimalPlaces).toBe(6);
});
test("ParsedFunds.parse 101.1230001111", () => {
    const pf = ParsedFunds.parse("101.1230001111");
    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(1011230001111n);
    expect(pf!.decimalPlaces).toBe(10);
});
test("ParsedFunds.parse 101.00000000000000", () => {
    const pf = ParsedFunds.parse("101.00000000000000");
    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(10100000000000000n);
    expect(pf!.decimalPlaces).toBe(14);
});
test("ParsedFunds.parse 123123101.001", () => {
    const pf = ParsedFunds.parse("123123101.001");
    expect(pf).not.toBeNull();
    expect(pf!.val).toBe(123123101001n);
    expect(pf!.decimalPlaces).toBe(3);
});
test("ParsedFunds.parse invalid inputs", () => {
    expect(ParsedFunds.parse("")).toBeNull();
    expect(ParsedFunds.parse(".")).toBeNull();
    expect(ParsedFunds.parse("abc")).toBeNull();
    expect(ParsedFunds.parse("1.1.1")).toBeNull();
    expect(ParsedFunds.parse("123456789012345678901")).toBeNull();
    expect(ParsedFunds.parse("18446744073709551616")).toBeNull();
});

// Funds tests
test("Funds.parse valid string input", () => {
    const f = Funds.parse("1.123", new TokenPrecision(4));
    expect(f).not.toBeNull();
    expect(f!.amount).toBe(11230n);
});
test("Funds.parse invalid due to precision", () => {
    const f = Funds.parse("1.123", new TokenPrecision(2));
    expect(f).toBeNull();
});
test("Funds.fromParsedFunds", () => {
    const pf = new ParsedFunds(1123n, 3);
    const f = Funds.fromParsedFunds(pf, new TokenPrecision(4));
    expect(f).not.toBeNull();
    expect(f!.amount).toBe(11230n);
});
test("Funds.fromParsedFunds (uint64 conversion behavior) for parsed 1.123 at precisions 0, 4, 12, 16", () => {
    const s = "1.123";
    const pf = ParsedFunds.parse(s);
    expect(pf).not.toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(0))).toBeNull();
    const f4 = Funds.fromParsedFunds(pf!, new TokenPrecision(4));
    expect(f4).not.toBeNull();
    expect(f4!.amount).toBe(11230n);
    const f12 = Funds.fromParsedFunds(pf!, new TokenPrecision(12));
    expect(f12).not.toBeNull();
    expect(f12!.amount).toBe(1123000000000n);
    const f16 = Funds.fromParsedFunds(pf!, new TokenPrecision(16));
    expect(f16).not.toBeNull();
    expect(f16!.amount).toBe(11230000000000000n);
});
test("Funds.fromParsedFunds for parsed 101.123000 at precisions 0, 4, 12, 16", () => {
    const s = "101.123000";
    const pf = ParsedFunds.parse(s);
    expect(pf).not.toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(0))).toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(4))).toBeNull();
    const f12 = Funds.fromParsedFunds(pf!, new TokenPrecision(12));
    expect(f12).not.toBeNull();
    expect(f12!.amount).toBe(101123000000000n);
    const f16 = Funds.fromParsedFunds(pf!, new TokenPrecision(16));
    expect(f16).not.toBeNull();
    expect(f16!.amount).toBe(1011230000000000000n);
});
test("Funds.fromParsedFunds for parsed 101.1230001111 at precisions 0, 4, 12, 16", () => {
    const s = "101.1230001111";
    const pf = ParsedFunds.parse(s);
    expect(pf).not.toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(0))).toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(4))).toBeNull();
    const f12 = Funds.fromParsedFunds(pf!, new TokenPrecision(12));
    expect(f12).not.toBeNull();
    expect(f12!.amount).toBe(101123000111100n);
    const f16 = Funds.fromParsedFunds(pf!, new TokenPrecision(16));
    expect(f16).not.toBeNull();
    expect(f16!.amount).toBe(1011230001111000000n);
});
test("Funds.fromParsedFunds for parsed 101.00000000000000 at precisions 0, 4, 12, 16", () => {
    const s = "101.00000000000000";
    const pf = ParsedFunds.parse(s);
    expect(pf).not.toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(0))).toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(4))).toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(12))).toBeNull();
    const f16 = Funds.fromParsedFunds(pf!, new TokenPrecision(16));
    expect(f16).not.toBeNull();
    expect(f16!.amount).toBe(1010000000000000000n);
});
test("Funds.fromParsedFunds for parsed 123123101.001 at precisions 0, 4, 12, 16", () => {
    const s = "123123101.001";
    const pf = ParsedFunds.parse(s);
    expect(pf).not.toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(0))).toBeNull();
    const f4 = Funds.fromParsedFunds(pf!, new TokenPrecision(4));
    expect(f4).not.toBeNull();
    expect(f4!.amount).toBe(1231231010010n);
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(12))).toBeNull();
    expect(Funds.fromParsedFunds(pf!, new TokenPrecision(16))).toBeNull();
});

// Wart tests
test("Wart.parse valid input", () => {
    const w = Wart.parse("1.123");
    expect(w).not.toBeNull();
    expect(w!.E8).toBe(112300000n);
});
test("Wart.parse invalid due to too many decimals", () => {
    expect(Wart.parse("1.123456789")).toBeNull();
});

test("CompactFee.fromWart amount=0 returns smallest fee", () => {
    const w = new Wart(0n);
    const w1 = new Wart(1n);
    expect(w.feeRounded(false).E8).toBe(1n);
});

test("Fee rounding", () => {
    const check_rounding = (s: string) => {
        const original = Wart.parse(s);
        expect(original).not.toBeNull();

        // round down
        const roundedDown = original!.feeRounded(false);
        expect(roundedDown.E8).toBeLessThanOrEqual(original!.E8);
        expect(roundedDown.E8).toBe(roundedDown.feeRounded(true).E8);
        expect(roundedDown.E8).toBe(roundedDown.feeRounded(false).E8);

        // round up
        const roundedUp = original!.feeRounded(true);
        expect(roundedUp.E8).toBeGreaterThanOrEqual(original!.E8);
        expect(roundedUp.E8).toBe(roundedUp.feeRounded(true).E8);
        expect(roundedUp.E8).toBe(roundedUp.feeRounded(false).E8);
    }
    check_rounding(".00003112");
    check_rounding(".00013112");
    check_rounding(".00113112");
    check_rounding(".0111283");
    check_rounding(".32");
    check_rounding("5.12354");
    check_rounding("10.02031022");
});

