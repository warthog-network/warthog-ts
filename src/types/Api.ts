import { TransactionContext } from './TransactionContext';
import type { TransactionJson } from './TransactionContext';
import { NonceId } from './NonceId';
import { RoundedFee } from './Funds';
import { ChainPin, chainHeadSource } from './ChainPin';

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
 * Which generation of `/chain/head` JSON a node returns.
 *
 * Both generations serialize the same C++ type, `Head { ChainHead chainHead;
 * bool synced; }`. Only the serializer differs:
 *
 *   V1 — core/master and core/dev. A hand-written `to_json(API::Head&)`
 *        (src/node/api/http/json.cpp) flattens ChainHead field-by-field into
 *        the top level; `synced` stays at the root.
 *          { hash, height, pinHash, pinHeight, ..., synced }
 *
 *   V2 — core/defi (the DeFi branch). Glaze auto-serialization reflects the
 *        nested struct, so ChainHead is wrapped; `synced` sits beside it.
 *          { chainHead: { hash, height, pinHash, pinHeight, ... }, synced }
 *
 * The two are NOT interchangeable. Both carry the same fields, so validation
 * is identical — only the location differs.
 */
export type WarthogApiVersion = 'v1' | 'v2';

/**
 * A node's view of the chain head, normalized across API generations.
 *
 * V1 returns these fields flat and V2 nests them under `chainHead`; this
 * always exposes them in one shape. See `WarthogApiVersion`.
 */
export class ChainHead {
    constructor(
        /** The most recently proposed pin. */
        public readonly pin: ChainPin,
        /** Hash of the block at `height`. */
        public readonly hash: string,
        /** Tip height. Always >= `pin.pinHeight`. */
        public readonly height: number,
        public readonly synced: boolean,
    ) {}

    /**
     * Extract the chain head from a `/chain/head` payload.
     *
     * @param data - The `data` payload of the response.
     * @param version - Which API generation `data` came from.
     * @returns The chain head, or null if the payload does not match `version`.
     */
    public static parse(data: unknown, version: WarthogApiVersion): ChainHead | null {
        const src = chainHeadSource(data, version);
        const pin = ChainPin.parse(data, version);

        if (!src || !pin || typeof src.hash !== 'string') {
            return null;
        }

        const height = Number(src.height);
        if (!Number.isFinite(height)) {
            return null;
        }

        // `synced` sits at the root of the payload in both generations.
        const synced = Boolean((data as Record<string, unknown>)?.synced);

        return new ChainHead(pin, src.hash, height, synced);
    }
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
 * Client configuration.
 */
export interface WarthogApiOptions {
    /**
     * Which `/chain/head` shape this node returns. Required — the V1 and V2
     * payload shapes are not interchangeable.
     */
    version: WarthogApiVersion;
}

/**
 * Client for communicating with Warthog nodes.
 */
export class WarthogApi {
    private readonly version: WarthogApiVersion;

    /**
     * Create a new API client.
     * @param baseUrl - Base URL of the Warthog node
     * @param options - Declares which API generation the node speaks
     */
    constructor(public readonly baseUrl: string, options: WarthogApiOptions) {
        this.version = options.version;
    }

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
     * Get the current chain head.
     *
     * Normalizes the V1 and V2 payload shapes into a single `ChainHead`.
     * @returns The chain head, or an error result when the payload does not
     *   match the declared `version`.
     */
    async getChainHead(): Promise<ApiResult<ChainHead>> {
        const result = await this.request<unknown>('/chain/head');
        if (!result.success) {
            return result;
        }

        const head = ChainHead.parse(result.data, this.version);
        if (!head) {
            return {
                success: false,
                code: -1,
                error: `Invalid ${this.version} chain head response`,
            };
        }

        return { success: true, data: head };
    }

    /**
     * Submit a signed transaction to the API.
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
     * Fetches the current chain pin and wraps it.
     * @param fee - Transaction fee
     * @param nonceId - Unique nonce for the transaction
     * @returns TransactionContext ready for building transactions
     */
    async createTransactionContext(fee: RoundedFee, nonceId: NonceId): Promise<TransactionContext> {
        const headResult = await this.getChainHead();
        if (!headResult.success) {
            throw new Error(headResult.error);
        }
        return new TransactionContext(headResult.data.pin, fee, nonceId);
    }
}
