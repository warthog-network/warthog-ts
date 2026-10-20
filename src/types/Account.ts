import { ethers } from "ethers";
import { Address } from "./Address";

/**
 * 65-byte ECDSA signature components.
 */
export interface Signature65 {
    r: string;
    s: string;
    recid: number;
    signature: string;
}

/**
 * Wallet account for signing transactions on the Warthog network.
 * Uses secp256k1 elliptic curve for key management.
 */
export class Account {
    public readonly privateKeyHex: string;
    public readonly publicKeyHex: string;
    public readonly address: Address;

    private constructor(privateKeyHex: string, publicKeyHex: string, address: Address) {
        this.privateKeyHex = privateKeyHex;
        this.publicKeyHex = publicKeyHex;
        this.address = address;
    }

    /**
     * Generate a new random account with a fresh private key.
     * @returns New Account with randomly generated keypair
     */
    public static fromRandom(): Account {
        // A random 32-byte string is a valid secp256k1 key with overwhelming
        // probability; retry on the (astronomically unlikely) invalid draw.
        for (let attempt = 0; attempt < 8; attempt++) {
            try {
                return Account.fromSigningKey(new ethers.SigningKey(ethers.randomBytes(32)));
            } catch {
                // retry
            }
        }
        throw new Error("failed to generate a valid secp256k1 private key");
    }

    /**
     * Load an account from an existing private key.
     * @param hex - Private key as 64-character hex string
     * @returns Account derived from the private key
     */
    public static fromPrivateKeyHex(hex: string): Account {
        const normalized = hex.toLowerCase();
        if (!/^[0-9a-f]*$/.test(normalized)) {
            throw new Error("private key must be a hex string");
        }
        if (normalized.length > 64) {
            throw new Error("private key must be at most 32 bytes");
        }
        const padded = normalized.padStart(64, "0");
        return Account.fromSigningKey(new ethers.SigningKey("0x" + padded));
    }

    /**
     * Derive account from a secp256k1 signing key.
     * @param signingKey - Signing key to derive from
     * @returns Account with derived keys and address
     */
    private static fromSigningKey(signingKey: ethers.SigningKey): Account {
        const privateKeyHex = signingKey.privateKey.slice(2);
        const publicKeyHex = signingKey.compressedPublicKey.slice(2);

        const publicKeyBuffer = Buffer.from(publicKeyHex, "hex");
        const sha256Hex = ethers.sha256(publicKeyBuffer);
        const sha256Hash = Buffer.from(sha256Hex.slice(2), "hex");
        const ripemd160Hex = ethers.ripemd160(sha256Hash);
        const ripemd160Hash = Buffer.from(ripemd160Hex.slice(2), "hex");
        const checksumHex = ethers.sha256(ripemd160Hash);
        const checksum = Buffer.from(checksumHex.slice(2), "hex").slice(0, 4);
        const addressBuffer = Buffer.concat([ripemd160Hash, checksum]);
        const addressHex = addressBuffer.toString("hex");

        return new Account(privateKeyHex, publicKeyHex, Address.fromHex(addressHex)!);
    }

    /**
     * Hash arbitrary bytes with SHA-256 and sign the digest with the account's
     * private key. The signature is produced with the same secp256k1
     * configuration as transaction signing (low-s / canonical, recovery id).
     *
     * @param message - UTF-8 string or raw bytes to sign
     * @returns 65-byte signature (r + s + recid)
     */
    public signBytes(message: string | Uint8Array): Signature65 {
        const bytes = messageToBytes(message);
        const digest = Buffer.from(ethers.sha256(bytes).slice(2), "hex");
        return this._signHash(digest);
    }

    /**
     * Recover the compressed public key (hex) that produced the given
     * signature for the given message.
     *
     * @param message - UTF-8 string or raw bytes that were signed
     * @param signature - `Signature65` object, or 130-char hex string
     *   (`r || s || recid`)
     * @returns Compressed public key as 66-char hex string
     */
    public static recoverPublicKey(
        message: string | Uint8Array,
        signature: Signature65 | string
    ): string {
        const bytes = messageToBytes(message);
        const digest = Buffer.from(ethers.sha256(bytes).slice(2), "hex");
        const { r, s, recid } = normalizeSignature(signature);
        // The recovery id's second bit flags an r value that overflowed the
        // curve order. It is never set for secp256k1 (r < n with probability
        // 1 - 2^-127), so only the parity bit carries information.
        const publicKey = ethers.SigningKey.recoverPublicKey(digest, {
            r: "0x" + r,
            s: "0x" + s,
            yParity: (recid & 1) as 0 | 1,
        });
        return compressPublicKey(publicKey);
    }

