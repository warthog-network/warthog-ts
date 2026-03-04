import { test, expect } from "bun:test";
import { Address } from "../types/Address";

test("Address.fromRandom generates valid address", () => {
    const addr = Address.fromRandom();
    
    expect(addr.getPrivateKey().length).toBe(64);
    expect(addr.getPublicKey().length).toBe(66);
    expect(addr.getAddress().length).toBe(48);
    
    expect(Address.validate(addr.getAddress())).toBe(true);
});

test("Address.fromPrivateKey generates correct keys from known private key", () => {
    const privateKeyHex = "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
    const addr = Address.fromPrivateKey(privateKeyHex);
    
    expect(addr.getPrivateKey()).toBe(privateKeyHex);
    expect(addr.getPublicKey()).toBe("02916a397088159baf27b3ce1271a859e3e6ea27db913a94086423e5867994e705");
    expect(addr.getAddress()).toBe("3661579d61abde5837a8686dc4d65348a2fc61b1fe5f4093");
});

test("Address.fromPrivateKey with leading zeros padding", () => {
    const privateKeyHex = "0000000000000000000000000000000000000000000000000000000000000001";
    const addr = Address.fromPrivateKey(privateKeyHex);
    
    expect(addr.getPrivateKey()).toBe(privateKeyHex);
    expect(addr.getPublicKey().length).toBe(66);
    expect(addr.getAddress().length).toBe(48);
});

test("Address.validate returns true for valid address", () => {
    const addr = Address.fromRandom();
    const address = addr.getAddress();
    
    expect(Address.validate(address)).toBe(true);
});

test("Address.validate returns false for invalid checksum", () => {
    const privateKeyHex = "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
    const addr = Address.fromPrivateKey(privateKeyHex);
    const address = addr.getAddress();
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

test("Multiple addresses from same private key are identical", () => {
    const privateKeyHex = "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
    
    const addr1 = Address.fromPrivateKey(privateKeyHex);
    const addr2 = Address.fromPrivateKey(privateKeyHex);
    
    expect(addr1.getPrivateKey()).toBe(addr2.getPrivateKey());
    expect(addr1.getPublicKey()).toBe(addr2.getPublicKey());
    expect(addr1.getAddress()).toBe(addr2.getAddress());
});
