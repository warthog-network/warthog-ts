# AGENTS.md - Warthog TypeScript Library

## Overview

Warthog is a cryptocurrency. This library provides type-safe primitives for building and submitting transactions on the Warthog network.

## Important Constants

- **MAX_U64** = `0xffffffffffffffffn` (18,446,744,073,709,551,615) - Maximum 64-bit unsigned integer
- **MAX_U32** = `0xFFFFFFFF` (4,294,967,295) - Maximum 32-bit unsigned integer
- **WART decimals** = 8 decimal places (1 WART = 100,000,000 E8)

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

The nonce is a replay tag, not a counter. A transaction is identified by its
`(account, pin height, nonce)` triple, and the only check a node makes is
that it has not seen that triple before: a repeat is rejected with `ENONCE`,
unless the new transaction pays a higher fee, in which case it replaces the
old one. The nonce does not have to increase, and no node reports an
account's next nonce, so there is nothing to fetch and nothing to track.
`NonceId.random()` is the intended way to pick one.

```typescript
import { NonceId } from 'warthog-ts';

// Create from number (validates 32-bit range)
NonceId.fromNumber(12345)

// Generate random nonce. This is what a client should use.
NonceId.random()

// Validate any number
NonceId.validate(12345)
```

### TokenDecimals
**File:** `src/types/Funds.ts`

Represents token decimal decimals (0-18). WART has 8 decimal places.

```typescript
import { TokenDecimals } from 'warthog-ts';

// WART decimals (8 decimals)
TokenDecimals.WART

// Custom number of decimals
new TokenDecimals(4)
```

### FundsDecimal
**File:** `src/types/Funds.ts`

Parses a decimal string into funds and a number of decimal places. This is
the counterpart of the node's `FundsDecimal`. The number of decimal places is
a `TokenDecimals`, so it cannot exceed 18.

```typescript
import { FundsDecimal } from 'warthog-ts';

const parsed = FundsDecimal.parse('123.45');
// Result: { funds: 12345n, decimals: TokenDecimals(2) }
```

It also carries the node's `adjust_decimals` and `to_string`:

```typescript
// Rescale to another number of decimal places.
// Scales up when the target has more, and scales down when it has fewer,
// but only when that does not lose precision. Returns false otherwise.
parsed.adjustDecimals(new TokenDecimals(8));

// Render as a decimal string, keeping the trailing zeros.
parsed.toString();  // "123.45"
```

### Funds
**File:** `src/types/Funds.ts`

Represents token amounts with specific number of decimals.

```typescript
import { Funds, TokenDecimals } from 'warthog-ts';

Funds.parse('123.45', new TokenDecimals(4))  // Returns Funds with amount 123450000n
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
import { Price, TokenDecimals } from 'warthog-ts';

// Maximum price
Price.max()

// Create from mantissa/exponent (supply raw values before +63 adjustment)
Price.fromMantissaExponent(mantissa, exponent)

// Parse from 6-char hex
Price.fromHex('c0e74d')

// Create from double with specified number of base asset decimals 
// quote asset, i.e. WART decimals is always 8 so it is not passed as a parameter
Price.fromNumberDecimals(1.5, TokenDecimals.WART, false)

// Convert to hex for transaction generation
price.toHex()

// Convert to double (raw, without decimals adjustment)
price.toDoubleRaw()

// Convert to double (with decimals adjustment)
price.toDoubleAdjusted(TokenDecimals.WART)
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

// Public fields (no getters)
account.address           // Address
account.privateKeyHex     // 64-char hex
account.publicKeyHex      // 66-char compressed pubkey hex

// Sign arbitrary bytes (UTF-8 string or Uint8Array).
// Internally SHA-256's the message — same hashing scheme as transactions.
const sig = account.signBytes('hello world')
// sig: { r: string; s: string; recid: number; signature: string }
// sig.signature is the 130-char hex (r || s || recid) wire format.

// Recover the public key that produced a signature.
const pubkeyHex = Account.recoverPublicKey('hello world', sig)

// Recover the Warthog address that produced a signature.
const addr = Account.recoverAddress('hello world', sig)
// addr.hex matches the signer

// Both recovery methods accept either a Signature65 object or the
// 130-char hex `signature` string.
```

### HDWallet
**File:** `src/types/HDWallet.ts`

BIP-44 hierarchical deterministic wallet.

