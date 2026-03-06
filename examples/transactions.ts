import { Account } from '../src/types/Account';
import { Address } from '../src/types/Address';
import { WarthogApi } from '../src/types/Api';
import { TransactionContext, TransactionJson } from '../src/types/TransactionContext';
import { NonceId } from '../src/types/NonceId';
import { Price } from '../src/types/Price';
import { Funds, Liquidity, RoundedFee, TokenPrecision, Wart } from '../src/types/Funds';

const account = Account.fromRandom();

console.log('Private Key:', account.getPrivateKeyHex());
console.log('Public Key:', account.getPublicKeyHex());
console.log('Address:', account.getAddress().hex);

const existingAccount = Account.fromPrivateKeyHex(
    '966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0'
);

console.log('Loaded Address:', existingAccount.getAddress().hex);

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

async function runExamples() {
    // Create a single context and reuse it for all transactions
    const context = await api.createTransactionContext(RoundedFee.min(), NonceId.fromNumber(0)!);

    // WART transfer
    context.nonceId = NonceId.fromNumber(1)!;
    await submit(
        context.wartTransfer(
            existingAccount,
            Address.fromHex('0000000000000000000000000000000000000000de47c9b2')!,
            Wart.fromE8(100000000n)!
        )
    );

    // Token transfer
    context.nonceId = NonceId.fromNumber(2)!;
    await submit(
        context.tokenTransfer(
            existingAccount,
            'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2',
            false,
            Address.fromHex('0000000000000000000000000000000000000000de47c9b2')!,
            Funds.parse('1000', new TokenPrecision(4))!
        )
    );

    // Limit swap
    context.nonceId = NonceId.fromNumber(3)!;
    // Note: The precision (4) must be obtained from the API's token information
    // for the asset being traded. Different tokens have different precisions.
    const price = Price.fromNumberPrecision(1.0, new TokenPrecision(4), false)!;
    console.log('Price hex:', price.toHex());
    await submit(
        context.limitSwap(
            existingAccount,
            'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2',
            true,
            Funds.parse('1.0', TokenPrecision.WART)!,
            price
        )
    );

    // Liquidity deposit
    context.nonceId = NonceId.fromNumber(4)!;
    await submit(
        context.liquidityDeposit(
            existingAccount,
            'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2',
            Funds.parse('1000', new TokenPrecision(4))!,
            Wart.fromE8(100000000n)!
        )
    );

    // Liquidity withdrawal
    context.nonceId = NonceId.fromNumber(5)!;
    await submit(
        context.liquidityWithdrawal(
            existingAccount,
            'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2',
            Liquidity.fromE8(100n)!
        )
    );

    // Cancelation
    context.nonceId = NonceId.fromNumber(6)!;
    await submit(
        context.cancelation(existingAccount, 0, 1)
    );

    // Asset creation
    context.nonceId = NonceId.fromNumber(7)!;
    await submit(
        context.assetCreation(existingAccount, Funds.parse('10000', new TokenPrecision(4))!, new TokenPrecision(4), 'TOK2')
    );
}

runExamples();
