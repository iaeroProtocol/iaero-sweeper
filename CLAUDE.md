# RewardSwapper Token Sweeper

Multi-chain token sweeping application that batches multiple token-to-stablecoin swaps through a single contract interaction.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Frontend (Next.js)                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ Token Discovery │  │   Quote Engine  │  │     Batch Execution UI      │  │
│  │  (Multi-source) │  │  (0x API Proxy) │  │ (wagmi + RainbowKit)        │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────────┬───────────────┘  │
└───────────┼─────────────────────┼─────────────────────────┼─────────────────┘
            │                     │                         │
            ▼                     ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API Routes (Edge)                                  │
│  /api/rpc           │  /api/0x/quote     │  /api/helius/*                  │
│  (EVM RPC proxy)    │  (0x v2 proxy)     │  (Solana RPC proxy)             │
│                     │                     │                                 │
│  /api/tokens/discover                    │  /api/coingecko/prices          │
│  (Alchemy + 1inch + Ankr + Explorers)    │  (Price enrichment)             │
└───────────┬─────────────────────┬─────────────────────────┬─────────────────┘
            │                     │                         │
            ▼                     ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RewardSwapper Contract                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     executePlanFromCaller()                         │    │
│  │  - Pulls tokens from user via approval                              │    │
│  │  - Routes each swap through whitelisted aggregators                 │    │
│  │  - Sends output tokens directly to recipient                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                   │                                          │
│          ┌────────────────────────┼────────────────────────┐                 │
│          ▼                        ▼                        ▼                 │
│    RouterKind.AERODROME    RouterKind.UNIV3    RouterKind.AGGREGATOR        │
│    (Velodrome/Camelot)     (Uniswap V3)        (0x, 1inch, Odos, etc)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Security Architecture

### API Key Protection

All sensitive API keys are kept server-side via proxy routes. **Never use `NEXT_PUBLIC_` prefix for API keys.**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Browser/Client │────▶│  API Route      │────▶│  External API   │
│  (no API keys)  │     │  (has API key)  │     │  (Alchemy, etc) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

| Route | Purpose | Server-side Key Used |
|-------|---------|---------------------|
| `/api/rpc?chainId=X` | EVM RPC calls | `ALCHEMY_KEY` |
| `/api/helius/rpc` | Solana RPC calls | `HELIUS_API_KEY` |
| `/api/helius/balances` | Solana token balances | `HELIUS_API_KEY` |
| `/api/0x/quote` | Swap quotes | `ZERO_EX_API_KEY` |
| `/api/tokens/discover` | Token discovery | `ALCHEMY_KEY` |

### Contract Ownership

All RewardSwapper contracts are owned by: `0x1039CB48254a3150fC604d4B9ea08F66f4739D37`

Owner capabilities (use with caution):
- `transferOwnership()` - Transfer control
- `rescueERC20()` - Recover stuck tokens
- `setAggregators()` - Whitelist swap routers
- `setAllowedSelectors()` - Whitelist function calls
- `setAllowedOutTokens()` - Control output tokens
- `setCallers()` - Manage authorized callers

## Key Abstractions

### Smart Contract Layer (`foundry/src/`)

**RewardSwapper.sol** - Core batching contract
- `Step` struct: Single swap instruction with router kind, tokens, amounts, slippage, and encoded route data
- `PullStep` struct: Step with optional Permit2 signature for gasless approvals
- `RouterKind` enum: `AERODROME` (0), `UNIV3` (1), `AGGREGATOR` (2)
- Security: Whitelist-based selector filtering per router, allowed output tokens, dust floor minimums

### Frontend Layer

**useTokenSweeper hook** (`hooks/useTokenSweeper.ts`)
- State machine: `idle` → `scanning` → `quoting` → `ready` → `executing` → `complete`
- Manages token discovery, quote fetching, approval flow, and batch execution
- Configurable via `SweeperSettings` (min value, slippage, spam filtering)

**Chain Configuration** (`lib/chains/config.ts`)
- `SUPPORTED_CHAINS` record with per-chain addresses (swapper, routers, tokens)
- Helper functions: `isSwapperDeployed()`, `getSwapperAddress()`, `getDeployedChains()`

**RPC Configuration** (`sweeper-frontend/src/app/providers.tsx`)
- Uses `getDefaultConfig` from RainbowKit with direct Alchemy URLs
- Alchemy key via `NEXT_PUBLIC_ALCHEMY_KEY` for simplicity
- Fallback to public RPCs if Alchemy key not set

### API Layer (`sweeper-frontend/src/app/api/`)

**RPC Proxy** (`/api/rpc`) - *Optional/Legacy*
- Can proxy EVM JSON-RPC calls if needed
- Currently not used - frontend uses direct Alchemy URLs
- Available as fallback for server-side RPC needs

**Helius Proxy** (`/api/helius/*`)
- `/api/helius/rpc` - Solana JSON-RPC proxy
- `/api/helius/balances` - Token balances endpoint
- Uses `HELIUS_API_KEY` (server-side only)

**Token Discovery** (`/api/tokens/discover`)
- Multi-provider aggregation: Alchemy, 1inch, Ankr, block explorers, Moralis
- Pagination support for wallets with many tokens
- Spam filtering via external token lists

**Quote Proxy** (`/api/0x/quote`)
- Proxies requests to 0x v2 API with API key
- Adds protocol fees (configurable via `SWAP_FEE_BPS`)
- Enables price impact calculation

## Data Flow

### Token Discovery Flow
```
User connects wallet
       │
       ▼
scanWallet(chainId)
       │
       ├──► /api/tokens/discover
       │         │
       │         ├──► Alchemy (getTokenBalances with pagination)
       │         ├──► 1inch (balances endpoint)
       │         ├──► Ankr (getAccountBalance)
       │         └──► Block explorer (token transfer history)
       │
       ▼
Deduplicate & enrich with metadata
       │
       ▼
fetchTokenPrices() ──► DeFiLlama / CoinGecko
       │
       ▼
Filter by value, spam, dust
       │
       ▼
Display candidates in UI
```

### Swap Execution Flow
```
User selects tokens & clicks "Sweep"
       │
       ▼
For each selected token:
  ├──► Check allowance to swapper contract
  ├──► If insufficient: approve(swapper, MAX_UINT256)
  └──► Wait for approval tx
       │
       ▼
Batch tokens into groups of 8 (BATCH_SIZE)
       │
       ▼
For each batch:
  ├──► Fetch fresh quotes from 0x for each token
  ├──► Build SwapPlanStep[] array with encoded calldata
  ├──► Call swapper.executePlanFromCaller(plan, recipient)
  └──► Wait for tx, update status
       │
       ▼
Display results
```

## Supported Chains

| Chain | ID | Contract Address | Status |
|-------|-----|------------------|--------|
| Base | 8453 | `0x25f11f947309df89bf4d36da5d9a9fb5f1e186c1` | Deployed |
| Ethereum | 1 | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | Deployed |
| Arbitrum | 42161 | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | Deployed |
| Optimism | 10 | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | Deployed |
| Polygon | 137 | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | Deployed |
| BNB Chain | 56 | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | Deployed |
| Avalanche | 43114 | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | Deployed |
| Scroll | 534352 | `0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a` | Deployed |
| Linea | 59144 | `0x679e6e600E480d99f8aeD8555953AD2cF43bAB96` | Deployed |

## File Structure

```
sweeper/
├── CLAUDE.md              # This file
├── SECURITY_AUDIT.md      # Security audit report
├── .gitignore             # Git ignore (protects .env files)
├── foundry/               # Smart contracts (Foundry)
│   ├── src/
│   │   └── RewardSwapper.sol    # Core contract
│   ├── script/
│   │   ├── DeployRewardSwapper.s.sol   # Deployment
│   │   ├── ConfigureSwapper.s.sol      # Post-deploy config
│   │   ├── TestSwap.s.sol              # Local testing
│   │   └── VerifyDeployment.s.sol      # Verification
│   ├── foundry.toml       # Foundry config
│   └── README.md          # Deployment guide
├── sweeper-frontend/      # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx           # Main entry
│   │   │   ├── sweeper/page.tsx   # Sweeper UI
│   │   │   ├── providers.tsx      # Wagmi/RainbowKit config
│   │   │   └── api/               # API routes
│   │   │       ├── rpc/           # EVM RPC proxy (NEW)
│   │   │       ├── helius/        # Solana RPC proxy (NEW)
│   │   │       │   ├── rpc/       # JSON-RPC proxy
│   │   │       │   └── balances/  # Balances endpoint
│   │   │       ├── 0x/quote/      # 0x proxy
│   │   │       ├── tokens/discover/  # Token discovery
│   │   │       └── coingecko/prices/ # Price data
│   │   └── components/
│   │       └── solana-sweeper/    # Solana support
│   ├── .env.example       # Environment template
│   └── tailwind.config.ts
├── hooks/
│   └── useTokenSweeper.ts   # Main React hook
├── lib/
│   ├── chains/
│   │   ├── config.ts        # Chain configurations
│   │   ├── types.ts         # TypeScript types
│   │   └── index.ts         # Exports
│   └── swap-utils.ts        # Quote/swap utilities
├── app/                     # Legacy app directory
└── SpamApp/                 # Spam token reporting
```

## Environment Variables

### Frontend (Cloudflare/Vercel)

**Server-side only (never exposed to browser):**
```env
# Required
ZERO_EX_API_KEY=your_0x_key           # Swap quotes
HELIUS_API_KEY=your_helius_key        # Solana RPC & discovery

# Optional
ALCHEMY_KEY=your_alchemy_key          # For /api/rpc proxy if used
MORALIS_API_KEY=your_moralis_key      # Additional token discovery
SWAP_FEE_BPS=5                        # Protocol fee (basis points)
SWAP_FEE_RECIPIENT=0x...              # Fee recipient address
```

**Public (client-side):**
```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
NEXT_PUBLIC_ALCHEMY_KEY=your_alchemy_key    # Used for direct RPC in providers.tsx
```

**Note:** `NEXT_PUBLIC_ALCHEMY_KEY` is used client-side for RPC calls. While this exposes the key, Alchemy keys can be domain-restricted for security. The alternative `/api/rpc` proxy approach is available but currently not used due to WalletConnect compatibility issues.

### Foundry (Local Development)

```env
PRIVATE_KEY=0x...                     # Deployer key (NEVER commit!)
ETH_RPC_URL=https://...               # RPC endpoints
ETHERSCAN_API_KEY=...                 # For verification
```

## Development Operations

### Smart Contract Development

**Build & Test**
```bash
cd foundry
forge build
forge test
```

**Deploy to New Chain**
```bash
# 1. Set environment
cp .env.example .env
# Edit: PRIVATE_KEY, *_RPC_URL, *_API_KEY

# 2. Deploy
forge script script/DeployRewardSwapper.s.sol:DeployRewardSwapper \
  --rpc-url $ARB_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ARBISCAN_API_KEY \
  -vvvv

# 3. Note deployed address from output

# 4. Verify deployment
SWAPPER=0x... forge script script/VerifyDeployment.s.sol:VerifyDeployment \
  --rpc-url $ARB_RPC_URL -vvvv
```

**Transfer Ownership**
```bash
cast send <CONTRACT> "transferOwnership(address)" <NEW_OWNER> \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

**Check Current Owner**
```bash
cast call <CONTRACT> "owner()(address)" --rpc-url $RPC_URL
```

### Frontend Development

**Local Development**
```bash
cd sweeper-frontend
npm install
npm run dev
# Open http://localhost:3000
```

**Adding a New Chain to Frontend**
1. Add chain config to `sweeper-frontend/src/app/sweeper/page.tsx` `CHAIN_CONFIG`
2. Add RPC mapping to `/api/rpc/route.ts` if using Alchemy
3. Test with a small swap

### Common Tasks

**Test a Swap Locally (Fork)**
```bash
# Fork mainnet
anvil --fork-url $ETH_RPC_URL

# In another terminal
forge script script/TestSwap.s.sol:TestSwap0x \
  --rpc-url http://localhost:8545 \
  --broadcast -vvvv
```

**Check Contract Configuration**
```bash
SWAPPER=0x... forge script script/ConfigureSwapper.s.sol:ViewConfig \
  --rpc-url $RPC_URL -vvvv
```

## Security Considerations

### Smart Contract Security
- **Selector Whitelist**: Only pre-approved function selectors can be called on routers
- **Output Token Whitelist**: Only approved tokens (USDC, WETH, etc.) can be swap targets
- **Dust Floors**: Minimum amounts prevent gas-wasteful tiny swaps
- **Slippage Bounds**: Quote validation requires quoted amounts within 5% of actual
- **Reentrancy Guard**: All execution functions protected
- **Owner Controls**: Critical settings gated by `onlyOwner`

### Frontend Security
- **No API keys in client code**: All keys proxied through API routes
- **No `NEXT_PUBLIC_` for secrets**: Only use for non-sensitive config
- **.gitignore protection**: All `.env*` files excluded from git
- **Broadcast files excluded**: Deployment artifacts not committed

### What Owner Can Do (Attack Surface if Compromised)
| Function | Risk Level | Impact |
|----------|------------|--------|
| `transferOwnership()` | Critical | Full control transfer |
| `rescueERC20()` | Critical | Drain contract tokens |
| `setAggregators()` | High | Whitelist malicious router |
| `setAllowedSelectors()` | High | Allow dangerous calls |
| `renounceOwnership()` | High | Permanent lockout |

## Key Contract Addresses

**Universal (All Chains)**
- 0x Exchange Proxy: `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`
- 0x AllowanceHolder: `0x0000000000001fF3684f28c67538d4D072C22734`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

**Contract Owner (All Chains)**
- `0x1039CB48254a3150fC604d4B9ea08F66f4739D37`

## Multi-Sig / Institutional Wallet Support

The sweeper supports Fireblocks, Squads, and other multi-sig wallets connected via WalletConnect.

### Current Architecture

The frontend uses direct Alchemy RPC URLs (via `NEXT_PUBLIC_ALCHEMY_KEY`) with RainbowKit's default configuration. This ensures WalletConnect transactions are routed directly through the wallet connector without any proxy interference.

### Debugging Transaction Flow

Check browser console for transaction status:
```
📝 Approving TOKEN...              → Approval initiated
✅ Approval confirmed in block X   → Approval mined
📦 Batch 1/2: TOKEN1, TOKEN2...    → Batch starting
✅ Batch 1 executed: 5 swaps       → Batch succeeded
🔄 Re-quoting and retrying...      → Retry on failure
```

### Common Issues

**Transactions not reaching Fireblocks:**
1. Check WalletConnect session is active in Fireblocks console
2. Try disconnecting and reconnecting the wallet
3. Ensure `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set correctly
4. Check browser console for errors

**Batch failures:**
- System automatically re-quotes and retries failed batches
- Falls back to individual execution if retry fails
- Check console logs for specific failure reasons

## Batch Retry Logic

When a batch of swaps fails, the sweeper has intelligent retry logic:

### Automatic Retry (On Any Failure)
1. Batch execution fails (revert, timeout, or other error)
2. System automatically re-quotes all tokens in the batch with fresh prices from 0x
3. Rebuilds the swap plan with 1.5x normal slippage tolerance
4. Simulates the retry batch to validate
5. Executes the retry batch
6. Only falls back to individual token execution if retry also fails

### Flow Diagram
```
Batch fails
    │
    ▼
Re-quote all tokens (parallel)
    │
    ▼
Build retry plan (1.5x slippage)
    │
    ▼
Simulate retry batch
    │
    ├─── Simulation passes ──► Execute retry batch
    │                              │
    │                              ├─── Success ──► Done
    │                              │
    │                              └─── Fail ──► Individual execution
    │
    └─── Simulation fails ──► Individual execution
```

## Troubleshooting

**"aggregator !whitelisted" revert**
- The router address in the 0x quote isn't whitelisted
- Add via `setAggregators()` or check `allowedAggregator()`

**"selector !whitelisted" revert**
- Function selector not approved for that router
- Add via `setAllowedSelectors(router, [selector], true)`

**"slippage" revert**
- Actual output less than minimum after slippage
- Increase slippageBps or get fresher quote

**"quotedIn mismatch" revert**
- Quote amount differs >5% from actual balance
- Re-fetch quote with current balance

**Token not showing in scan**
- Check if token discovery APIs support the chain
- Try adding token address manually
- Check browser console for API errors

**High gas estimation**
- Reduce batch size (default 8)
- Check if any token has transfer hooks/fees

**401 errors on Helius/Alchemy**
- Check that `HELIUS_API_KEY` / `ALCHEMY_KEY` is set in Cloudflare
- Ensure you're NOT using `NEXT_PUBLIC_` prefix
- Redeploy after changing environment variables

**RPC calls failing after deploy**
- Verify environment variables are set (not just saved)
- Check Cloudflare deployment logs for missing vars
- Test API routes directly: `/api/rpc?chainId=1`

## Changelog

### January 2026

**Architecture Simplification (Latest)**
- Rolled back RPC proxy approach due to WalletConnect compatibility issues
- Now using direct Alchemy URLs via `NEXT_PUBLIC_ALCHEMY_KEY` in providers.tsx
- Simpler, more reliable WalletConnect transaction flow
- Removed unused `MultiSigToggleDeterministic.tsx` component

**Batch Retry Logic (Re-implemented)**
- When batch execution fails, automatically re-quotes all tokens
- Rebuilds swap plan with 1.5x slippage tolerance
- Simulates and executes retry batch
- Falls back to individual execution only if retry also fails
- Improves success rate for batches that fail due to stale quotes

**Security Hardening**
- Created root `.gitignore` to protect all `.env` files and sensitive directories
- Transferred contract ownership from exposed key to `0x1039CB48254a3150fC604d4B9ea08F66f4739D37`
- Fixed `foundry/.env.example` - replaced real API keys with placeholders
- Fixed `sweeper-frontend/.env.example` - removed deprecated `NEXT_PUBLIC_HELIUS_API_KEY`

**Asset Recovery**
- Recovered assets from compromised deployer wallet (`0x9402cEc8E19CFbdc3FAB9898F49fF91351D47A98`)
- Transferred to `0xa4D75eC14E6BFE5f6cA6C4c0dA82B0FA1BA7f055`:
  - 9.5 iAERO (unstaked from Aerodrome)
  - 0.275 AERO
  - ETH on Base, Mainnet, Arbitrum, Optimism, Linea, Scroll
  - 0.00489 WETH on Mainnet
  - 0.06 BNB on BSC
  - 3.84 AVAX on Avalanche

**Files Modified**
- `sweeper-frontend/src/app/sweeper/page.tsx` - Batch retry logic with re-quoting
- `sweeper-frontend/src/app/providers.tsx` - Direct Alchemy URLs (rolled back from RPC proxy)
- `foundry/.env.example` - Removed exposed API keys
- `sweeper-frontend/.env.example` - Removed deprecated NEXT_PUBLIC vars
