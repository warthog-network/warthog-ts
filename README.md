# warthog-ts

A TypeScript library for the Warthog cryptocurrency.

## Platform Support

This library works in:
- ✅ Node.js (no additional setup)
- ✅ React Native (requires Buffer polyfill)
- ✅ Browsers (requires Buffer polyfill)

## Installation

```bash
npm install warthog-ts ethers
```

## React Native Setup

For React Native, you need to polyfill Buffer:

```typescript
import { Buffer } from 'buffer';

// In your app initialization
global.Buffer = Buffer;
```

## Dependencies

This library requires:
- `ethers` ^6.0.0 (peer dependency)
- `elliptic` ^6.6.1 (bundled)

## Development

To install dependencies:

```bash
bun install
```

To run tests:

```bash
bun test
```

To build:

```bash
bun run build
```

## Examples

Run examples with bun:

```bash
bun run examples/generate-address.ts
```

### Available Examples

- `examples/generate-address.ts` - Generate a new wallet or load from private key

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
