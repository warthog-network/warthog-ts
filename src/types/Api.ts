import {
    WarthogDeFiTransactionContext,
    WarthogLegacyTransactionContext,
} from './TransactionContext';
import type { LegacyTransactionJson, TransactionJson } from './TransactionContext';
import { NonceId } from './NonceId';
import { RoundedFee, Wart } from './Funds';
import { ChainPin, chainHeadSource } from './ChainPin';
import { DeFiWartBalance, TokenBalance } from './Balance';
import { NodeVersion } from './NodeVersion';

/**
 * Known legacy nodes (core/master, core/dev).
 *
 * These serve the V1 API generation. The list mirrors
 * `public-data/data/legacy-nodes.csv` in the project hub.
 */
export const KNOWN_NODES_LEGACY = [
    'http://65.87.7.86:3001',
    'http://185.209.228.16:3001',
    'http://89.117.150.162:3001',
    'http://62.72.44.89:3001',
    'http://217.182.64.43:3001',
    'https://node.wartscan.io',
    'http://dev.node-s.com:3001',
] as const;

/**
 * Known DeFi nodes (core/defi).
 *
 * These serve the V2 API generation. The list mirrors
 * `public-data/data/defi-nodes.csv` in the project hub.
 */
export const KNOWN_NODES_DEFI = [
    'http://65.87.7.86:3002/',
    'https://warthog-defitestnet.duckdns.org/',
    'http://104.251.219.14:3001/',
    'http://85.56.145.106:3001/',
    'http://64.44.90.170:3001/',
] as const;

/**
 * Type representing a known legacy node URL.
 */
export type LegacyNodeUrl = typeof KNOWN_NODES_LEGACY[number];

/**
 * Type representing a known DeFi node URL.
 */
export type DeFiNodeUrl = typeof KNOWN_NODES_DEFI[number];

/**
 * Type representing any known node URL.
 */
export type NodeUrl = LegacyNodeUrl | DeFiNodeUrl;

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
 * Shared behaviour of the two node clients.
 *
 * The two node families are not the same API, so they get a client each, and
 * this base holds only what they genuinely share: the HTTP plumbing, the
 * chain head fetch, and the transaction submission. What differs, the chain
 * head shape and the transaction set, lives in the subclasses.
 */
export abstract class WarthogApiBase {
    /**
     * Which generation of the node API this client speaks.
     */
    protected abstract readonly version: WarthogApiVersion;

    constructor(public readonly baseUrl: string) {}

    /**
     * Make an HTTP request to the API and hand back the raw payload.
     *
     * The payload comes off the wire, so it is `unknown`: nothing has checked
     * it yet. A caller that needs a typed value parses the result itself,
     * which is what the `parse` methods on the types in this package are for.
     *
     * This is deliberately not generic. A generic `request<T>` would let a
     * caller name any type and get a cast rather than a check, which is a
     * promise the node does not make.
     *
     * @param path - API endpoint path
     * @param options - Request options
     * @returns API result, with the payload left unvalidated
     */
    protected async requestRaw(
        path: string,
        options?: RequestOptions
    ): Promise<ApiResult<unknown>> {
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
        const json = JSON.parse(text) as { code: number; data?: unknown; error?: string };

        if (json.code !== 0) {
            return {
                success: false,
                code: json.code,
                error: json.error || 'Unknown error',
            };
        }

        return { success: true, data: json.data };
    }

    /**
     * Get the current chain head.
     *
     * Normalizes the V1 and V2 payload shapes into a single `ChainHead`.
     * @returns The chain head, or an error result when the payload does not
     *   match this client's generation.
     */
    async getChainHead(): Promise<ApiResult<ChainHead>> {
        const result = await this.requestRaw('/chain/head');
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
     * @param tx - Signed transaction JSON from a transaction context
     * @returns Transaction hash if successful
     */
    async submitTransaction(
        tx: TransactionJson | LegacyTransactionJson
    ): Promise<ApiResult<SubmitTransactionData>> {
        const result = await this.requestRaw('/transaction/add', {
            method: 'POST',
            body: tx,
        });
        if (!result.success) {
            return result;
        }

        const txHash = (result.data as { txHash?: unknown } | null)?.txHash;
        if (typeof txHash !== 'string') {
            return {
                success: false,
                code: -1,
                error: 'Invalid transaction add response',
            };
        }

        return { success: true, data: { txHash } };
    }

    /**
     * Fetch the node's version from whichever endpoint serves it.
     *
     * Every node family reports the same five fields in the same flat shape,
     * so the parsing is shared. Only the path differs, and that is what the
     * caller passes in.
     *
     * @param path - The endpoint the node family serves the version on.
     * @returns The node version, or an error result
     */
    protected async fetchNodeVersion(path: string): Promise<ApiResult<NodeVersion>> {
        const result = await this.requestRaw(path);
        if (!result.success) {
            return result;
        }

        const version = NodeVersion.parse(result.data);
        if (!version) {
            return {
                success: false,
                code: -1,
                error: 'Invalid node version response',
            };
        }

        return { success: true, data: version };
    }
}

/**
 * Client for the legacy node (core/master, core/dev).
 *
 * That node speaks the V1 API generation: the chain head comes back flat,
 * and it accepts one kind of transaction, a transfer.
 */
export class WarthogLegacyApi extends WarthogApiBase {
    protected readonly version: WarthogApiVersion = 'v1';

