import { test, expect } from "bun:test";
import { Account } from "../types/Account";
import { Address } from "../types/Address";

test("Account.fromRandom generates valid address", () => {
    const addr = Account.fromRandom();
    
    expect(addr.privateKeyHex.length).toBe(64);
    expect(addr.publicKeyHex.length).toBe(66);
    expect(addr.address.hex.length).toBe(48);
    
    expect(Address.validate(addr.address.hex)).toBe(true);
});

test("Account.fromPrivateKeyHex generates correct keys from known private key", () => {
    const privateKeyHex = "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
    const addr = Account.fromPrivateKeyHex(privateKeyHex);
    
    expect(addr.privateKeyHex).toBe(privateKeyHex);
    expect(addr.publicKeyHex).toBe("02916a397088159baf27b3ce1271a859e3e6ea27db913a94086423e5867994e705");
    expect(addr.address.hex).toBe("3661579d61abde5837a8686dc4d65348a2fc61b1fe5f4093");
});

test("Address.validate returns false for invalid checksum", () => {
    const privateKeyHex = "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
    const addr = Account.fromPrivateKeyHex(privateKeyHex);
    const address = addr.address.hex;
    const invalidAddress = address.slice(0, -8) + "00000000";
    
    expect(Address.validate(invalidAddress)).toBe(false);
});

test("Address.validate returns false for wrong length", () => {
    expect(Address.validate("abc123")).toBe(false);
    expect(Address.validate("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9")).toBe(false);
});

test("Address.validate returns false for non-hex string", () => {
    // 48-character string with a non-hex character ('g') at the start.
    // Now correctly exercises the hex-decoding path, not just the length check.
    expect(Address.validate("g1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d20000")).toBe(false);
});

const KNOWN_PRIVATE_KEY =
    "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
const KNOWN_PUBLIC_KEY =
    "02916a397088159baf27b3ce1271a859e3e6ea27db913a94086423e5867994e705";

test("Account.signBytes returns a valid Signature65", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sig = account.signBytes("hello");

    expect(sig.r.length).toBe(64);
    expect(sig.s.length).toBe(64);
    expect(sig.recid).toBeGreaterThanOrEqual(0);
    expect(sig.recid).toBeLessThanOrEqual(3);
    expect(sig.signature.length).toBe(130);
    expect(/^[0-9a-f]+$/.test(sig.signature)).toBe(true);
});

/**
 * Pinned RFC 6979 signature vectors for KNOWN_PRIVATE_KEY.
 *
 * The digests are the SHA-256 of the message, the signatures are the
 * deterministic (r || s || recid) values. The third vector deliberately uses a
 * message whose digest starts with a zero byte: that is the input class where
 * a faulty nonce truncation (see CVE-2025-14505 in elliptic) produces a
 * signature that is nearly, but not exactly, correct.
 *
 * These vectors were produced by the previous elliptic-based implementation
 * and are byte-identical to the current output, so they pin the wire format
 * of the signing path.
 */
const PINNED_VECTORS = [
    {
        name: "plain message",
        message: "hello",
        digest:
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        r: "dbeafb9b24ddf7d24c0bf82f078bf2ecc068654eb4873e3c74814543dd65ef49",
        s: "711681c2dc77d895a78aea9485189758226f9cefd8091b830961c3f09ef80f90",
        recid: 1,
        signature:
            "dbeafb9b24ddf7d24c0bf82f078bf2ecc068654eb4873e3c74814543dd65ef49711681c2dc77d895a78aea9485189758226f9cefd8091b830961c3f09ef80f9001",
    },
    {
        name: "empty message",
        message: "",
        digest:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        r: "ce84cb32ec1c4aca7e8794124303ff7bc0de08864aee6acbf66df1ce757a7b82",
        s: "3f0a1154a8e8ba7fff32ea3fadd883fa10cc532d41f5d60def06dd9d963c5e02",
        recid: 0,
        signature:
            "ce84cb32ec1c4aca7e8794124303ff7bc0de08864aee6acbf66df1ce757a7b823f0a1154a8e8ba7fff32ea3fadd883fa10cc532d41f5d60def06dd9d963c5e0200",
    },
    {
        name: "message with a leading zero digest byte",
        message: "warthog-leading-zero-264",
        digest:
            "0049704e969839bd144391b75529b632f76923764a850381952da58ed342f067",
        r: "0ddfd65fe9031ede0e40df065b5a686b29907058e2d15d9c9b2418194464d99b",
        s: "63e40acfb3f62dab3eb0b4a93d857a52c1227be852fad81335eab417da39f694",
        recid: 0,
        signature:
            "0ddfd65fe9031ede0e40df065b5a686b29907058e2d15d9c9b2418194464d99b63e40acfb3f62dab3eb0b4a93d857a52c1227be852fad81335eab417da39f69400",
    },
];

