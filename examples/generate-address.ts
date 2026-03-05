import { Account } from '../src/types/Account';

const account = Account.fromRandom();

console.log('Private Key:', account.getPrivateKeyHex());
console.log('Public Key:', account.getPublicKeyHex());
console.log('Address:', account.getAddress());

const existingAccount = Account.fromPrivateKeyHex(
    '966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0'
);

console.log('Loaded Address:', existingAccount.getAddress());
