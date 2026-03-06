import { ethers } from "ethers";

export class Address {
    private constructor(public readonly hex: string) {}

    public static fromHex(hex: string): Address | null {
        if (hex.length !== 48) {
            return null;
        }

        const addressBuffer = Buffer.from(hex, "hex");
        if (addressBuffer.length !== 24) {
            return null;
        }

        const payload = addressBuffer.slice(0, 20);
        const checksum = addressBuffer.slice(20, 24);

        const expectedChecksumHex = ethers.sha256(payload);
        const expectedChecksum = Buffer.from(expectedChecksumHex.slice(2), "hex").slice(0, 4);

        if (!checksum.equals(expectedChecksum)) {
            return null;
        }

        return new Address(hex);
    }

    public static fromRaw(raw: string): Address | null {
        if (raw.length !== 40) {
            return null;
        }

        const rawBuffer = Buffer.from(raw, "hex");
        if (rawBuffer.length !== 20) {
            return null;
        }

        const checksumHex = ethers.sha256(rawBuffer);
        const checksum = Buffer.from(checksumHex.slice(2), "hex").slice(0, 4);
        const addressBuffer = Buffer.concat([rawBuffer, checksum]);

        return new Address(addressBuffer.toString("hex"));
    }

    public static validate(address: string): boolean {
        return Address.fromHex(address) !== null;
    }
}
