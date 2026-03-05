import { test, expect } from "bun:test";
import { HDWallet } from "../types/HDWallet";
import { Address } from "../types/Address";

test("HDWallet.fromMnemonic creates valid instance", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);

  expect(wallet).not.toBeNull();
});

test("HDWallet.deriveAddressAtIndex returns valid Address", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);
  const address = wallet.deriveAddressAtIndex(0);

  expect(address.getAddress().length).toBe(48);
  expect(address.getPrivateKeyHex().length).toBe(64);
});

test("HDWallet.deriveAddressAtIndex(0) != deriveAddress(1)", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);

  const address0 = wallet.deriveAddressAtIndex(0);
  const address1 = wallet.deriveAddressAtIndex(1);

  expect(address0.getAddress()).not.toBe(address1.getAddress());
});

test("HDWallet full path derivation matches index method", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);

  const addressFromIndex = wallet.deriveAddressAtIndex(0);
  const addressFromPath = wallet.deriveAddressFromPath("0/0");

  expect(addressFromIndex.getAddress()).toBe(addressFromPath.getAddress());
});

test("HDWallet deriveAddressAtIndex validates address checksum", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const wallet = HDWallet.fromMnemonic(mnemonic);
  const address = wallet.deriveAddressAtIndex(0);

  expect(Address.validate(address.getAddress())).toBe(true);
});
