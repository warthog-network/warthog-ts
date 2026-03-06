import { Account } from '../src/types/Account';
import { WarthogApi } from '../src/types/Api';
import { TransactionContext, TransactionJson } from '../src/types/TransactionContext';
import { Wart } from '../src/types/Funds';

const account = Account.fromRandom();

console.log('Private Key:', account.getPrivateKeyHex());
console.log('Public Key:', account.getPublicKeyHex());
console.log('Address:', account.getAddress());

const existingAccount = Account.fromPrivateKeyHex(
    '966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0'
);

console.log('Loaded Address:', existingAccount.getAddress());

const api = new WarthogApi('http://127.0.0.1:3100');

async function submit(txJson: TransactionJson) {
    const label = txJson.type;
    const result = await api.submitTransaction(txJson);
    if (result.success) {
        console.log(`${label} submitted successfully!`);
        console.log('Transaction hash:', result.data.txHash);
    } else {
        console.error(`${label} failed:`, result.error);
    }
}

async function sendWart() {
    const context = await api.createTransactionContext(BigInt(1), Math.floor(Math.random() * 100000));
    await submit(
        context.wartTransfer(
            existingAccount,
            '0000000000000000000000000000000000000000de47c9b2',
            new Wart(100000000n)
        )
    );
}

async function sendToken() {
    const context = await api.createTransactionContext(BigInt(1), Math.floor(Math.random() * 100000));
    await submit(
        context.tokenTransfer(
            existingAccount,
            'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2',
            false,
            '0000000000000000000000000000000000000000de47c9b2',
            BigInt(1000)
        )
    );
}

async function limitSwap() {
    const context = await api.createTransactionContext(BigInt(1), Math.floor(Math.random() * 100000));
    await submit(
        context.limitSwap(
            existingAccount,
            'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2',
            true,
            BigInt(100000000),
            'c0e74d'
        )
    );
}

async function liquidityDeposit() {
    const context = await api.createTransactionContext(BigInt(1), Math.floor(Math.random() * 100000));
    await submit(
        context.liquidityDeposit(
            existingAccount,
            'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2',
            BigInt(1000),
            new Wart(100000000n)
        )
    );
}

async function liquidityWithdrawal() {
    const context = await api.createTransactionContext(BigInt(1), Math.floor(Math.random() * 100000));
    await submit(
        context.liquidityWithdrawal(
            existingAccount,
            'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2',
            BigInt(100)
        )
    );
}

async function cancelTransaction() {
    const context = await api.createTransactionContext(BigInt(1), Math.floor(Math.random() * 100000));
    await submit(
        context.cancelation(existingAccount, 0, 1)
    );
}

async function createAsset() {
    const context = await api.createTransactionContext(BigInt(1), Math.floor(Math.random() * 100000));
    await submit(
        context.assetCreation(existingAccount, BigInt(1000000000000), 4, 'TOK2')
    );
}

sendWart();
sendToken();
limitSwap();
liquidityDeposit();
liquidityWithdrawal();
cancelTransaction();
createAsset();
