# AGENTS.md - Warthog TypeScript Library

## Overview

Warthog is a cryptocurrency. This library provides type-safe primitives for building and submitting transactions on the Warthog network.

## Important Constants

- **MAX_U64** = `0xffffffffffffffffn` (18,446,744,073,709,551,615) - Maximum 64-bit unsigned integer
- **MAX_U32** = `0xFFFFFFFF` (4,294,967,295) - Maximum 32-bit unsigned integer
- **WART precision** = 8 decimal places (1 WART = 100,000,000 E8)

## Core Types

### Address
**File:** `src/types/Address.ts`

Warthog uses 20-byte addresses with SHA-256 checksums (48-character hex string).

```typescript
import { Address } from 'warthog-ts';

// Create from 48-char hex string (with checksum)
Address.fromHex('0000000000000000000000000000000000000000de47c9b2')

// Create from 40-char raw hex (20 bytes, no checksum)
Address.fromRaw('0000000000000000000000000000000000000000')

// Validate any address string
Address.validate('0000000000000000000000000000000000000000de47c9b2')
```

### NonceId
**File:** `src/types/NonceId.ts`

Every transaction needs a unique nonce (32-bit unsigned integer: 0 to 4,294,967,295).

```typescript
import { NonceId } from 'warthog-ts';

// Create from number (validates 32-bit range)
NonceId.fromNumber(12345)

// Generate random nonce
NonceId.random()

// Validate any number
NonceId.validate(12345)
```

### TokenPrecision
**File:** `src/types/Funds.ts`

Represents token decimal precision (0-18). WART has precision 8.

```typescript
import { TokenPrecision } from 'warthog-ts';

// WART precision (8 decimals)
TokenPrecision.WART

// Custom precision
new TokenPrecision(4)
```

### ParsedFunds
**File:** `src/types/Funds.ts`

Parses a decimal string into components without applying precision.

```typescript
import { ParsedFunds } from 'warthog-ts';

const parsed = ParsedFunds.parse('123.45');
// Result: { val: 12345n, decimalPlaces: 2 }
```

### Funds
**File:** `src/types/Funds.ts`

Represents token amounts with specific precision.

```typescript
import { Funds, TokenPrecision } from 'warthog-ts';

Funds.parse('123.45', new TokenPrecision(4))  // Returns Funds with amount 123450000n
```

### Wart
**File:** `src/types/Funds.ts`

Warthog's native token with 8 decimal places.

```typescript
import { Wart } from 'warthog-ts';

// Parse from string ("1.5" WART = 150000000 E8)
Wart.parse('1.5')

// Create directly from E8 (validated against MAX_U64)
Wart.fromE8(150000000n)

// Convert to rounded fee
wart.roundedFee(ceil: boolean)
```

### Liquidity
**File:** `src/types/Funds.ts`

Liquidity pool tokens with 8 decimal places. Used for liquidity deposit/withdrawal transactions.

```typescript
import { Liquidity } from 'warthog-ts';

// Parse from string ("1.5" = 150000000 E8)
Liquidity.parse('1.5')

// Create directly from E8 (validated against MAX_U64)
Liquidity.fromE8(150000000n)
```

### RoundedFee
**File:** `src/types/Funds.ts`

Transaction fees in rounded WART format (on 64-bit WART scale).

This is NOT the 16-bit compact representation. It is the result of:
1. Converting WART to 16-bit compact format (CompactFee)
2. Converting back to WART scale

This is a lossy operation - the original WART value cannot be restored.
Warthog nodes require rounded values on the 64-bit WART scale in API calls.

```typescript
import { RoundedFee, Wart } from 'warthog-ts';

// Minimum fee (0.00000001 WART)
RoundedFee.min()

// Create from E8 value
RoundedFee.fromE8(1000n, false)  // false = floor, true = ceil

// Round from Wart
RoundedFee.fromWart(wart, false)

// Convert back to Wart
fee.toWart()
```

### CompactFee
**File:** `src/types/Funds.ts`

Warthog's internal 16-bit compact fee representation.
Used for compact storage and transmission within the protocol.
Note: This is NOT used in transaction submission API - use RoundedFee instead.

```typescript
import { CompactFee, Wart } from 'warthog-ts';

// Create from Wart
CompactFee.fromWart(wart, ceil: boolean)

// Convert back to Wart
compactFee.toWart()
```

### Price
**File:** `src/types/Price.ts`

Represents swap prices with normalized mantissa/exponent format.

