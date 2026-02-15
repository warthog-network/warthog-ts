export interface Transaction {
    amount: string;
    amountE8: bigint;
    blockHeight: number;
    confirmations: number;
    timestamp: number;
    toAddress: string;
    txHash: string;
    type: string;
    utc: string;
}

export interface TransactionLookup {
    transaction: Transaction;
}

export interface MinFee {
    "16bit": number;
    E8: number;
    amount: string;
}
