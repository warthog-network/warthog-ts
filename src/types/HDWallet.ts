import { ethers } from "ethers";
import { Account } from "./Account";

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

  public deriveAccountAtIndex(index: number): Account {
    return this.deriveAccountFromPath(`0/${index}`);
  }

  public deriveAccountFromPath(path: string): Account {
    const childNode = this.rootNode.derivePath(path);
    const privateKeyHex = childNode.privateKey.slice(2);
    return Account.fromPrivateKeyHex(privateKeyHex);
  }
}
