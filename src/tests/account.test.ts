import { test, expect } from "bun:test";
import { Account } from "../types/Account";
import { Address } from "../types/Address";

test("Account.fromRandom generates valid address", () => {
    const addr = Account.fromRandom();
    
    expect(addr.getPrivateKeyHex().length).toBe(64);
    expect(addr.getPublicKeyHex().length).toBe(66);
    expect(addr.getAddress().hex.length).toBe(48);
    
    expect(Address.validate(addr.getAddress().hex)).toBe(true);
});

test("Account.fromPrivateKeyHex generates correct keys from known private key", () => {
    const privateKeyHex = "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
    const addr = Account.fromPrivateKeyHex(privateKeyHex);
    
    expect(addr.getPrivateKeyHex()).toBe(privateKeyHex);
    expect(addr.getPublicKeyHex()).toBe("02916a397088159baf27b3ce1271a859e3e6ea27db913a94086423e5867994e705");
    expect(addr.getAddress().hex).toBe("3661579d61abde5837a8686dc4d65348a2fc61b1fe5f4093");
});

test("Address.validate returns false for invalid checksum", () => {
    const privateKeyHex = "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
    const addr = Account.fromPrivateKeyHex(privateKeyHex);
    const address = addr.getAddress().hex;
    const invalidAddress = address.slice(0, -8) + "00000000";
    
    expect(Address.validate(invalidAddress)).toBe(false);
});

test("Address.validate returns false for wrong length", () => {
    expect(Address.validate("abc123")).toBe(false);
    expect(Address.validate("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9")).toBe(false);
});

test("Address.validate returns false for non-hex string", () => {
    expect(Address.validate("g1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2")).toBe(false);
});
