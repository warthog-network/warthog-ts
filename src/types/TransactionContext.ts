import { Account } from './Account';
import { Address } from './Address';
import { NonceId } from './NonceId';
import { Price } from './Price';
import { Funds, Liquidity, RoundedFee, TokenDecimals, Wart } from './Funds';
import { ChainPin } from './ChainPin';

const UINT32_BE_BYTES = 4;
const UINT64_BE_BYTES = 8;

/**
 * JSON representation of a signed transaction for submission to Warthog nodes.
 */
export interface TransactionJson extends Record<string, unknown> {
    type: string;
}

/**
 * JSON representation of a signed transaction for the legacy node
 * (core/master, core/dev).
 *
 * These are exactly the fields that node reads from a submitted transaction:
 * pinHeight, nonceId, feeE8, toAddr, amountE8 and signature65. It has no
 * `type`, because the legacy node never looks at one: its only transaction
 * endpoint parses a single message shape, a transfer.
 */
export type LegacyTransactionJson = {
    pinHeight: number;
    nonceId: number;
    feeE8: bigint;
    toAddr: string;
    amountE8: bigint;
    signature65: string;
};

/**
 * State shared by both transaction contexts.
 *
 * The two node families accept different transaction sets, so the contexts
 * are separate classes rather than one class with a version flag. What they
 * share is the state and the bytes that get signed.
 */
abstract class TransactionContextBase {
    constructor(
        public chainPin: ChainPin,
        public fee: RoundedFee,
        public nonceId: NonceId
    ) {}

    /**
     * The bytes signed for a WART transfer.
     *
     * Both node families sign the same bytes for a transfer, so a signature
     * produced for one is valid for the other. Only the JSON around it
     * differs.
     */
    protected wartTransferBytes(toAddr: Address, wart: Wart): Buffer {
        return Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            addressToBytes(toAddr.hex),
            uint64BE(wart.E8),
        ]);
    }
}

/**
 * Transaction builder for the legacy node (core/master, core/dev).
 *
 * That node accepts one kind of transaction, a transfer, so this context
 * offers one builder. The DeFi node accepts nine.
 */
export class WarthogLegacyTransactionContext extends TransactionContextBase {
    /**
     * Create a WART transfer transaction.
     *
     * The legacy node reads the amount from `amountE8`. The DeFi node reads
     * it from `wartE8` and never looks at `amountE8`, where that name means
     * the liquidity share count instead.
     *
     * @param account - Account signing the transaction
     * @param toAddr - Recipient address
     * @param wart - Amount in WART (E8)
     * @returns Signed transaction JSON
     */
    public transferWart(account: Account, toAddr: Address, wart: Wart): LegacyTransactionJson {
        const sig = account.signBytes(this.wartTransferBytes(toAddr, wart));

        return {
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            toAddr: toAddr.hex,
            amountE8: wart.E8,
            signature65: sig.signature,
        };
    }
}

/**
 * Transaction builder for the DeFi node (core/defi).
 *
 * Obtained via `WarthogDeFiApi.createTransactionContext()`.
 *
 * All properties (chainPin, fee, nonceId) can be modified. When reusing this
 * context for multiple transactions, you MUST change the nonceId for each new
 * transaction to prevent nonce collisions. The chainPin should typically remain
 * unchanged unless you need to refresh it from the network.
 */
export class WarthogDeFiTransactionContext extends TransactionContextBase {
    /**
     * Create a WART native token transfer transaction.
     * @param account - Account signing the transaction
     * @param toAddr - Recipient address
     * @param wart - Amount in WART (E8)
     * @returns Signed transaction JSON
     */
    public transferWart(account: Account, toAddr: Address, wart: Wart): TransactionJson {
        const sig = account.signBytes(this.wartTransferBytes(toAddr, wart));

        return {
            type: 'wartTransfer',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            toAddr: toAddr.hex,
            wartE8: wart.E8,
            signature65: sig.signature,
        };
    }

    /**
     * Create an asset transfer transaction.
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param toAddr - Recipient address
     * @param amount - Amount in token units
     * @returns Signed transaction JSON
     */
    public transferAsset(
        account: Account,
        assetHash: string,
        toAddr: Address,
        amount: Funds
    ): TransactionJson {
        return this.tokenTransferInternal(account, assetHash, false, toAddr, amount.amount);
    }

    /**
     * Create a liquidity transfer transaction.
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param toAddr - Recipient address
     * @param units - Liquidity units to transfer
     * @returns Signed transaction JSON
     */
    public transferLiquidity(
        account: Account,
        assetHash: string,
        toAddr: Address,
        units: Liquidity
    ): TransactionJson {
        return this.tokenTransferInternal(account, assetHash, true, toAddr, units.E8);
    }

