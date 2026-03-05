import { createHash } from 'crypto';

const UINT32_BE_BYTES = 4;
const UINT64_BE_BYTES = 8;

export interface ChainPin {
    pinHash: string;
    pinHeight: number;
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

export class TransactionBytes {
    constructor(public readonly binary: Buffer) {}

    hash(): string {
        return createHash('sha256').update(this.binary).digest('hex');
    }

    static wartTransfer(
        chainPin: ChainPin,
        nonceId: number,
        feeE8: bigint,
        toAddr: string,
        wartE8: bigint
    ): TransactionBytes {
        const binary = Buffer.concat([
            hashToBytes(chainPin.pinHash),
            uint32BE(chainPin.pinHeight),
            uint32BE(nonceId),
            Buffer.alloc(3),
            uint64BE(feeE8),
            addressToBytes(toAddr),
            uint64BE(wartE8),
        ]);
        return new TransactionBytes(binary);
    }

    static tokenTransfer(
        chainPin: ChainPin,
        nonceId: number,
        feeE8: bigint,
        assetHash: string,
        isLiquidity: boolean,
        toAddr: string,
        amountU64: bigint
    ): TransactionBytes {
        const binary = Buffer.concat([
            hashToBytes(chainPin.pinHash),
            uint32BE(chainPin.pinHeight),
            uint32BE(nonceId),
            Buffer.alloc(3),
            uint64BE(feeE8),
            hashToBytes(assetHash),
            Buffer.from([isLiquidity ? 1 : 0]),
            addressToBytes(toAddr),
            uint64BE(amountU64),
        ]);
        return new TransactionBytes(binary);
    }

    static limitSwap(
        chainPin: ChainPin,
        nonceId: number,
        feeE8: bigint,
        assetHash: string,
        isBuy: boolean,
        amountU64: bigint,
        limit: string
    ): TransactionBytes {
        const binary = Buffer.concat([
            hashToBytes(chainPin.pinHash),
            uint32BE(chainPin.pinHeight),
            uint32BE(nonceId),
            Buffer.alloc(3),
            uint64BE(feeE8),
            hashToBytes(assetHash),
            Buffer.from([isBuy ? 1 : 0]),
            uint64BE(amountU64),
            Buffer.from(limit, 'hex'),
        ]);
        return new TransactionBytes(binary);
    }

    static liquidityDeposit(
        chainPin: ChainPin,
        nonceId: number,
        feeE8: bigint,
        assetHash: string,
        amountU64: bigint,
        wartE8: bigint
    ): TransactionBytes {
        const binary = Buffer.concat([
            hashToBytes(chainPin.pinHash),
            uint32BE(chainPin.pinHeight),
            uint32BE(nonceId),
            Buffer.alloc(3),
            uint64BE(feeE8),
            hashToBytes(assetHash),
            uint64BE(amountU64),
            uint64BE(wartE8),
        ]);
        return new TransactionBytes(binary);
    }

    static liquidityWithdrawal(
        chainPin: ChainPin,
        nonceId: number,
        feeE8: bigint,
        assetHash: string,
        amountE8: bigint
    ): TransactionBytes {
        const binary = Buffer.concat([
            hashToBytes(chainPin.pinHash),
            uint32BE(chainPin.pinHeight),
            uint32BE(nonceId),
            Buffer.alloc(3),
            uint64BE(feeE8),
            hashToBytes(assetHash),
            uint64BE(amountE8),
        ]);
        return new TransactionBytes(binary);
    }

    static cancelation(
        chainPin: ChainPin,
        nonceId: number,
        feeE8: bigint,
        cancelHeight: number,
        cancelNonceId: number
    ): TransactionBytes {
        const binary = Buffer.concat([
            hashToBytes(chainPin.pinHash),
            uint32BE(chainPin.pinHeight),
            uint32BE(nonceId),
            Buffer.alloc(3),
            uint64BE(feeE8),
            uint32BE(cancelHeight),
            uint32BE(cancelNonceId),
        ]);
        return new TransactionBytes(binary);
    }

    static assetCreation(
        chainPin: ChainPin,
        nonceId: number,
        feeE8: bigint,
        supplyU64: bigint,
        precision: number,
        name: string
    ): TransactionBytes {
        const nameBuffer = Buffer.alloc(5);
        nameBuffer.write(name, 'ascii');
        const binary = Buffer.concat([
            hashToBytes(chainPin.pinHash),
            uint32BE(chainPin.pinHeight),
            uint32BE(nonceId),
            Buffer.alloc(3),
            uint64BE(feeE8),
            uint64BE(supplyU64),
            Buffer.from([precision]),
            nameBuffer,
        ]);
        return new TransactionBytes(binary);
    }
}
