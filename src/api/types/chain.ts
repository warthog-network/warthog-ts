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
