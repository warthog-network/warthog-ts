import { TransactionContext } from './TransactionContext';
import type { TransactionJson } from './TransactionContext';

export const KNOWN_NODES = [
    'http://65.87.7.86:3001',
    'http://185.209.228.16:3001',
    'http://89.117.150.162:3001',
    'http://62.72.44.89:3001',
    'http://217.182.64.43:3001',
    'https://node.wartscan.io',
    'http://dev.node-s.com:3001',
] as const;

export type NodeUrl = typeof KNOWN_NODES[number];

export type ApiSuccess<T> = {
    success: true;
    data: T;
};

export type ApiError = {
    success: false;
    code: number;
    error: string;
};

export type ApiResult<T> = ApiSuccess<T> | ApiError;

export interface ChainHeadData {
    pinHash: string;
    pinHeight: number;
}

export interface SubmitTransactionData {
    txHash: string;
}

export interface RequestOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
    queryParams?: Record<string, string | number>;
}

export class WarthogApi {
    constructor(public readonly baseUrl: string) {}

    private async request<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> {
        let url = `${this.baseUrl}${path}`;

        if (options?.queryParams) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(options.queryParams)) {
                params.append(key, String(value));
            }
            url += `?${params.toString()}`;
        }

        const replacer = (_key: string, value: unknown): unknown => {
            if (typeof value === 'bigint') {
                return Number(value);
            }
            return value;
        };

        const body = options?.body ? JSON.stringify(options.body, replacer) : undefined;

        const response = await fetch(url, {
            method: options?.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            body,
        });

        const text = await response.text();
        const json = JSON.parse(text) as { code: number; data?: T; error?: string };

        if (json.code !== 0) {
            return {
                success: false,
                code: json.code,
                error: json.error || 'Unknown error',
            };
        }

        return { success: true, data: json.data as T };
    }

    async getChainHead(): Promise<ApiResult<ChainHeadData>> {
        return this.request<ChainHeadData>('/chain/head');
    }

    async submitTransaction(tx: TransactionJson): Promise<ApiResult<SubmitTransactionData>> {
        return this.request<SubmitTransactionData>('/transaction/add', {
            method: 'POST',
            body: tx,
        });
    }

    async createTransactionContext(feeE8: bigint, nonceId: number): Promise<TransactionContext> {
        const headResult = await this.getChainHead();
        if (!headResult.success) {
            throw new Error(headResult.error);
        }
        const { pinHash, pinHeight } = headResult.data;
        return new TransactionContext({ pinHash, pinHeight }, feeE8, nonceId);
    }
}