- **Mantissa:** 16 bits, must be in range [0x8000, 0xFFFF] (high bit set for normalization)
- **Exponent:** 8 bits, range [0, 127] (stored as raw + 63)

```typescript
import { Price, TokenPrecision } from 'warthog-ts';

// Maximum price
Price.max()

// Create from mantissa/exponent (supply raw values before +63 adjustment)
Price.fromMantissaExponent(mantissa, exponent)

// Parse from 6-char hex
Price.fromHex('c0e74d')

// Create from double with token precision
Price.fromNumberPrecision(1.5, TokenPrecision.WART, false)

// Convert to hex for transaction
price.toHex()

// Convert to double (raw, without precision adjustment)
price.toDoubleRaw()

// Convert to double (with precision adjustment)
price.toDoubleAdjusted(TokenPrecision.WART)
```

## Account & Wallets

### Account
**File:** `src/types/Account.ts`

Wallet account for signing transactions.

```typescript
import { Account } from 'warthog-ts';

// Generate new random account (contains private key)
Account.fromRandom()

// Load from private key hex
Account.fromPrivateKeyHex('private-key-hex')

// Get address
account.getAddress()  // Returns Address

// Get private key
account.getPrivateKeyHex()
```

### HDWallet
**File:** `src/types/HDWallet.ts`

BIP-44 hierarchical deterministic wallet.

```typescript
import { HDWallet } from 'warthog-ts';

// Create from mnemonic
HDWallet.fromMnemonic('word1 word2 ...')

// Derive account at index
wallet.deriveAccount(index)

// Derive address at index
wallet.deriveAddress(index)
```

## Transaction Building

### TransactionContext
**File:** `src/types/TransactionContext.ts`

Creates signed transactions. Obtain via `WarthogApi.createTransactionContext()`.

```typescript
import { TransactionContext } from 'warthog-ts';

// WART transfer
context.wartTransfer(
    account: Account,
    recipient: Address,
    amount: Wart
)

// Token transfer
context.tokenTransfer(
    account: Account,
    asset: string,      // Asset hash hex
    isLiquidity: boolean,
    recipient: Address,
    amount: Funds       // Token amount with precision
)

// Limit swap
context.limitSwap(
    account: Account,
    asset: string,     // Asset hash hex
    isBuy: boolean,
    amount: Funds,     // Amount in E8
    limit: Price       // Limit price
)

// Liquidity deposit
context.liquidityDeposit(
    account: Account,
    asset: string,     // Asset hash hex
    tokenAmount: Funds,
    wartAmount: Wart
)

// Liquidity withdrawal
context.liquidityWithdrawal(
    account: Account,
    asset: string,    // Asset hash hex
    units: Liquidity
)

// Cancelation
context.cancelation(
    account: Account,
    cancelHeight: number,
    cancelNonceId: NonceId
)

// Asset creation
context.assetCreation(
    account: Account,
    totalSupply: Funds,
    precision: TokenPrecision,
    name: string
)
```

## API Communication

### WarthogApi
**File:** `src/types/Api.ts`

Connects to Warthog node.

```typescript
import { WarthogApi } from 'warthog-ts';

// Connect to node
const api = new WarthogApi('https://api.warthog.example');

// Create transaction context (fetches chain pin)
await api.createTransactionContext(fee, nonce)

// Submit transaction
await api.submitTransaction(tx)

// Get account balance
await api.getBalance(address)

// Get token balance
await api.getTokenBalance(address, asset)

// Get chain height
await api.getHeight()
```

## Common Patterns

### Full Transaction Flow

```typescript
import {
    Account,
    Address,
    RoundedFee,
    Wart,
    NonceId,
    WarthogApi
} from 'warthog-ts';

// 1. Load account
const account = Account.fromPrivateKeyHex('private-key');

// 2. Prepare recipient
const recipient = Address.fromHex('address-hex')!;

// 3. Connect to API
const api = new WarthogApi('https://api.warthog.example');

// 4. Create transaction context
const context = await api.createTransactionContext(
    RoundedFee.min(),
    NonceId.random()
);

// 5. Build and sign transaction
const tx = context.wartTransfer(account, recipient, Wart.fromE8(100000000n)!);

// 6. Submit
const result = await api.submitTransaction(tx);
```

## Testing

Run tests:
```bash
bun test
```

Run examples:
```bash
bun run examples/transactions.ts
```

## Building

Build the library:
```bash
bun run build
```
