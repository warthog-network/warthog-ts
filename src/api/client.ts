import type { ApiResponse } from "./types/common";
import { WarthogApiError } from "./types/common";
import type {
    BlockIdHash,
    ChainHead,
    BlockHeader,
    Block,
    Transfer,
} from "./types/chain";
import type { Balance } from "./types/account";
export interface WarthogClientOptions {
    nodeUrl: string;
}

export class WarthogClient {
    private readonly nodeUrl: string;

    readonly chain: ChainApi;
    readonly account: AccountApi;
    readonly transaction: TransactionApi;

    constructor(options: WarthogClientOptions) {
        this.nodeUrl = options.nodeUrl.replace(/\/+$/, "");
        this.chain = new ChainApi(this);
        this.account = new AccountApi(this);
        this.transaction = new TransactionApi(this);
    }

    async get<T>(path: string): Promise<T> {
        const url = `${this.nodeUrl}${path}`;
        const res = await fetch(url);
        const json = (await res.json()) as ApiResponse<T>;
        if (!res.ok) {
            throw new WarthogApiError(json.code, path);
        }
        return json.data;
    }

    async post<T>(path: string, body: any): Promise<T> {
        const url = `${this.nodeUrl}${path}`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        const json = (await res.json()) as ApiResponse<T>;
        if (!res.ok) {
            throw new WarthogApiError(json.code, path);
        }
        return json.data;
    }
}

class ChainApi {
    constructor(private client: WarthogClient) {}

    getHead() {
        return this.client.get<ChainHead>("/chain/head");
    }

    getHashId(id: number) {
        return this.client.get<BlockIdHash>(`/chain/block/${id}/hash`);
    }

    getHeader(id: number) {
        return this.client.get<BlockHeader>(`/chain/block/${id}/header`);
    }

    getBlock(id: number) {
        return this.client.get<Block>(`/chain/block/${id}`);
    }
}

export class AccountApi {
    constructor(private client: WarthogClient) {}

    getBalance(address: string) {
        return this.client.get<Balance>(`/account/${address}/balance`);
    }
}

export class TransactionApi {
    constructor(private client: WarthogClient) {}

    getMempool() {
        return this.client.get<Transfer[]>(`/transaction/mempool`);
    }
}
