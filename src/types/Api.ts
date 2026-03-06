import { TransactionContext } from './TransactionContext';
import type { TransactionJson } from './TransactionContext';
import { NonceId } from './NonceId';
import { RoundedFee } from './Funds';

/**
 * Known Warthog network nodes.
 */
export const KNOWN_NODES = [
    'http://65.87.7.86:3001',
    'http://185.209.228.16:3001',
    'http://89.117.150.162:3001',
    'http://62.72.44.89:3001',
    'http://217.182.64.43:3001',
    'https://node.wartscan.io',
    'http://dev.node-s.com:3001',
] as const;

/**
 * Type representing a known node URL.
 */
export type NodeUrl = typeof KNOWN_NODES[number];

/**
 * Successful API response with data.
 */
export type ApiSuccess<T> = {
    success: true;
    data: T;
};

/**
 * Error response from API.
 */
export type ApiError = {
    success: false;
    code: number;
    error: string;
};

/**
 * Result type for API calls.
 */
export type ApiResult<T> = ApiSuccess<T> | ApiError;

/**
 * Chain head data containing pin information.
 */
export interface ChainHeadData {
    pinHash: string;
    pinHeight: number;
}

/**
 * Data returned after transaction submission.
 */
export interface SubmitTransactionData {
    txHash: string;
}

/**
 * Options for HTTP requests.
 */
export interface RequestOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
    queryParams?: Record<string, string | number>;
}

/**
 * Client for communicating with Warthog nodes.
 */
export class WarthogApi {
    /**
     * Create a new API client.
     * @param baseUrl - Base URL of the Warthog node
     */
    constructor(public readonly baseUrl: string) {}

    /**
     * Make an HTTP request to the API.
     * @param path - API endpoint path
     * @param options - Request options
     * @returns API result
     */
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

    /**
     * Get the current chain head (latest pinned block).
     * @returns Chain head data with pin hash and height
     */
    async getChainHead(): Promise<ApiResult<ChainHeadData>> {
        return this.request<ChainHeadData>('/chain/head');
    }

    /**
     * Submit a signed transaction to the network.
     * @param tx - Signed transaction JSON from TransactionContext
     * @returns Transaction hash if successful
     */
    async submitTransaction(tx: TransactionJson): Promise<ApiResult<SubmitTransactionData>> {
        return this.request<SubmitTransactionData>('/transaction/add', {
            method: 'POST',
            body: tx,
        });
    }

    /**
     * Create a transaction context for building transactions.
     * Fetches the current chain head to get the pin hash and height.
     * @param fee - Transaction fee
     * @param nonceId - Unique nonce for the transaction
     * @returns TransactionContext ready for building transactions
     */
    async createTransactionContext(fee: RoundedFee, nonceId: NonceId): Promise<TransactionContext> {
        const headResult = await this.getChainHead();
        if (!headResult.success) {
            throw new Error(headResult.error);
        }
        const { pinHash, pinHeight } = headResult.data;
        return new TransactionContext({ pinHash, pinHeight }, fee, nonceId);
    }
}
