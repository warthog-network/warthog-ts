import { test, expect } from "bun:test";
import { HDWallet } from "../types/HDWallet";
import { Account } from "../types/Account";

test("HDWallet.fromMnemonic creates valid instance", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);

  expect(wallet).not.toBeNull();
});

test("HDWallet.deriveAccountAtIndex returns valid Account", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);
  const account = wallet.deriveAccountAtIndex(0);

  expect(account.getAddress().length).toBe(48);
  expect(account.getPrivateKeyHex().length).toBe(64);
});

test("HDWallet.deriveAccountAtIndex(0) != deriveAccount(1)", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);

  const account0 = wallet.deriveAccountAtIndex(0);
  const account1 = wallet.deriveAccountAtIndex(1);

  expect(account0.getAddress()).not.toBe(account1.getAddress());
});

test("HDWallet full path derivation matches index method", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);

  const accountFromIndex = wallet.deriveAccountAtIndex(0);
  const accountFromPath = wallet.deriveAccountFromPath("0/0");

  expect(accountFromIndex.getAddress()).toBe(accountFromPath.getAddress());
});

test("HDWallet deriveAccountAtIndex validates account checksum", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);
  const account = wallet.deriveAccountAtIndex(0);

  expect(Account.validate_address(account.getAddress())).toBe(true);
});
