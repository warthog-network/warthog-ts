import { test, expect } from "bun:test";
import { ChainPin } from "../types/ChainPin";
import { ChainHead, WarthogDeFiApi, WarthogLegacyApi } from "../types/Api";
import { Account } from "../types/Account";
import { Address } from "../types/Address";
import { NonceId } from "../types/NonceId";
import { RoundedFee, Wart } from "../types/Funds";

const PIN_HASH = "a".repeat(64);
const CHAIN_HASH = "b".repeat(64);

// Shape emitted by core/defi (glaze auto-serialization nests the struct).
const V2_PAYLOAD = {
    chainHead: {
        hash: CHAIN_HASH,
        height: 1949776,
        pinHash: PIN_HASH,
        pinHeight: 1949760,
        hashrate: 140000000000000,
    },
    synced: true,
};

// Shape emitted by core/master and core/dev (hand-written to_json flattens).
const V1_PAYLOAD = {
    hash: CHAIN_HASH,
    height: 1949776,
    pinHash: PIN_HASH,
    pinHeight: 1949760,
    synced: true,
};

// --- ChainPin.parse ---------------------------------------------------------

test("ChainPin.parse reads the nested V2 payload", () => {
    expect(ChainPin.parse(V2_PAYLOAD, "v2")).toEqual(
        new ChainPin(PIN_HASH, 1949760),
    );
});

test("ChainPin.parse reads the flat V1 payload", () => {
    expect(ChainPin.parse(V1_PAYLOAD, "v1")).toEqual(
        new ChainPin(PIN_HASH, 1949760),
    );
});

test("ChainPin.parse returns null when the payload is the wrong generation", () => {
    // The shapes are not interchangeable.
    expect(ChainPin.parse(V2_PAYLOAD, "v1")).toBeNull();
    expect(ChainPin.parse(V1_PAYLOAD, "v2")).toBeNull();
});

test("ChainPin.parse returns null for absent or malformed payloads", () => {
    for (const bad of [undefined, null, "garbage", 42, [], {}]) {
        expect(ChainPin.parse(bad, "v1")).toBeNull();
        expect(ChainPin.parse(bad, "v2")).toBeNull();
    }
});

// --- ChainPin.validate ------------------------------------------------------

test("ChainPin.validate enforces the protocol invariants", () => {
    // Pin heights are always multiples of 32 (1-byte relative pin).
    expect(ChainPin.validate(PIN_HASH, 1949760)).toBe(true); // 1949760 % 32 === 0
    expect(ChainPin.validate(PIN_HASH, 1949761)).toBe(false); // not a multiple
    expect(ChainPin.validate(PIN_HASH, 32)).toBe(true);
    expect(ChainPin.validate(PIN_HASH, 0)).toBe(true);

    // Wrong hash length, wrong types, non-finite numbers.
    expect(ChainPin.validate("abc", 32)).toBe(false);
    expect(ChainPin.validate("a".repeat(65), 32)).toBe(false);
    expect(ChainPin.validate(PIN_HASH, 32.5)).toBe(false); // not an integer
    expect(ChainPin.validate(PIN_HASH, NaN)).toBe(false);
    expect(ChainPin.validate(PIN_HASH, Infinity)).toBe(false);
    expect(ChainPin.validate(PIN_HASH, "32")).toBe(false);
    expect(ChainPin.validate(123, 32)).toBe(false);
    expect(ChainPin.validate(PIN_HASH, null)).toBe(false);
});

// --- ChainHead.parse --------------------------------------------------------

test("ChainHead.parse reads the nested V2 payload", () => {
    const head = ChainHead.parse(V2_PAYLOAD, "v2");
    expect(head).not.toBeNull();
    expect(head!.pin).toEqual(new ChainPin(PIN_HASH, 1949760));
    expect(head!.hash).toBe(CHAIN_HASH);
    expect(head!.height).toBe(1949776);
    expect(head!.synced).toBe(true);
});

test("ChainHead.parse reads the flat V1 payload", () => {
    const head = ChainHead.parse(V1_PAYLOAD, "v1");
    expect(head).not.toBeNull();
    expect(head!.pin).toEqual(new ChainPin(PIN_HASH, 1949760));
    expect(head!.hash).toBe(CHAIN_HASH);
    expect(head!.height).toBe(1949776);
    expect(head!.synced).toBe(true);
});

