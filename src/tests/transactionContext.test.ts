import { test, expect } from "bun:test";
import { Account } from "../types/Account";
import { Address } from "../types/Address";
import { ChainPin } from "../types/ChainPin";
import { NonceId } from "../types/NonceId";
import { Funds, Liquidity, RoundedFee, TokenDecimals, Wart } from "../types/Funds";
import {
    WarthogDeFiTransactionContext,
    WarthogLegacyTransactionContext,
    type AnyTransactionContext,
    type LegacyTransactionJson,
    type TransactionJson,
} from "../types/TransactionContext";

const PRIVATE_KEY =
    "966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0";
const RECIPIENT = Address.fromHex(
    "0000000000000000000000000000000000000000de47c9b2"
)!;
const PIN = new ChainPin(
    "1a578e9582ad9ac139de8bf7ef6d33d5da6fc46e3c911106c10464555e627cca",
    5189856,
);
const ASSET_HASH =
    "f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2";

function legacy(): WarthogLegacyTransactionContext {
    return new WarthogLegacyTransactionContext(
        PIN,
        RoundedFee.fromE8(1000000n, false)!,
        NonceId.fromNumber(12345)!,
    );
}

function defi(): WarthogDeFiTransactionContext {
    return new WarthogDeFiTransactionContext(
        PIN,
        RoundedFee.fromE8(1000000n, false)!,
        NonceId.fromNumber(12345)!,
    );
}

test("a legacy transfer carries the amount in amountE8", () => {
    const tx = legacy().transferWart(
        Account.fromPrivateKeyHex(PRIVATE_KEY),
        RECIPIENT,
        Wart.fromE8(100000000n)!,
    );

    expect(tx.amountE8).toBe(100000000n);
    expect("wartE8" in tx).toBe(false);
    // The legacy node never reads a type, so none is sent.
    expect("type" in tx).toBe(false);
});

test("a DeFi transfer carries the amount in wartE8", () => {
    const tx = defi().transferWart(
        Account.fromPrivateKeyHex(PRIVATE_KEY),
        RECIPIENT,
        Wart.fromE8(100000000n)!,
    );

    expect(tx.type).toBe("wartTransfer");
    expect(tx.wartE8).toBe(100000000n);
    expect("amountE8" in tx).toBe(false);
});

test("the node family only changes the JSON around the signature", () => {
    const account = Account.fromPrivateKeyHex(PRIVATE_KEY);
    const old = legacy().transferWart(account, RECIPIENT, Wart.fromE8(100000000n)!);
    const now = defi().transferWart(account, RECIPIENT, Wart.fromE8(100000000n)!);

    // Same signed bytes, so the signature is identical. The DeFi payload is
    // loose, so it is read through the legacy shape here.
    const common = now as unknown as LegacyTransactionJson;
    expect(old.signature65).toBe(common.signature65);

    // The common fields are the same too.
    expect(old.pinHeight).toBe(common.pinHeight);
    expect(old.nonceId).toBe(common.nonceId);
    expect(old.feeE8).toBe(common.feeE8);
    expect(old.toAddr).toBe(common.toAddr);
});

test("a context of either kind can build a transfer", () => {
    // Calling code that only sends WART holds the combined type and calls
    // transferWart on it, whichever node it talks to.
    const send = (ctx: AnyTransactionContext) =>
        ctx.transferWart(
            Account.fromPrivateKeyHex(PRIVATE_KEY),
            RECIPIENT,
            Wart.fromE8(100000000n)!,
        );

    const old = send(legacy());
    const now = send(defi());

    expect((old as LegacyTransactionJson).amountE8).toBe(100000000n);
    expect((now as TransactionJson).wartE8).toBe(100000000n);
});

test("the legacy context cannot build the transactions the DeFi node takes", () => {
    const ctx = legacy();
    const account = Account.fromPrivateKeyHex(PRIVATE_KEY);
    const funds = Funds.parse("1000", TokenDecimals.WART)!;

    // The calls below do not compile. This function is never run, but it is
    // type checked, so the build fails if the legacy context ever grows one
    // of these builders.
    const unsupported = () => {
        // @ts-expect-error the legacy node accepts a transfer and nothing else
        ctx.transferAsset(account, ASSET_HASH, RECIPIENT, funds);
        // @ts-expect-error
        ctx.buy(account, ASSET_HASH, Wart.fromE8(1n)!, null as never);
        // @ts-expect-error
        ctx.depositLiquidity(account, ASSET_HASH, funds, Wart.fromE8(1n)!);
        // @ts-expect-error
        ctx.createAssets(account, funds, TokenDecimals.WART, "TOK");
    };
    expect(unsupported).toBeDefined();

    // At runtime the legacy context has exactly one builder.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(ctx))).toEqual([
        "constructor",
        "transferWart",
    ]);
});

test("the DeFi context keeps every builder", () => {
    const ctx = defi();
    const account = Account.fromPrivateKeyHex(PRIVATE_KEY);
    const funds = Funds.parse("1000", TokenDecimals.WART)!;

    expect(ctx.transferAsset(account, ASSET_HASH, RECIPIENT, funds).type).toBe(
        "tokenTransfer",
    );
    expect(
        ctx.transferLiquidity(account, ASSET_HASH, RECIPIENT, Liquidity.fromE8(100n)!).type,
    ).toBe("tokenTransfer");
    expect(ctx.cancelTransaction(account, 0, NonceId.fromNumber(1)!).type).toBe(
        "cancelation",
    );
    expect(ctx.createAssets(account, funds, TokenDecimals.WART, "TOK").type).toBe(
        "assetCreation",
    );
});
