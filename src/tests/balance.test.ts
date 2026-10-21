import { test, expect } from "bun:test";
import { DeFiWartBalance, TokenBalance } from "../types/Balance";
import { WarthogDeFiApi, WarthogLegacyApi } from "../types/Api";
import { Wart } from "../types/Funds";

// --- Node payloads ------------------------------------------------------------

// What core/master answers for GET /account/{address}/balance.
const LEGACY_PAYLOAD = {
    accountId: null,
    address: null,
    balance: "1.5",
    balanceE8: 150000000,
};

// What core/defi answers for GET /account/{address}/wart_balance.
const DEFI_WART_PAYLOAD = {
    wart: {
        total: { str: "10", E8: 1000000000 },
        locked: { str: "2.5", E8: 250000000 },
        mempool: { str: "1", E8: 100000000 },
    },
    account: null,
};

// What core/defi answers for GET /account/{address}/balance/asset:{hash}.
const DEFI_TOKEN_PAYLOAD = {
    token: { decimals: 4, id: 7, name: "HOG", spec: "asset:f45b1131" },
    balance: {
        total: { decimals: 4, str: "12.5", u64: 125000 },
        locked: { decimals: 4, str: "2", u64: 20000 },
        mempool: { decimals: 4, str: "0.5", u64: 5000 },
    },
    account: null,
    lookupTrace: null,
};

const ADDRESS = "0000000000000000000000000000000000000000de47c9b2";

/** Serve one payload and hand back the original fetch. */
async function withResponse(
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

// --- The legacy balance -------------------------------------------------------

test("the legacy client reads the confirmed balance", async () => {
    await withResponse(LEGACY_PAYLOAD, async () => {
        const result = await new WarthogLegacyApi("http://node.test").getWartBalance(
            ADDRESS,
        );

        expect(result.success).toBe(true);
        expect(result.success && result.data.E8).toBe(150000000n);
    });
});

test("the legacy client rejects a balance it cannot read", async () => {
    await withResponse({ balance: 42 }, async () => {
        const result = await new WarthogLegacyApi("http://node.test").getWartBalance(
            ADDRESS,
        );

        expect(result.success).toBe(false);
        expect(!result.success && result.error).toContain("Invalid balance");
    });
});

// --- The DeFi balance ---------------------------------------------------------

test("the DeFi client reads the three parts of the balance", async () => {
    await withResponse(DEFI_WART_PAYLOAD, async () => {
        const result = await new WarthogDeFiApi("http://node.test").getWartBalance(
            ADDRESS,
        );

        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.total.E8).toBe(1000000000n);
        expect(result.data.locked.E8).toBe(250000000n);
        expect(result.data.mempool.E8).toBe(100000000n);
        // What is left of the total after the two locked parts.
        expect(result.data.free().E8).toBe(650000000n);
    });
});

test("the DeFi client rejects a balance whose parts do not add up", async () => {
    const broken = {
        wart: {
            total: { str: "1", E8: 100000000 },
            locked: { str: "2", E8: 200000000 },
            mempool: { str: "0", E8: 0 },
        },
    };

    await withResponse(broken, async () => {
        const result = await new WarthogDeFiApi("http://node.test").getWartBalance(
            ADDRESS,
        );

        expect(result.success).toBe(false);
        expect(!result.success && result.error).toContain("Invalid balance");
    });
});

test("the DeFi client reads a token balance", async () => {
    await withResponse(DEFI_TOKEN_PAYLOAD, async () => {
        const result = await new WarthogDeFiApi("http://node.test").getTokenBalance(
            ADDRESS,
            "f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2",
        );

        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.name).toBe("HOG");
        expect(result.data.decimals.decimals).toBe(4);
        expect(result.data.total.amount).toBe(125000n);
        expect(result.data.locked.amount).toBe(20000n);
        expect(result.data.mempool.amount).toBe(5000n);
        expect(result.data.free().amount).toBe(100000n);
    });
});

test("the DeFi client rejects a token balance it cannot read", async () => {
    await withResponse({ balance: {} }, async () => {
        const result = await new WarthogDeFiApi("http://node.test").getTokenBalance(
            ADDRESS,
            "f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2",
        );

        expect(result.success).toBe(false);
        expect(!result.success && result.error).toContain("Invalid balance");
    });
});

// --- The parsers on their own -------------------------------------------------

test("a WART balance parses from the node payload", () => {
    const balance = DeFiWartBalance.parse(DEFI_WART_PAYLOAD);

    expect(balance).not.toBeNull();
    expect(balance!.total.E8).toBe(1000000000n);
    expect(balance!.free().E8).toBe(650000000n);
});

test("a token balance parses from the node payload", () => {
    const balance = TokenBalance.parse(DEFI_TOKEN_PAYLOAD);

    expect(balance).not.toBeNull();
    expect(balance!.name).toBe("HOG");
    expect(balance!.total.amount).toBe(125000n);
});

test("a malformed payload parses to null", () => {
    for (const bad of [undefined, null, "garbage", 42, {}, { wart: {} }]) {
        expect(DeFiWartBalance.parse(bad)).toBeNull();
        expect(TokenBalance.parse(bad)).toBeNull();
    }
});

test("a balance that does not add up throws when the free amount is asked for", () => {
    const balance = new DeFiWartBalance(
        Wart.fromE8(1n)!,
        Wart.fromE8(2n)!,
        Wart.fromE8(0n)!,
    );

    expect(() => balance.free()).toThrow("Inconsistent balance");
});
