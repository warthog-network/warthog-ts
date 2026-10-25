import { test, expect } from "bun:test";
import { ChainPin } from "../types/ChainPin";
import { ChainHead, WarthogDeFiApi, WarthogLegacyApi } from "../types/Api";
import { Account } from "../types/Account";
import { Address } from "../types/Address";
import { NonceId } from "../types/NonceId";
import { RoundedFee, Wart } from "../types/Funds";
import { NodeVersion } from "../types/NodeVersion";

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

// --- NodeVersion -------------------------------------------------------------

// The version payload. Every node family reports these five fields in this
// flat shape, so one fixture covers all of them.
const VERSION_PAYLOAD = {
    name: 'v0.10.3 "dd054a2"',
    major: 0,
    minor: 10,
    patch: 3,
    commit: "dd054a2",
};

test("NodeVersion.parse reads the version fields", () => {
    const version = NodeVersion.parse(VERSION_PAYLOAD);

    expect(version).not.toBeNull();
    expect(version!.name).toBe('v0.10.3 "dd054a2"');
    expect(version!.major).toBe(0);
    expect(version!.minor).toBe(10);
    expect(version!.patch).toBe(3);
    expect(version!.commit).toBe("dd054a2");
});

test("NodeVersion exposes the version as a dotted triple", () => {
    expect(NodeVersion.parse(VERSION_PAYLOAD)!.version).toBe("0.10.3");
});

test("NodeVersion.parse returns null when a field is missing", () => {
    for (const field of ["name", "major", "minor", "patch", "commit"]) {
        const payload: Record<string, unknown> = { ...VERSION_PAYLOAD };
        delete payload[field];
        expect(NodeVersion.parse(payload)).toBeNull();
    }
});

test("NodeVersion.parse returns null when a field has the wrong type", () => {
    expect(NodeVersion.parse({ ...VERSION_PAYLOAD, name: 42 })).toBeNull();
    expect(NodeVersion.parse({ ...VERSION_PAYLOAD, commit: 42 })).toBeNull();
    expect(NodeVersion.parse({ ...VERSION_PAYLOAD, major: "0" })).toBeNull();
    expect(NodeVersion.parse({ ...VERSION_PAYLOAD, minor: "10" })).toBeNull();
    expect(NodeVersion.parse({ ...VERSION_PAYLOAD, patch: "3" })).toBeNull();
});

test("NodeVersion.parse returns null for absent or malformed payloads", () => {
    for (const bad of [undefined, null, "garbage", 42, [], {}]) {
        expect(NodeVersion.parse(bad)).toBeNull();
    }
});

// --- The node version endpoint -----------------------------------------------

/** Serve one payload, recording the URL that was requested. */
async function withPayload(
    payload: unknown,
    run: (requestedUrls: string[]) => Promise<void>,
): Promise<void> {
    const original = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ code: 0, data: payload }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }) as unknown as typeof fetch;
    try {
        await run(requestedUrls);
    } finally {
        globalThis.fetch = original;
    }
}

test("the legacy client reads the version from /tools/version", async () => {
    await withPayload(VERSION_PAYLOAD, async (urls) => {
        const api = new WarthogLegacyApi("http://node.test");
        const result = await api.getNodeVersion();

        expect(urls).toEqual(["http://node.test/tools/version"]);
        expect(result.success).toBe(true);
        expect(result.success && result.data.version).toBe("0.10.3");
    });
});

test("the DeFi client reads the version from /version", async () => {
    await withPayload(VERSION_PAYLOAD, async (urls) => {
        const api = new WarthogDeFiApi("http://node.test");
        const result = await api.getNodeVersion();

        expect(urls).toEqual(["http://node.test/version"]);
        expect(result.success).toBe(true);
        expect(result.success && result.data.version).toBe("0.10.3");
    });
});

test("both clients read the same version payload identically", async () => {
    await withPayload(VERSION_PAYLOAD, async () => {
        const legacy = await new WarthogLegacyApi("http://node.test").getNodeVersion();
        const defi = await new WarthogDeFiApi("http://node.test").getNodeVersion();

        expect(legacy.success).toBe(true);
        expect(defi.success).toBe(true);
        if (!legacy.success || !defi.success) {
            return;
        }
        // The path differs, the payload does not.
        expect(legacy.data).toEqual(defi.data);
    });
});