    /**
     * Recover the Warthog address that produced the given signature for the
     * given message. Derived from the recovered public key via the same
     * `RIPEMD-160(SHA-256(pubkey)) + 4-byte checksum` pipeline the protocol
     * uses for addresses.
     *
     * @param message - UTF-8 string or raw bytes that were signed
     * @param signature - `Signature65` object, or 130-char hex string
     *   (`r || s || recid`)
     * @returns The Warthog address that produced the signature
     */
    public static recoverAddress(
        message: string | Uint8Array,
        signature: Signature65 | string
    ): Address {
        const publicKeyHex = Account.recoverPublicKey(message, signature);
        const pubkeyBytes = Buffer.from(publicKeyHex, "hex");
        const sha = ethers.sha256(pubkeyBytes).slice(2);
        const ripe = ethers.ripemd160(Buffer.from(sha, "hex")).slice(2);
        const checksum = ethers.sha256(Buffer.from(ripe, "hex")).slice(2, 10);
        return Address.fromHex(ripe + checksum)!;
    }

    /**
     * Internal: sign a 32-byte digest buffer. Shared by `signBytes` and any
     * other internal callers that have already computed the digest.
     */
    private _signHash(hashBuffer: Buffer): Signature65 {
        const signature = new ethers.SigningKey("0x" + this.privateKeyHex).sign(hashBuffer);

        const r = signature.r.slice(2);
        const s = signature.s.slice(2);
        const recid = signature.yParity;

        return {
            r,
            s,
            recid,
            signature: r + s + recid.toString(16).padStart(2, "0"),
        };
    }
}

/**
 * Convert a public `string | Uint8Array` message into a Buffer for hashing.
 * Strings are encoded as UTF-8.
 */
function messageToBytes(message: string | Uint8Array): Buffer {
    if (typeof message === "string") {
        return Buffer.from(message, "utf8");
    }
    return Buffer.from(message);
}

/**
 * Convert an uncompressed public key (`0x04 || X || Y`) into the compressed
 * form (`02`/`03` || X) that the Warthog protocol uses.
 */
function compressPublicKey(publicKeyHex: string): string {
    // publicKeyHex is "0x" || "04" || X(32 bytes) || Y(32 bytes)
    const uncompressed = publicKeyHex.slice(2);
    if (uncompressed.length !== 130 || !uncompressed.startsWith("04")) {
        throw new Error("unexpected uncompressed public key format");
    }
    const x = uncompressed.slice(2, 66);
    const y = uncompressed.slice(66, 130);
    const prefix = (parseInt(y.slice(-2), 16) & 1) === 1 ? "03" : "02";
    return prefix + x;
}

/**
 * Normalize a `Signature65` object or 130-char hex string into the
 * `{r, s, recid}` shape used for public key recovery.
 */
function normalizeSignature(
    sig: Signature65 | string
): { r: string; s: string; recid: number } {
    if (typeof sig === "string") {
        if (sig.length !== 130 || !/^[0-9a-fA-F]+$/.test(sig)) {
            throw new Error(
                "signature string must be 130 hex chars (r || s || recid)"
            );
        }
        const recid = parseInt(sig.slice(128, 130), 16);
        if (recid < 0 || recid > 3) {
            throw new Error(`signature recid must be in {0, 1, 2, 3}, got ${recid}`);
        }
        return {
            r: sig.slice(0, 64),
            s: sig.slice(64, 128),
            recid,
        };
    }
    if (typeof sig.r !== "string" || typeof sig.s !== "string" || typeof sig.recid !== "number") {
        throw new Error("Signature65 must have r (string), s (string), recid (number)");
    }
    return { r: sig.r, s: sig.s, recid: sig.recid };
}