    /**
     * Internal token transfer implementation.
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param isLiquidity - Whether this transfer is for an asset's liquidity or the asset itself
     * @param toAddr - Recipient address
     * @param amountE8 - Amount in E8
     * @returns Signed transaction JSON
     */
    private tokenTransferInternal(
        account: Account,
        assetHash: string,
        isLiquidity: boolean,
        toAddr: Address,
        amountE8: bigint
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            hashToBytes(assetHash),
            Buffer.from([isLiquidity ? 1 : 0]),
            addressToBytes(toAddr.hex),
            uint64BE(amountE8),
        ]);
        const sig = account.signBytes(binary);

        return {
            type: 'tokenTransfer',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            assetHash,
            isLiquidity,
            toAddr: toAddr.hex,
            amountU64: amountE8,
            signature65: sig.signature,
        };
    }

    /**
     * Create a limit buy transaction (buy token with WART).
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param wartAmount - WART amount to spend
     * @param limit - Limit price as Price object
     * @returns Signed transaction JSON
     */
    public buy(account: Account, assetHash: string, wartAmount: Wart, limit: Price): TransactionJson {
        return this.limitSwapInternal(account, assetHash, true, wartAmount.E8, limit);
    }

    /**
     * Create a limit sell transaction (sell tokens for WART).
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param tokenAmount - Token amount to sell
     * @param limit - Limit price as Price object
     * @returns Signed transaction JSON
     */
    public sell(account: Account, assetHash: string, tokenAmount: Funds, limit: Price): TransactionJson {
        return this.limitSwapInternal(account, assetHash, false, tokenAmount.amount, limit);
    }

    /**
     * Internal limit swap implementation.
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param isBuy - True to buy token with WART, false to sell token for WART
     * @param amountE8 - Amount in E8 (token units for sell, WART E8 for buy)
     * @param limit - Limit price as Price object
     * @returns Signed transaction JSON
     */
    private limitSwapInternal(
        account: Account,
        assetHash: string,
        isBuy: boolean,
        amountE8: bigint,
        limit: Price
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            hashToBytes(assetHash),
            Buffer.from([isBuy ? 1 : 0]),
            uint64BE(amountE8),
            Buffer.from(limit.toHex(), 'hex'),
        ]);
        const sig = account.signBytes(binary);

        return {
            type: 'limitSwap',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            assetHash,
            isBuy,
            amountU64: amountE8,
            limit: limit.toHex(),
            signature65: sig.signature,
        };
    }

    /**
     * Create a liquidity deposit transaction (add tokens + WART to liquidity pool).
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param tokenAmount - Token amount to deposit
     * @param wart - WART amount to deposit
     * @returns Signed transaction JSON
     */
    public depositLiquidity(
        account: Account,
        assetHash: string,
        tokenAmount: Funds,
        wart: Wart
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            hashToBytes(assetHash),
            uint64BE(tokenAmount.amount),
            uint64BE(wart.E8),
        ]);
        const sig = account.signBytes(binary);

        return {
            type: 'liquidityDeposit',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            assetHash,
            amountE8: tokenAmount.amount,
            wartE8: wart.E8,
            signature65: sig.signature,
        };
    }

    /**
     * Create a liquidity withdrawal transaction (remove tokens + WART from liquidity pool).
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param units - Liquidity units to withdraw
     * @returns Signed transaction JSON
     */
    public withdrawLiquidity(
        account: Account,
        assetHash: string,
        units: Liquidity
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            hashToBytes(assetHash),
            uint64BE(units.E8),
        ]);
        const sig = account.signBytes(binary);

        return {
            type: 'liquidityWithdrawal',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            assetHash,
            amountE8: units.E8,
            signature65: sig.signature,
        };
    }

    /**
     * Create a cancelTransaction transaction (cancel a pending limit order).
     * @param account - Account signing the transaction
     * @param cancelHeight - Block height at which the order was placed
     * @param cancelNonceId - NonceId of the order to cancel
     * @returns Signed transaction JSON
     */
    public cancelTransaction(
        account: Account,
        cancelHeight: number,
        cancelNonceId: NonceId
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            uint32BE(cancelHeight),
            uint32BE(cancelNonceId.value),
        ]);
        const sig = account.signBytes(binary);

        return {
            type: 'cancelation',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            cancelHeight,
            cancelNonceId: cancelNonceId.value,
            signature65: sig.signature,
        };
    }

    /**
     * Create an asset creation transaction (create a new token).
     * @param account - Account signing the transaction
     * @param totalSupply - Total supply in token units
     * @param decimals - Token decimal places (0-18)
     * @param name - Token name (max 5 ASCII characters)
     * @returns Signed transaction JSON
     */
    public createAssets(
        account: Account,
        totalSupply: Funds,
        decimals: TokenDecimals,
        name: string
    ): TransactionJson {
        const nameBuffer = Buffer.alloc(5);
        nameBuffer.write(name, 'ascii');
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            uint64BE(totalSupply.amount),
            Buffer.from([decimals.decimals]),
            nameBuffer,
        ]);
        const sig = account.signBytes(binary);

        return {
            type: 'assetCreation',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            supplyU64: totalSupply.amount,
            decimals: decimals.decimals,
            name,
            signature65: sig.signature,
        };
    }
}

/**
 * Either transaction context.
 *
 * Calling code that only builds WART transfers can hold this type and call
 * `transferWart` on it, whichever node it is talking to. The DeFi-only
 * builders need the concrete `WarthogDeFiTransactionContext`.
 */
export type AnyTransactionContext =
    | WarthogLegacyTransactionContext
    | WarthogDeFiTransactionContext;

function uint32BE(value: number): Buffer {
    const buf = Buffer.alloc(UINT32_BE_BYTES);
    buf.writeUInt32BE(value, 0);
    return buf;
}

function uint64BE(value: bigint): Buffer {
    const buf = Buffer.alloc(UINT64_BE_BYTES);
    buf.writeBigUInt64BE(value, 0);
    return buf;
}

function addressToBytes(address: string): Buffer {
    return Buffer.from(address.slice(0, 40), 'hex');
}

function hashToBytes(hash: string): Buffer {
    return Buffer.from(hash, 'hex');
}
