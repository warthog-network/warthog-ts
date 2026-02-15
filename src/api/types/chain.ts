export interface ChainHead {
    difficulty: bigint;
    hash: string;
    height: number;
    is_janushash: boolean;
    pinHash: string;
    pinHeight: number;
    synced: boolean;
    worksum: bigint;
    worksumHex: string;
}

export interface BlockIdHash {
    hash: string;
}

export interface BlockHeader {
    difficulty: bigint;
    hash: string;
    merkleRoot: string;
    nonce: string;
    prevHash: string;
    raw: string;
    target: string;
    timestamp: number;
    utc: string;
    version: string;
}

export interface BlockIdHeader {
    header: BlockHeader;
}

export interface Reward {
    amount: string;
    amountE8: bigint;
    toAddress: string;
    txHash: string;
}

export interface Transfer {
    amount: string;
    amountE8: bigint;
    fee: string;
    feeE8: bigint;
    nonceId: number;
    pinHeight: number;
    toAddress: string;
    txHash: string;
}

export interface Block {
    reward: Reward[];
    transfers: Transfer[];
    confirmations: number;
    header: BlockHeader;
    height: number;
    timestamp: number;
    utc: string;
}
