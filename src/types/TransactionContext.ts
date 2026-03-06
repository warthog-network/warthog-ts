import { createHash } from 'crypto';
import { Account } from './Account';
import { Address } from './Address';
import { NonceId } from './NonceId';
import { Price } from './Price';
import { RoundedFee, Wart } from './Funds';

const UINT32_BE_BYTES = 4;
const UINT64_BE_BYTES = 8;

export interface ChainPin {
    pinHash: string;
    pinHeight: number;
}

/**
 * JSON representation of a signed transaction for submission to Warthog nodes.
 */
export interface TransactionJson extends Record<string, unknown> {
    type: string;
}

/**
 * Transaction builder for creating and signing Warthog transactions.
 * Obtained via WarthogApi.createTransactionContext().
 */
export class TransactionContext {
    /**
     * Create a new transaction context.
     * @param chainPin - Chain pin data from the network
     * @param fee - Transaction fee
     * @param nonceId - Unique nonce for the transaction
     */
    constructor(
        public readonly chainPin: ChainPin,
        public readonly fee: RoundedFee,
        public readonly nonceId: NonceId
    ) {}

    /**
     * Create a WART native token transfer transaction.
     * @param account - Account signing the transaction
     * @param toAddr - Recipient address
     * @param wart - Amount in WART (E8)
     * @returns Signed transaction JSON
     */
    wartTransfer(account: Account, toAddr: Address, wart: Wart): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            addressToBytes(toAddr.hex),
            uint64BE(wart.E8),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

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
     * Create a token transfer transaction.
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param isLiquidity - Whether this transfer is for an asset's liquidity or the asset itself
     * @param toAddr - Recipient address
     * @param amountU64 - Amount in token units
     * @returns Signed transaction JSON
     */
    tokenTransfer(
        account: Account,
        assetHash: string,
        isLiquidity: boolean,
        toAddr: Address,
        amountU64: bigint
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
            uint64BE(amountU64),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'tokenTransfer',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            assetHash,
            isLiquidity,
            toAddr: toAddr.hex,
            amountU64,
            signature65: sig.signature,
        };
    }

    /**
     * Create a limit swap transaction (buy or sell token for WART).
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param isBuy - True to buy token with WART, false to sell token for WART
     * @param amountU64 - Amount in E8 (token units for sell, WART E8 for buy)
     * @param limit - Limit price as Price object
     * @returns Signed transaction JSON
     */
    limitSwap(
        account: Account,
        assetHash: string,
        isBuy: boolean,
        amountU64: bigint,
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
            uint64BE(amountU64),
            Buffer.from(limit.toHex(), 'hex'),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'limitSwap',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            assetHash,
            isBuy,
            amountU64,
            limit: limit.toHex(),
            signature65: sig.signature,
        };
    }

    /**
     * Create a liquidity deposit transaction (add tokens + WART to liquidity pool).
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param amountU64 - Token amount to deposit
     * @param wart - WART amount to deposit
     * @returns Signed transaction JSON
     */
    liquidityDeposit(
        account: Account,
        assetHash: string,
        amountU64: bigint,
        wart: Wart
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            hashToBytes(assetHash),
            uint64BE(amountU64),
            uint64BE(wart.E8),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'liquidityDeposit',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            assetHash,
            amountU64,
            wartE8: wart.E8,
            signature65: sig.signature,
        };
    }

    /**
     * Create a liquidity withdrawal transaction (remove tokens + WART from pool).
     * @param account - Account signing the transaction
     * @param assetHash - Asset hash as hex string
     * @param amountE8 - Liquidity units to withdraw
     * @returns Signed transaction JSON
     */
    liquidityWithdrawal(
        account: Account,
        assetHash: string,
        amountE8: bigint
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            hashToBytes(assetHash),
            uint64BE(amountE8),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'liquidityWithdrawal',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            assetHash,
            amountE8,
            signature65: sig.signature,
        };
    }

    /**
     * Create a cancelation transaction (cancel a pending limit order).
     * @param account - Account signing the transaction
     * @param cancelHeight - Block height at which the order was placed
     * @param cancelNonceId - NonceId of the order to cancel
     * @returns Signed transaction JSON
     */
    cancelation(
        account: Account,
        cancelHeight: number,
        cancelNonceId: number
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId.value),
            Buffer.alloc(3),
            uint64BE(this.fee.E8),
            uint32BE(cancelHeight),
            uint32BE(cancelNonceId),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'cancelation',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            cancelHeight,
            cancelNonceId,
            signature65: sig.signature,
        };
    }

    /**
     * Create an asset creation transaction (create a new token).
     * @param account - Account signing the transaction
     * @param supplyU64 - Total supply in token units
     * @param precision - Token decimal precision (0-18)
     * @param name - Token name (max 5 ASCII characters)
     * @returns Signed transaction JSON
     */
    assetCreation(
        account: Account,
        supplyU64: bigint,
        precision: number,
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
            uint64BE(supplyU64),
            Buffer.from([precision]),
            nameBuffer,
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'assetCreation',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId.value,
            feeE8: this.fee.E8,
            supplyU64,
            precision,
            name,
            signature65: sig.signature,
        };
    }
}

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