```typescript
import { HDWallet } from 'warthog-ts';

// Create from mnemonic
HDWallet.fromMnemonic('word1 word2 ...')

// Derive account at index
wallet.deriveAccountAtIndex(index)
```

## Transaction Building

### Transaction Contexts
**File:** `src/types/TransactionContext.ts`

Creates signed transactions. There is one context per node family, because the
two families accept different transaction sets.

- `WarthogLegacyTransactionContext` is for the legacy node (core/master,
  core/dev). That node's only transaction endpoint parses a single message
  shape, a transfer, so this context has exactly one builder,
  `transferWart`. The legacy node reads the amount from `amountE8`.
- `WarthogDeFiTransactionContext` is for the DeFi node (core/defi), which
  accepts nine transaction types. It has all nine builders, and its
  `transferWart` reads the amount from `wartE8`, which is where the DeFi node
  looks for it. `amountE8` means the liquidity share count on that node.

The two are separate classes on purpose: a legacy context cannot build a
limit swap, because the method does not exist on it. Both declare
`transferWart(account, toAddr, wart)` with the same signature, so calling
code that only sends WART can hold `AnyTransactionContext` and call it on
whichever node it is talking to.

```typescript
import { WarthogDeFiTransactionContext } from 'warthog-ts';

// WART transfer
context.transferWart(
    account: Account,
    recipient: Address,
    amount: Wart
)

// Asset transfer (transfer regular tokens)
context.transferAsset(
    account: Account,
    asset: string,      // Asset hash hex
    recipient: Address,
    amount: Funds       // Token amount, internally an integer with respect to the assets number of decimals
)

// Liquidity transfer (transfer liquidity pool tokens)
context.transferLiquidity(
    account: Account,
    asset: string,      // Asset hash hex
    recipient: Address,
    units: Liquidity    // Liquidity units, internally an integer with 8 decimal places
)

// Buy (spend WART to buy tokens)
context.buy(
    account: Account,
    asset: string,     // Asset hash hex
    wartAmount: Wart,  // WART amount to spend
    limit: Price       // Limit price, internally a floating point representation with respect to the assets number of decimals
)

// Sell (sell tokens for WART)
context.sell(
    account: Account,
    asset: string,      // Asset hash hex
    tokenAmount: Funds, // Token amount to sell
    limit: Price        // Limit price, internally a floating point representation with respect to the assets number of decimals
)

// Deposit liquidity into pool
context.depositLiquidity(
    account: Account,
    asset: string,     // Asset hash hex
    tokenAmount: Funds,
    wartAmount: Wart
)

// Withdraw liquidity from pool
context.withdrawLiquidity(
    account: Account,
    asset: string,    // Asset hash hex
    units: Liquidity
)

// Cancel transaction
context.cancelTransaction(
    account: Account,
    cancelHeight: number,
    cancelNonceId: NonceId
)

// Create assets
context.createAssets(
    account: Account,
    totalSupply: Funds,
    decimals: TokenDecimals,
    name: string
)
```

## API Communication

### Node Clients
**File:** `src/types/Api.ts`

Connects to a Warthog node. There is a client per node family, because the
two families are separate APIs.

- `WarthogLegacyApi` talks to the legacy node (core/master, core/dev). Its
  `/chain/head` comes back flat, and it accepts one kind of transaction.
- `WarthogDeFiApi` talks to the DeFi node (core/defi). Its `/chain/head`
  comes back nested under `chainHead`, and it accepts nine kinds.

```typescript
import { WarthogDeFiApi, WarthogLegacyApi } from 'warthog-ts';

// Connect to a DeFi node
const api = new WarthogDeFiApi('https://warthog-defitestnet.duckdns.org');

// Connect to a legacy node
const legacy = new WarthogLegacyApi('https://warthognode.duckdns.org');

// Create transaction context (fetches chain pin)
await api.createTransactionContext(fee, nonce)

// Submit transaction
await api.submitTransaction(tx)

// Get the chain head (normalized across generations)
await api.getChainHead()

// Get the WART balance of an account.
// The legacy node reports one number, the confirmed balance. The DeFi node
// reports the total, what is locked in open limit orders, and what is locked
// by transactions in the mempool.
await legacy.getWartBalance(address)
await api.getWartBalance(address)

// Get a token balance. The DeFi node only, the legacy node has no tokens.
await api.getTokenBalance(address, assetHash)

// Get the version of the node.
await legacy.getNodeVersion()
await api.getNodeVersion()
```

