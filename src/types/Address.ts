import { ec as EC } from "elliptic";
import { createHash } from "crypto";

const ec = new EC("secp256k1");

export class Address {
    private privateKeyHex: string;
    private publicKeyHex: string;
    private addressHex: string;

    private constructor(privateKeyHex: string, publicKeyHex: string, addressHex: string) {
        this.privateKeyHex = privateKeyHex;
        this.publicKeyHex = publicKeyHex;
        this.addressHex = addressHex;
    }

    public static fromRandom(): Address {
        const keyPair = ec.genKeyPair();
        return Address.fromKeyPair(keyPair);
    }

    public static fromPrivateKey(hex: string): Address {
        const keyPair = ec.keyFromPrivate(hex, "hex");
        return Address.fromKeyPair(keyPair);
    }

    private static fromKeyPair(keyPair: EC.KeyPair): Address {
        let privateKeyHex = keyPair.getPrivate().toString("hex");
        while (privateKeyHex.length < 64) {
            privateKeyHex = "0" + privateKeyHex;
        }

        const publicKeyHex = keyPair.getPublic().encodeCompressed("hex");

        const publicKeyBuffer = Buffer.from(publicKeyHex, "hex");
        const sha256Hash = createHash("sha256").update(publicKeyBuffer).digest();
        const ripemd160Hash = createHash("ripemd160").update(sha256Hash).digest();

        const checksum = createHash("sha256").update(ripemd160Hash).digest().slice(0, 4);
        const addressBuffer = Buffer.concat([ripemd160Hash, checksum]);
        const addressHex = addressBuffer.toString("hex");

        return new Address(privateKeyHex, publicKeyHex, addressHex);
    }

    public getPrivateKey(): string {
        return this.privateKeyHex;
    }

    public getPublicKey(): string {
        return this.publicKeyHex;
    }

    public getAddress(): string {
        return this.addressHex;
    }

    public static validate(address: string): boolean {
        if (address.length !== 48) {
            return false;
        }

        const addressBuffer = Buffer.from(address, "hex");
        if (addressBuffer.length !== 24) {
            return false;
        }

        const payload = addressBuffer.slice(0, 20);
        const checksum = addressBuffer.slice(20, 24);

        const expectedChecksum = createHash("sha256").update(payload).digest().slice(0, 4);

        return checksum.equals(expectedChecksum);
    }
}
