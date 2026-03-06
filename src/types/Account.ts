import type { ec } from "elliptic";
import pkg from "elliptic";
import { ethers } from "ethers";
import { Address } from "./Address";

const { ec: EC } = pkg;
const ecInstance = new EC("secp256k1");

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
        const keyPair = ecInstance.genKeyPair();
        return Account.fromKeyPair(keyPair);
    }

    /**
     * Load an account from an existing private key.
     * @param hex - Private key as 64-character hex string
     * @returns Account derived from the private key
     */
    public static fromPrivateKeyHex(hex: string): Account {
        const keyPair = ecInstance.keyFromPrivate(hex, "hex");
        return Account.fromKeyPair(keyPair);
    }

    /**
     * Derive account from an elliptic curve keypair.
     * @param keyPair - EC keypair to derive from
     * @returns Account with derived keys and address
     */
    private static fromKeyPair(keyPair: ec.KeyPair): Account {
        let privateKeyHex = keyPair.getPrivate().toString("hex");
        while (privateKeyHex.length < 64) {
            privateKeyHex = "0" + privateKeyHex;
        }

        const publicKeyHex = keyPair.getPublic().encodeCompressed("hex");

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
     * Sign a hash for Warthog transaction
     * @param hash - 32-byte hex string to sign
     * @returns 65-byte signature (r + s + recid)
     */
    public sign(hash: string): Signature65 {
        const keyPair = ecInstance.keyFromPrivate(this.privateKeyHex, "hex");
        const signature = ecInstance.sign(Buffer.from(hash, "hex"), keyPair, { canonical: true });

        const r = signature.r.toString(16).padStart(64, "0");
        const s = signature.s.toString(16).padStart(64, "0");
        const recid = signature.recoveryParam ?? 0;

        return {
            r,
            s,
            recid,
            signature: r + s + recid.toString(16).padStart(2, "0"),
        };
    }
}
