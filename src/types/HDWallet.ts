import { ethers } from "ethers";
import { Address } from "./Address";

export class HDWallet {
  private rootNode: ethers.HDNodeWallet;

  private constructor(rootNode: ethers.HDNodeWallet) {
    this.rootNode = rootNode;
  }

  public static fromMnemonic(mnemonic: string): HDWallet {
    const rootNode = ethers.HDNodeWallet.fromPhrase(
      mnemonic,
      "",
      "m/44'/2070'/0",
    );
    return new HDWallet(rootNode);
  }

  public deriveAddressAtIndex(index: number): Address {
    return this.deriveAddressFromPath(`0/${index}`);
  }

  public deriveAddressFromPath(path: string): Address {
    const childNode = this.rootNode.derivePath(path);
    const privateKeyHex = childNode.privateKey.slice(2);
    return Address.fromPrivateKeyHex(privateKeyHex);
  }
}