test("the node version call reports a malformed payload as an error", async () => {
    await withPayload({ name: "v0.10.3" }, async () => {
        const result = await new WarthogDeFiApi("http://node.test").getNodeVersion();

        expect(result.success).toBe(false);
        expect(!result.success && result.error).toContain("Invalid node version");
    });
});

// --- Transaction submission --------------------------------------------------

/** A signed transaction body, as the node would receive it. */
const SIGNED_TX = {
    type: "transferWart",
    nonceId: 1,
    sender: "0000000000000000000000000000000000000000de47c9b2",
    recipient: "0000000000000000000000000000000000000000de47c9b3",
    wartE8: 100000000n,
    signature: "aa".repeat(65),
};

test("submitting a transaction posts it and returns the hash", async () => {
    await withPayload({ txHash: "ab".repeat(32) }, async (urls) => {
        const api = new WarthogDeFiApi("http://node.test");
        const result = await api.submitTransaction(
            SIGNED_TX as unknown as Parameters<typeof api.submitTransaction>[0],
        );

        expect(urls).toEqual(["http://node.test/transaction/add"]);
        expect(result.success).toBe(true);
        expect(result.success && result.data.txHash).toBe("ab".repeat(32));
    });
});

test("submitting a transaction reports a response without a hash as an error", async () => {
    await withPayload({ notATxHash: "ab".repeat(32) }, async () => {
        const api = new WarthogDeFiApi("http://node.test");
        const result = await api.submitTransaction(
            SIGNED_TX as unknown as Parameters<typeof api.submitTransaction>[0],
        );

        expect(result.success).toBe(false);
        expect(!result.success && result.error).toContain("Invalid transaction add");
    });
});

// --- The transport ------------------------------------------------------------

test("a client uses the transport it was given, not the global fetch", async () => {
    const original = globalThis.fetch;
    let globalCalled = false;
    globalThis.fetch = (async () => {
        globalCalled = true;
        throw new Error("the global fetch should not be used");
    }) as unknown as typeof fetch;

    try {
        const requested: string[] = [];
        const api = new WarthogDeFiApi("http://node.test", {
            fetch: async (url) => {
                requested.push(url);
                return new Response(JSON.stringify({ code: 0, data: VERSION_PAYLOAD }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            },
        });

        const result = await api.getNodeVersion();

        expect(globalCalled).toBe(false);
        expect(requested).toEqual(["http://node.test/version"]);
        expect(result.success).toBe(true);
        expect(result.success && result.data.version).toBe("0.10.3");
    } finally {
        globalThis.fetch = original;
    }
});

test("a client without a transport uses the global fetch", async () => {
    const original = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
        requested.push(String(url));
        return new Response(JSON.stringify({ code: 0, data: VERSION_PAYLOAD }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }) as unknown as typeof fetch;

    try {
        const result = await new WarthogLegacyApi("http://node.test").getNodeVersion();

        expect(requested).toEqual(["http://node.test/tools/version"]);
        expect(result.success).toBe(true);
    } finally {
        globalThis.fetch = original;
    }
});

test("the transport is used for every request, not just the first", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
        throw new Error("the global fetch should not be used");
    }) as unknown as typeof fetch;

    try {
        const requested: string[] = [];
        const transport = async (url: string) => {
            requested.push(url);
            return new Response(JSON.stringify({ code: 0, data: VERSION_PAYLOAD }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        };

        const legacy = new WarthogLegacyApi("http://node.test", { fetch: transport });
        const defi = new WarthogDeFiApi("http://node.test", { fetch: transport });

        await legacy.getNodeVersion();
        await defi.getNodeVersion();

        expect(requested).toEqual([
            "http://node.test/tools/version",
            "http://node.test/version",
        ]);
    } finally {
        globalThis.fetch = original;
    }
});

test("a transport that fails surfaces the failure rather than falling back", async () => {
    const original = globalThis.fetch;
    let globalCalled = false;
    globalThis.fetch = (async () => {
        globalCalled = true;
        return new Response(JSON.stringify({ code: 0, data: VERSION_PAYLOAD }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }) as unknown as typeof fetch;

    try {
        const api = new WarthogDeFiApi("http://node.test", {
            fetch: async () => {
                throw new Error("Failed to fetch");
            },
        });

        // The transport threw, so the call rejects. There is no silent
        // retry through the global fetch.
        await expect(api.getNodeVersion()).rejects.toThrow("Failed to fetch");
        expect(globalCalled).toBe(false);
    } finally {
        globalThis.fetch = original;
    }
});