test("ChainHead returns identical values for both generations", () => {
    // Same network, two serializers — the normalized view must not differ.
    const v1 = ChainHead.parse(V1_PAYLOAD, "v1")!;
    const v2 = ChainHead.parse(V2_PAYLOAD, "v2")!;
    expect(v2.pin.pinHash).toBe(v1.pin.pinHash);
    expect(v2.pin.pinHeight).toBe(v1.pin.pinHeight);
    expect(v2.height).toBe(v1.height);
    expect(v2.synced).toBe(v1.synced);
});

test("ChainHead.parse returns null when the payload is the wrong generation", () => {
    expect(ChainHead.parse(V2_PAYLOAD, "v1")).toBeNull();
    expect(ChainHead.parse(V1_PAYLOAD, "v2")).toBeNull();
});

test("ChainHead.parse reports an unsynced node without failing", () => {
    expect(ChainHead.parse({ ...V1_PAYLOAD, synced: false }, "v1")!.synced).toBe(false);
});

test("ChainHead.parse returns null when hash or height is missing", () => {
    const noHash = { ...V1_PAYLOAD, hash: undefined };
    const noHeight = { ...V1_PAYLOAD, height: undefined };
    expect(ChainHead.parse(noHash, "v1")).toBeNull();
    expect(ChainHead.parse(noHeight, "v1")).toBeNull();
});

test("ChainHead enforces height >= pinHeight", () => {
    // The tip always runs at or ahead of the last valid pin.
    const ahead = ChainHead.parse(
        { ...V1_PAYLOAD, height: 1949776, pinHeight: 1949760 },
        "v1",
    )!;
    expect(ahead.height).toBeGreaterThanOrEqual(ahead.pin.pinHeight);
});

// --- The two node clients ----------------------------------------------------

/** Serve one chain head payload and hand back the original fetch. */
async function withChainHead(
    payload: unknown,
    run: () => Promise<void>,
): Promise<void> {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
        new Response(JSON.stringify({ code: 0, data: payload }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch;
    try {
        await run();
    } finally {
        globalThis.fetch = original;
    }
}

test("the legacy client reads the flat chain head", async () => {
    await withChainHead(V1_PAYLOAD, async () => {
        const api = new WarthogLegacyApi("http://node.test");
        const result = await api.getChainHead();

        expect(result.success).toBe(true);
        expect(result.success && result.data.pin).toEqual(
            new ChainPin(PIN_HASH, 1949760),
        );
    });
});

test("the DeFi client reads the nested chain head", async () => {
    await withChainHead(V2_PAYLOAD, async () => {
        const api = new WarthogDeFiApi("http://node.test");
        const result = await api.getChainHead();

        expect(result.success).toBe(true);
        expect(result.success && result.data.pin).toEqual(
            new ChainPin(PIN_HASH, 1949760),
        );
    });
});

test("neither client reads the other generation's chain head", async () => {
    await withChainHead(V2_PAYLOAD, async () => {
        const result = await new WarthogLegacyApi("http://node.test").getChainHead();
        expect(result.success).toBe(false);
        expect(!result.success && result.error).toContain("Invalid v1");
    });

    await withChainHead(V1_PAYLOAD, async () => {
        const result = await new WarthogDeFiApi("http://node.test").getChainHead();
        expect(result.success).toBe(false);
        expect(!result.success && result.error).toContain("Invalid v2");
    });
});

test("the legacy client builds a legacy context", async () => {
    await withChainHead(V1_PAYLOAD, async () => {
        const api = new WarthogLegacyApi("http://node.test");
        const context = await api.createTransactionContext(
            RoundedFee.min(),
            NonceId.fromNumber(1)!,
        );

        const tx = context.transferWart(
            Account.fromPrivateKeyHex(
                "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0",
            ),
            Address.fromHex("0000000000000000000000000000000000000000de47c9b2")!,
            Wart.fromE8(100000000n)!,
        );

        expect(tx.amountE8).toBe(100000000n);
        expect("wartE8" in tx).toBe(false);
    });
});

test("the DeFi client builds a DeFi context", async () => {
    await withChainHead(V2_PAYLOAD, async () => {
        const api = new WarthogDeFiApi("http://node.test");
        const context = await api.createTransactionContext(
            RoundedFee.min(),
            NonceId.fromNumber(1)!,
        );

        const tx = context.transferWart(
            Account.fromPrivateKeyHex(
                "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0",
            ),
            Address.fromHex("0000000000000000000000000000000000000000de47c9b2")!,
            Wart.fromE8(100000000n)!,
        );

        expect(tx.wartE8).toBe(100000000n);
        expect("amountE8" in tx).toBe(false);
    });
});