    /**
     * Create a new client.
     * @param baseUrl - Base URL of the Warthog node
     */
    constructor(baseUrl: string = KNOWN_NODES_LEGACY[0]) {
        super(baseUrl);
    }

    /**
     * Create a transaction context for building transactions.
     * Fetches the current chain pin and wraps it.
     * @param fee - Transaction fee
     * @param nonceId - Unique nonce for the transaction
     * @returns A context that can build the transactions this node accepts
     */
    async createTransactionContext(
        fee: RoundedFee,
        nonceId: NonceId
    ): Promise<WarthogLegacyTransactionContext> {
        const headResult = await this.getChainHead();
        if (!headResult.success) {
            throw new Error(headResult.error);
        }
        return new WarthogLegacyTransactionContext(headResult.data.pin, fee, nonceId);
    }

    /**
     * Get the WART balance of an account.
     *
     * The legacy node reports one number: the confirmed balance. It has no
     * limit orders, and it does not report what pending transactions lock,
     * so there is no split to make.
     *
     * @param address - Account address, hex
     * @returns The balance, or an error result
     */
    async getWartBalance(address: string): Promise<ApiResult<Wart>> {
        const result = await this.requestRaw(`/account/${address}/balance`);
        if (!result.success) {
            return result;
        }

        const balance = (result.data as { balance?: unknown } | null)?.balance;
        const wart = typeof balance === 'string' ? Wart.parse(balance) : null;
        if (!wart) {
            return {
                success: false,
                code: -1,
                error: 'Invalid balance response',
            };
        }

        return { success: true, data: wart };
    }

    /**
     * Get the version of the node.
     *
     * The legacy node serves it on `/tools/version`.
     *
     * @returns The node version, or an error result
     */
    async getNodeVersion(): Promise<ApiResult<NodeVersion>> {
        return this.fetchNodeVersion('/tools/version');
    }
}

/**
 * Client for the DeFi node (core/defi).
 *
 * That node speaks the V2 API generation: the chain head comes back nested
 * under `chainHead`, and it accepts nine kinds of transaction.
 */
export class WarthogDeFiApi extends WarthogApiBase {
    protected readonly version: WarthogApiVersion = 'v2';

    /**
     * Create a new client.
     * @param baseUrl - Base URL of the Warthog node
     */
    constructor(baseUrl: string = KNOWN_NODES_DEFI[0]) {
        super(baseUrl);
    }

    /**
     * Create a transaction context for building transactions.
     * Fetches the current chain pin and wraps it.
     * @param fee - Transaction fee
     * @param nonceId - Unique nonce for the transaction
     * @returns A context that can build the transactions this node accepts
     */
    async createTransactionContext(
        fee: RoundedFee,
        nonceId: NonceId
    ): Promise<WarthogDeFiTransactionContext> {
        const headResult = await this.getChainHead();
        if (!headResult.success) {
            throw new Error(headResult.error);
        }
        return new WarthogDeFiTransactionContext(headResult.data.pin, fee, nonceId);
    }

    /**
     * Get the WART balance of an account.
     *
     * The DeFi node reports the balance three ways: the total, what is
     * locked in open limit orders, and what is locked by transactions in the
     * mempool.
     *
     * @param address - Account address, hex
     * @returns The balance, or an error result
     */
    async getWartBalance(address: string): Promise<ApiResult<DeFiWartBalance>> {
        const result = await this.requestRaw(`/account/${address}/wart_balance`);
        if (!result.success) {
            return result;
        }

        const balance = DeFiWartBalance.parse(result.data);
        if (!balance) {
            return {
                success: false,
                code: -1,
                error: 'Invalid balance response',
            };
        }

        return { success: true, data: balance };
    }

    /**
     * Get the balance of a token an account holds.
     *
     * @param address - Account address, hex
     * @param assetHash - Asset hash, hex
     * @returns The balance, or an error result
     */
    async getTokenBalance(address: string, assetHash: string): Promise<ApiResult<TokenBalance>> {
        const hash = assetHash.replace(/^0x/i, '').toLowerCase();
        const result = await this.requestRaw(
            `/account/${address}/balance/asset:${hash}`,
        );
        if (!result.success) {
            return result;
        }

        const balance = TokenBalance.parse(result.data);
        if (!balance) {
            return {
                success: false,
                code: -1,
                error: 'Invalid balance response',
            };
        }

        return { success: true, data: balance };
    }

    /**
     * Get the version of the node.
     *
     * The DeFi node serves it on `/version`, not on `/tools/version` like the
     * legacy node does. The payload is the same either way.
     *
     * @returns The node version, or an error result
     */
    async getNodeVersion(): Promise<ApiResult<NodeVersion>> {
        return this.fetchNodeVersion('/version');
    }
}

/**
 * Either node client.
 */
export type AnyWarthogApi = WarthogLegacyApi | WarthogDeFiApi;
