import type { ApiResponse } from "./types/common";
import { WarthogApiError } from "./types/common";
import type { ChainHead } from "./types/chain";

export interface WarthogClientOptions {
    nodeUrl: string;
}

export class WarthogClient {
    private readonly nodeUrl: string;

    readonly chain: ChainApi;

    constructor(options: WarthogClientOptions) {
        this.nodeUrl = options.nodeUrl.replace(/\/+$/, "");
        this.chain = new ChainApi(this);
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
}

class ChainApi {
    constructor(private client: WarthogClient) {}

    getHead() {
        return this.client.get<ChainHead>("/chain/head");
    }
}