test("Account.signBytes matches the pinned RFC 6979 vectors", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);

    for (const vector of PINNED_VECTORS) {
        const sig = account.signBytes(vector.message);

        expect(sig.r).toBe(vector.r);
        expect(sig.s).toBe(vector.s);
        expect(sig.recid).toBe(vector.recid);
        expect(sig.signature).toBe(vector.signature);
    }
});

test("Account.recoverPublicKey recovers the pinned RFC 6979 vectors", () => {
    for (const vector of PINNED_VECTORS) {
        expect(Account.recoverPublicKey(vector.message, vector.signature)).toBe(
            KNOWN_PUBLIC_KEY
        );
    }
});

test("Account.fromPrivateKeyHex zero-pads a short private key", () => {
    const account = Account.fromPrivateKeyHex("abc");

    expect(account.privateKeyHex).toBe("0".repeat(61) + "abc");
    expect(account.publicKeyHex.length).toBe(66);
});

test("Account.fromPrivateKeyHex rejects a non-hex private key", () => {
    expect(() => Account.fromPrivateKeyHex("zz")).toThrow();
});

test("Account.signBytes is deterministic for the same input", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sig1 = account.signBytes("hello");
    const sig2 = account.signBytes("hello");

    expect(sig1.signature).toBe(sig2.signature);
});

test("Account.signBytes treats string and Uint8Array equivalently", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sigStr = account.signBytes("hello");
    const sigBuf = account.signBytes(Buffer.from("hello", "utf8"));

    expect(sigBuf.signature).toBe(sigStr.signature);
});

test("Account.signBytes works on empty input", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sig = account.signBytes("");

    expect(sig.r.length).toBe(64);
    expect(sig.s.length).toBe(64);
    expect(sig.recid).toBeGreaterThanOrEqual(0);
    expect(sig.recid).toBeLessThanOrEqual(3);
});

test("Account.recoverAddress round-trips a signBytes signature", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sig = account.signBytes("hello");

    const recovered = Account.recoverAddress("hello", sig);

    expect(recovered.hex).toBe(account.address.hex);
});

test("Account.recoverPublicKey round-trips a signBytes signature", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sig = account.signBytes("hello");

    const recovered = Account.recoverPublicKey("hello", sig);

    expect(recovered).toBe(KNOWN_PUBLIC_KEY);
});

test("Account.recoverPublicKey returns a different key for a tampered message", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sig = account.signBytes("hello");

    const tampered = Account.recoverPublicKey("hellp", sig);

    expect(tampered).not.toBe(account.publicKeyHex);
});

test("Account.recoverPublicKey is sensitive to the recovery id", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sig = account.signBytes("hello");

    const flipped = sig.signature.slice(0, 128) +
        ((sig.recid ^ 1) & 0xff).toString(16).padStart(2, "0");

    const recovered = Account.recoverPublicKey("hello", flipped);

    expect(recovered).not.toBe(account.publicKeyHex);
});

test("Account.recoverPublicKey accepts the 130-char hex signature string", () => {
    const account = Account.fromPrivateKeyHex(KNOWN_PRIVATE_KEY);
    const sig = account.signBytes("hello");

    const recovered = Account.recoverPublicKey("hello", sig.signature);

    expect(recovered).toBe(account.publicKeyHex);
});

test("Account.recoverPublicKey throws on an invalid signature string", () => {
    expect(() => Account.recoverPublicKey("hello", "abcd")).toThrow();
    expect(() =>
        Account.recoverPublicKey(
            "hello",
            "z".repeat(130)
        )
    ).toThrow();
    expect(() =>
        Account.recoverPublicKey(
            "hello",
            "ff".repeat(65)
        )
    ).toThrow();
});
