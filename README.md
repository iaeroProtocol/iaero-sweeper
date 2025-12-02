# Token Sweeper Frontend

A Next.js application for batch-swapping multiple tokens to USDC or WETH using the RewardSwapper contract and 0x aggregator.

## Features

- 🔍 **Wallet Scanning**: Automatically detects ERC-20 tokens in your wallet
- 💰 **Batch Swaps**: Swap multiple tokens in a single transaction
- 🎯 **Best Rates**: Uses 0x aggregator for optimal swap routing
- ⚡ **Multi-Chain**: Supports Base and Ethereum mainnet
- 🎨 **Custom Amounts**: Select specific tokens and customize swap amounts
- 📊 **Price Display**: Shows real-time USD values via DefiLlama

## Supported Networks

| Chain | RewardSwapper Address |
|-------|----------------------|
| Base | `0x25f11f947309df89bf4d36da5d9a9fb5f1e186c1` |
| Ethereum | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` |

## Setup

### 1. Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

Required variables:
- `ZERO_EX_API_KEY`: Get from [0x.org](https://0x.org/docs/introduction/getting-started)
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: Get from [WalletConnect Cloud](https://cloud.walletconnect.com/)

Optional (but recommended):
- `NEXT_PUBLIC_ALCHEMY_KEY`: For better token scanning
- `NEXT_PUBLIC_BASE_RPC_URL`: Custom Base RPC
- `NEXT_PUBLIC_ETH_RPC_URL`: Custom Ethereum RPC

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## How It Works

1. **Connect Wallet**: Uses RainbowKit for wallet connection
2. **Scan Tokens**: Fetches token balances via Alchemy API (with DefiLlama fallback)
3. **Select Tokens**: Choose which tokens to sweep, optionally customize amounts
4. **Get Quotes**: Fetches 0x v2 quotes for each selected token
5. **Execute Swap**: Builds a batch plan and executes via RewardSwapper contract

## Architecture

```
src/
├── app/
│   ├── api/
│   │   └── 0x/
│   │       └── quote/
│   │           └── route.ts    # 0x quote proxy API
│   ├── sweeper/
│   │   └── page.tsx            # Main sweeper component
│   ├── layout.tsx              # Root layout with providers
│   ├── providers.tsx           # Wagmi + RainbowKit providers
│   ├── globals.css             # Tailwind + custom styles
│   └── page.tsx                # Root page
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Contract Integration

The frontend interacts with the RewardSwapper contract via `executePlanFromCaller`:

```typescript
// Each swap step
interface SwapStep {
  kind: 2,              // AGGREGATOR route kind
  tokenIn: Address,     // Token to sell
  outToken: Address,    // USDC or WETH
  useAll: boolean,      // Sweep entire balance
  amountIn: bigint,     // Amount to swap
  quotedIn: bigint,     // Quoted input amount
  quotedOut: bigint,    // Expected output
  slippageBps: number,  // Slippage tolerance (500 = 5%)
  data: bytes,          // Encoded: [aggregatorAddress, calldata]
  // ... permit fields (unused)
}
```

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Wallet**: RainbowKit + wagmi v2
- **Styling**: Tailwind CSS
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **Chain**: viem

## Deployment

Deploy to Vercel:

```bash
vercel
```

Or build for production:

```bash
npm run build
npm run start
```

## Security Notes

- The 0x API key is kept server-side (in the API route)
- Users approve tokens to the RewardSwapper contract (not the aggregator)
- The contract handles approvals to 0x AllowanceHolder internally
- Slippage is set to 5% by default - adjust for larger swaps

## License

MIT
