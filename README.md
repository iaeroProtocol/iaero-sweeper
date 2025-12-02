# Token Sweeper

A multi-chain token sweeping application that batch-swaps dust tokens to USDC or WETH using the RewardSwapper contract and 0x DEX aggregator.

Built for [iAERO Protocol](https://iaero.io).

## Features

- 🔍 **Smart Wallet Scanning** - Automatically detects ERC-20 tokens via Alchemy, Moralis, and on-chain fallbacks
- 💰 **Batch Swaps** - Swap multiple tokens in a single transaction for gas efficiency
- 🎯 **Best Rates** - Uses 0x aggregator for optimal swap routing across 100+ DEXs
- ⚡ **9 Chains Supported** - Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Scroll, Linea
- 🛡️ **Spam Filtering** - Automatic detection and filtering of scam/honeypot tokens
- 📊 **Price Impact Warnings** - Shows estimated losses before swapping
- 🎨 **Custom Amounts** - Select specific tokens and customize swap amounts
- ➕ **Manual Token Add** - Add tokens not detected by scanners
- 🔄 **Simulation First** - Dry-run swaps to catch failures before spending gas

## Deployed Contracts

The RewardSwapper contract is deployed on all supported chains:

| Chain | Contract Address | Explorer |
|-------|------------------|----------|
| **Base** | `0x25f11f947309df89bf4d36da5d9a9fb5f1e186c1` | [BaseScan](https://basescan.org/address/0x25f11f947309df89bf4d36da5d9a9fb5f1e186c1) |
| **Ethereum** | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | [Etherscan](https://etherscan.io/address/0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a) |
| **Arbitrum** | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | [Arbiscan](https://arbiscan.io/address/0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a) |
| **Optimism** | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | [Optimistic Etherscan](https://optimistic.etherscan.io/address/0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a) |
| **Polygon** | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | [PolygonScan](https://polygonscan.com/address/0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a) |
| **BNB Chain** | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | [BscScan](https://bscscan.com/address/0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a) |
| **Avalanche** | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | [Snowtrace](https://snowtrace.io/address/0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a) |
| **Scroll** | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | [ScrollScan](https://scrollscan.com/address/0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a) |
| **Linea** | `0x679e6e600E480d99f8aeD8555953AD2cF43bAB96` | [LineaScan](https://lineascan.build/address/0x679e6e600E480d99f8aeD8555953AD2cF43bAB96) |

### Output Tokens (USDC)

| Chain | USDC Address | Decimals |
|-------|--------------|----------|
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| Optimism | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 |
| Polygon | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 |
| BNB Chain | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | **18** |
| Avalanche | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | 6 |
| Scroll | `0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4` | 6 |
| Linea | `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` | 6 |

> ⚠️ **Note**: BNB Chain USDC uses 18 decimals, unlike other chains which use 6.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

#### Required Variables

| Variable | Description | Get From |
|----------|-------------|----------|
| `ZERO_EX_API_KEY` | 0x DEX aggregator API key | [0x Dashboard](https://dashboard.0x.org/) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect v2 project ID | [WalletConnect Cloud](https://cloud.walletconnect.com/) |

#### Fee Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SWAP_FEE_BPS` | `5` | Fee in basis points (5 = 0.05%) |
| `SWAP_FEE_RECIPIENT` | `0x8f4C03AA...` | Treasury address for fees |

#### Optional (Recommended)

| Variable | Description | Get From |
|----------|-------------|----------|
| `NEXT_PUBLIC_ALCHEMY_KEY` | Enhanced token scanning | [Alchemy](https://www.alchemy.com/) |
| `MORALIS_API_KEY` | Fallback token discovery | [Moralis](https://moralis.io/) |

#### Optional RPC URLs

Custom RPCs for better performance:

```env
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_ETH_RPC_URL=https://eth.llamarpc.com
NEXT_PUBLIC_ARB_RPC_URL=https://arb1.arbitrum.io/rpc
NEXT_PUBLIC_OP_RPC_URL=https://mainnet.optimism.io
NEXT_PUBLIC_POLYGON_RPC_URL=https://polygon-rpc.com
NEXT_PUBLIC_BSC_RPC_URL=https://bsc-dataseed.binance.org
NEXT_PUBLIC_AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc
NEXT_PUBLIC_SCROLL_RPC_URL=https://rpc.scroll.io
NEXT_PUBLIC_LINEA_RPC_URL=https://rpc.linea.build
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## How It Works

### Swap Flow

1. **Connect Wallet** - RainbowKit wallet connection
2. **Scan Tokens** - Multi-source token discovery (Alchemy → Moralis → on-chain)
3. **Filter Spam** - Automatic removal of known scam tokens + pattern matching
4. **Get Prices** - Fetch market prices via 0x quotes
5. **Select Tokens** - Choose tokens to sweep, customize amounts
6. **Quote Preview** - See expected output and price impact
7. **Approve Tokens** - One-time approval to RewardSwapper contract
8. **Simulate** - Dry-run each swap to catch failures
9. **Execute** - Batch swap via RewardSwapper contract

### Spam Detection

The sweeper uses multiple layers of spam filtering:

1. **External Blocklist** - Community-maintained spam token lists
2. **Pattern Matching** - Detects suspicious symbols (fake USDC, airdrop scams)
3. **Price Failures** - Tokens that fail pricing 2+ times are auto-marked as spam
4. **Manual Marking** - Users can mark tokens as spam

### Error Handling

The system categorizes swap failures:

| Error | Meaning |
|-------|---------|
| `Swap failed - token may have transfer tax` | BSC tax tokens, honeypots |
| `Slippage exceeded` | Price moved during execution |
| `No liquidity available` | No DEX pools for this token |
| `Aggregator not whitelisted` | Contract config issue |

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── 0x/quote/route.ts      # 0x quote proxy (hides API key)
│   │   ├── 1inch/balances/        # Token balance fallback
│   │   └── tokens/discover/       # Multi-source token discovery
│   ├── sweeper/
│   │   └── page.tsx               # Main sweeper component (3400+ lines)
│   ├── layout.tsx                 # Root layout
│   ├── providers.tsx              # Wagmi + RainbowKit config
│   └── page.tsx                   # Landing page
├── tailwind.config.ts
└── package.json
```

## Contract Integration

The frontend calls `executePlanFromCaller` on the RewardSwapper contract:

```typescript
interface SwapStep {
  kind: 2,              // AGGREGATOR route kind
  tokenIn: Address,     // Token to sell
  outToken: Address,    // USDC or WETH
  useAll: boolean,      // Sweep entire balance
  amountIn: bigint,     // Amount to swap
  quotedIn: bigint,     // Quoted input amount  
  quotedOut: bigint,    // Expected output (for slippage calc)
  slippageBps: number,  // Slippage tolerance (300 = 3%)
  data: bytes,          // Encoded: [aggregatorAddress, calldata]
  viaPermit2: false,    // Not using Permit2
  permitSig: '0x',      // Empty
  permitAmount: 0n,
  permitDeadline: 0n,
  permitNonce: 0n
}
```

The `data` field encodes:
```typescript
encodePacked(['address', 'bytes'], [
  allowanceHolderAddress,  // 0x's AllowanceHolder
  swapCalldata             // From 0x quote response
])
```

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 14 (App Router) |
| Wallet | RainbowKit + wagmi v2 + viem |
| Styling | Tailwind CSS |
| Animations | Framer Motion |
| Icons | Lucide React |
| API | 0x Swap API v2 |

## Deployment

### Cloudflare Pages (Recommended)

1. Push to GitHub
2. Connect repo to Cloudflare Pages
3. Build settings:
   - Framework: `Next.js`
   - Build command: `npx @cloudflare/next-on-pages@1`
   - Output directory: `.vercel/output/static`
4. Add environment variables
5. Deploy

### Vercel

```bash
vercel
```

### Manual Build

```bash
npm run build
npm run start
```

## Security Notes

- ✅ 0x API key is server-side only (in API route)
- ✅ Users approve tokens to RewardSwapper (not aggregator directly)
- ✅ Contract handles downstream approvals to 0x AllowanceHolder
- ✅ All swaps are simulated before execution
- ✅ Slippage protection prevents sandwich attacks
- ⚠️ Default slippage is 3% - increase for volatile tokens

## Known Limitations

- **Tax Tokens**: BSC tokens with transfer taxes will fail (use PancakeSwap directly)
- **Honeypots**: Tokens that can't be sold will fail simulation
- **Low Liquidity**: Very small pools may have high slippage
- **Rate Limits**: 0x API has rate limits; large scans may throttle

## License

MIT

---

Built with ❤️ by [iAERO Protocol](https://iaero.io)