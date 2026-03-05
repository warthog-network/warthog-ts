import { createHash } from 'crypto';
import { Account } from './Account';

const UINT32_BE_BYTES = 4;
const UINT64_BE_BYTES = 8;

export interface ChainPin {
    pinHash: string;
    pinHeight: number;
}

export type TransactionJson = Record<string, unknown>;

export class TransactionContext {
    constructor(
        public readonly chainPin: ChainPin,
        public readonly feeE8: bigint,
        public readonly nonceId: number
    ) {}

    wartTransfer(account: Account, toAddr: string, wartE8: bigint): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId),
            Buffer.alloc(3),
            uint64BE(this.feeE8),
            addressToBytes(toAddr),
            uint64BE(wartE8),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'wartTransfer',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId,
            feeE8: this.feeE8,
            toAddr,
            wartE8,
            signature65: sig.signature,
        };
    }

    tokenTransfer(
        account: Account,
        assetHash: string,
        isLiquidity: boolean,
        toAddr: string,
        amountU64: bigint
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId),
            Buffer.alloc(3),
            uint64BE(this.feeE8),
            hashToBytes(assetHash),
            Buffer.from([isLiquidity ? 1 : 0]),
            addressToBytes(toAddr),
            uint64BE(amountU64),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'tokenTransfer',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId,
            feeE8: this.feeE8,
            assetHash,
            isLiquidity,
            toAddr,
            amountU64,
            signature65: sig.signature,
        };
    }

    limitSwap(
        account: Account,
        assetHash: string,
        isBuy: boolean,
        amountU64: bigint,
        limit: string
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId),
            Buffer.alloc(3),
            uint64BE(this.feeE8),
            hashToBytes(assetHash),
            Buffer.from([isBuy ? 1 : 0]),
            uint64BE(amountU64),
            Buffer.from(limit, 'hex'),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'limitSwap',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId,
            feeE8: this.feeE8,
            assetHash,
            isBuy,
            amountU64,
            limit,
            signature65: sig.signature,
        };
    }

    liquidityDeposit(
        account: Account,
        assetHash: string,
        amountU64: bigint,
        wartE8: bigint
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId),
            Buffer.alloc(3),
            uint64BE(this.feeE8),
            hashToBytes(assetHash),
            uint64BE(amountU64),
            uint64BE(wartE8),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'liquidityDeposit',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId,
            feeE8: this.feeE8,
            assetHash,
            amountU64,
            wartE8,
            signature65: sig.signature,
        };
    }

    liquidityWithdrawal(
        account: Account,
        assetHash: string,
        amountE8: bigint
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId),
            Buffer.alloc(3),
            uint64BE(this.feeE8),
            hashToBytes(assetHash),
            uint64BE(amountE8),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'liquidityWithdrawal',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId,
            feeE8: this.feeE8,
            assetHash,
            amountE8,
            signature65: sig.signature,
        };
    }

    cancelation(
        account: Account,
        cancelHeight: number,
        cancelNonceId: number
    ): TransactionJson {
        const binary = Buffer.concat([
            hashToBytes(this.chainPin.pinHash),
            uint32BE(this.chainPin.pinHeight),
            uint32BE(this.nonceId),
            Buffer.alloc(3),
            uint64BE(this.feeE8),
            uint32BE(cancelHeight),
            uint32BE(cancelNonceId),
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'cancelation',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId,
            feeE8: this.feeE8,
            cancelHeight,
            cancelNonceId,
            signature65: sig.signature,
        };
    }

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
            uint32BE(this.nonceId),
            Buffer.alloc(3),
            uint64BE(this.feeE8),
            uint64BE(supplyU64),
            Buffer.from([precision]),
            nameBuffer,
        ]);
        const hash = createHash('sha256').update(binary).digest('hex');
        const sig = account.sign(hash);

        return {
            type: 'assetCreation',
            pinHeight: this.chainPin.pinHeight,
            nonceId: this.nonceId,
            feeE8: this.feeE8,
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