The known node lists are split the same way: `KNOWN_NODES_LEGACY` and
`KNOWN_NODES_DEFI`.

### The Transport
**File:** `src/types/Api.ts`

Every request goes through one transport. By default it is the global
`fetch`, but a client can be given a different one:

```typescript
const api = new WarthogDeFiApi(url, { fetch: myTransport });
```

`FetchLike` is `(url: string, init?: RequestInit) => Promise<Response>`. It
is a type, not a dependency on the DOM, so the SDK still builds where there
is no `fetch` at all.

**Why this exists.** The browser wallet runs in a full extension tab as well
as in the toolbar popup, and its node list includes plain-HTTP nodes. The
wallet has a `privilegedFetch` that falls back to a background worker when
the page fetch fails, because the page fetch can be blocked where the
worker's cannot. Passing that in as the transport is what lets the wallet
use the SDK's clients rather than its own read path.

Note that a transport is used for the request only, and only if the caller
gives one. There is no fallback: if the transport throws, the call rejects.
A transport that silently fell back to the global `fetch` would hide the
failure the caller was trying to handle.

### Node Version
**File:** `src/types/NodeVersion.ts`

The version a node reports about itself. `NodeVersion.parse` reads the
payload, and returns null when a field is missing or has the wrong type.

```typescript
import { NodeVersion } from 'warthog-ts';

const version = await new WarthogDeFiApi(url).getNodeVersion();

if (version.success) {
    version.data.name;    // 'v0.10.3 "dd054a2"'
    version.data.major;   // 0
    version.data.minor;   // 10
    version.data.patch;   // 3
    version.data.commit;  // 'dd054a2'
    version.data.version; // '0.10.3', the dotted triple
}
```

**The path differs per family, the payload does not.** The legacy node
(core/master, core/dev) serves the version on `/tools/version`; the DeFi node
(core/defi) serves it on `/version`. Both report the same five fields in the
same flat shape, so there is one parser and one shared fetch helper
(`WarthogApiBase.fetchNodeVersion`), and each client only states its own
path. This is unlike `/chain/head`, which differs in shape between the two
generations and so needs a `WarthogApiVersion` argument.

Do not confuse this with `GET /tools/info`, which the SDK does not call. It
is absent on core/master, private on core/defi, and its shape differs between
core/dev (flat) and core/defi (nested glaze `NodeInfoResult`).

## Common Patterns

### Full Transaction Flow

```typescript
import {
    Account,
    Address,
    RoundedFee,
    Wart,
    NonceId,
    WarthogDeFiApi
} from 'warthog-ts';

// 1. Load account
const account = Account.fromPrivateKeyHex('private-key');

// 2. Prepare recipient
const recipient = Address.fromHex('address-hex')!;

// 3. Connect to API
const api = new WarthogDeFiApi('https://warthog-defitestnet.duckdns.org');

// 4. Create transaction context
const context = await api.createTransactionContext(
    RoundedFee.min(),
    NonceId.random()
);

// 5. Build and sign transaction
const tx = context.transferWart(account, recipient, Wart.fromE8(100000000n)!);

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

## Publishing

**Do not publish from a local checkout.** `npm publish` is run by CI
(`.github/workflows/publish.yml`) on a `v*` tag push, using OIDC trusted
publishing — there is no npm token configured locally, so a manual publish
cannot authenticate and would bypass the release pipeline.

To cut a release: bump `version` in `package.json`, commit, and push the
matching `v*` tag. `prepublishOnly` runs `clean` + `build` in CI.

**The tag is what triggers the publish, not the version bump.** The workflow
fires on `on: push: tags: ['v*']`, so a version bump that is committed without
a matching tag leaves the package unpublished, and that version number is then
consumed: the next release has to skip it. Bump the version and create the
tag in the same breath, then push both.

`npm version patch` does the first two steps in one go (it bumps the version
field in `package.json` and `package-lock.json`, commits, and creates the
annotated tag), but the tag still has to be pushed for CI to see it. Note that
`npm version` does not touch `bun.lock`, which carries no version field, so
nothing is left out of sync by it.

**Pushing a tag twice does not re-run the workflow.** If a tag was pushed but
the publish failed, the tag is spent: cut a new version and tag rather than
re-pushing the old one.
