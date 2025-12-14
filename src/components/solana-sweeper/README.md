# Solana Token Sweeper

Batch swap multiple SPL tokens to USDC or SOL using Jupiter aggregator. Uses instruction bundling to fit 2-3 swaps per transaction.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Token Sweeper UI                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Helius    │  │   Jupiter   │  │  Wallet Adapter     │ │
│  │  Token API  │  │  Quote API  │  │  (Phantom, etc.)    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│         │                │                    │             │
│         ▼                ▼                    ▼             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              useSolanaSweeper Hook                   │   │
│  │  - scanWallet()    - executeSwap()                   │   │
│  │  - Token selection - Batch transaction building      │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Jupiter swap-instructions API              │   │
│  │  - Returns individual instructions (not full tx)     │   │
│  │  - Enables bundling 2-3 swaps per transaction        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Core Solana dependencies
npm install @solana/web3.js @solana/spl-token

# Wallet adapter
npm install @solana/wallet-adapter-base \
            @solana/wallet-adapter-react \
            @solana/wallet-adapter-react-ui \
            @solana/wallet-adapter-wallets

# If you're using these wallet types specifically:
npm install @solana/wallet-adapter-phantom \
            @solana/wallet-adapter-solflare
```

## Environment Variables

```env
# .env.local
HELIUS_API_KEY=your_helius_api_key_here
```

Get a free Helius API key at: https://helius.dev

## File Structure

```
solana-sweeper/
├── config.ts           # Constants, types, and configuration
├── helius.ts           # Token discovery via Helius API
├── jupiter.ts          # Jupiter swap integration + batching
├── useSolanaSweeper.ts # React hook for all sweeper logic
├── SolanaProvider.tsx  # Wallet provider setup
├── SolanaSweeperPage.tsx # Complete UI component
├── api-route-helius.ts # Next.js API route (copy to app/api/)
└── index.ts            # Re-exports
```

## Quick Start

### 1. Add the Provider

```tsx
// app/layout.tsx or pages/_app.tsx
import { SolanaProvider } from '@/solana-sweeper';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <SolanaProvider rpcEndpoint="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY">
          {children}
        </SolanaProvider>
      </body>
    </html>
  );
}
```

### 2. Add the API Route

Copy `api-route-helius.ts` content to:
- **App Router:** `app/api/helius/balances/route.ts`
- **Pages Router:** `pages/api/helius/balances.ts`

### 3. Use the Page Component

```tsx
// app/solana-sweep/page.tsx
import SolanaSweeperPage from '@/solana-sweeper/SolanaSweeperPage';

export default function Page() {
  return <SolanaSweeperPage />;
}
```

### Or Use the Hook Directly

```tsx
import { useSolanaSweeper } from '@/solana-sweeper';

function MyComponent() {
  const {
    tokens,
    selectedTokens,
    isScanning,
    scanWallet,
    executeSwap,
    totalSelectedValue,
  } = useSolanaSweeper();
  
  return (
    <div>
      <button onClick={() => scanWallet()}>
        {isScanning ? 'Scanning...' : 'Scan Wallet'}
      </button>
      
      {tokens.map(token => (
        <div key={token.mint}>
          {token.symbol}: ${token.valueUsd.toFixed(2)}
        </div>
      ))}
      
      <button onClick={executeSwap}>
        Sweep ${totalSelectedValue.toFixed(2)} to USDC
      </button>
    </div>
  );
}
```

## How Batching Works

### The Problem
Each Jupiter swap generates a full transaction. Executing 10 swaps = 10 transactions = 10 user signatures.

### The Solution
Jupiter's `swap-instructions` endpoint returns raw instructions instead of full transactions. We can combine multiple swap instructions into one transaction:

```typescript
// Instead of getting full transactions:
const tx1 = await jupiter.swap({ ... }); // Full tx
const tx2 = await jupiter.swap({ ... }); // Full tx

// We get instructions:
const ix1 = await jupiter.swapInstructions({ ... }); // Just instructions
const ix2 = await jupiter.swapInstructions({ ... }); // Just instructions

// And combine them:
const combinedTx = new VersionedTransaction([
  ...ix1.setupInstructions,
  ix1.swapInstruction,
  ...ix2.setupInstructions,
  ix2.swapInstruction,
]);
```

### Limits

| Constraint | Limit | Impact |
|------------|-------|--------|
| Transaction size | 1232 bytes | ~2-3 swaps per tx with ALTs |
| Compute units | 1.4M | ~3-4 simple swaps |
| Accounts | 64 per tx | ~2-3 complex routes |

We default to **2 swaps per transaction** to stay safe. This can be tuned based on testing.

## Comparison with EVM Sweeper

| Feature | EVM | Solana |
|---------|-----|--------|
| Approvals | Required | Not needed |
| Batching | Custom contract | Instruction bundling |
| Swaps per tx | 5-8 | 2-3 |
| Aggregator | 0x | Jupiter |
| Token discovery | Alchemy/Moralis | Helius |

## Troubleshooting

### "Transaction too large"
Reduce `MAX_SWAPS_PER_TX` in `config.ts` from 2 to 1.

### "Blockhash expired"
The transaction took too long. This can happen with slow wallet signing. The code will retry with a fresh blockhash.

### "Slippage exceeded"
Increase `DEFAULT_SLIPPAGE_BPS` in `config.ts` or the market moved significantly.

### "Not enough SOL for rent"
Some token accounts need rent. Ensure you have ~0.01 SOL for account creation.

## Future Improvements

1. **Custom Solana Program** - Deploy a program similar to EVM's RewardSwapper for even more efficient batching
2. **Jito Integration** - Bundle transactions for MEV protection
3. **Priority Fees** - Dynamic fee adjustment based on network congestion
4. **Quote Preview Modal** - Match EVM sweeper's preview flow

## Dependencies

```json
{
  "@solana/web3.js": "^1.87.0",
  "@solana/spl-token": "^0.3.9",
  "@solana/wallet-adapter-base": "^0.9.23",
  "@solana/wallet-adapter-react": "^0.15.35",
  "@solana/wallet-adapter-react-ui": "^0.9.35",
  "@solana/wallet-adapter-wallets": "^0.19.27"
}
```
