# Solana Token Sweeper

Batch swap multiple SPL tokens to USDC or SOL using Jupiter aggregator. Uses instruction bundling to fit 2-3 swaps per transaction without needing a custom program.

## Features

- **Token Discovery**: Uses Helius DAS API to find all tokens with balances
- **Jupiter Integration**: Best routes across all Solana DEXs
- **Batch Swapping**: 2-3 swaps per transaction (no custom program needed!)
- **Auto Retry**: Failed batches retry individually
- **Address Lookup Tables**: Transaction compression for more swaps per tx

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Token Sweeper UI                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Token Discovery (Helius)                                │
│     └─ GET /addresses/{wallet}/balances                     │
│        Returns all SPL tokens + prices in one call!         │
│                                                             │
│  2. Quote Fetching (Jupiter)                                │
│     └─ GET /v6/quote for each token                         │
│        Batched in groups of 5 with rate limiting            │
│                                                             │
│  3. Instruction Bundling (Jupiter)                          │
│     └─ POST /v6/swap-instructions                           │
│        Returns instructions instead of full transaction     │
│                                                             │
│  4. Transaction Building (Client)                           │
│     └─ Combine 2-3 swap instructions per transaction        │
│     └─ Add compute budget + priority fees                   │
│     └─ Use Address Lookup Tables for compression            │
│                                                             │
│  5. Execution                                               │
│     └─ Sign with wallet adapter                             │
│     └─ Send and confirm                                     │
│     └─ Retry failed swaps individually                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Install Dependencies

```bash
npm install @solana/web3.js @solana/wallet-adapter-react \
  @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets \
  framer-motion lucide-react
```

### 2. Get API Keys

**Helius** (free tier available):
1. Go to https://dev.helius.xyz/
2. Create an account and get an API key
3. Set `NEXT_PUBLIC_HELIUS_API_KEY` in your `.env.local`

**RPC Endpoint** (optional but recommended):
- Helius also provides RPC: `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`
- Or use QuickNode, Alchemy, etc.
- Set `NEXT_PUBLIC_SOLANA_RPC_URL` in your `.env.local`

### 3. Environment Variables

Create `.env.local`:

```bash
# Required
NEXT_PUBLIC_HELIUS_API_KEY=your_helius_api_key

# Optional (uses public RPC if not set, but rate limited)
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key
```

### 4. Add Wallet Provider

In your `app/layout.tsx` or `pages/_app.tsx`:

```tsx
import { SolanaWalletProvider } from '@/components/solana-sweeper/SolanaWalletProvider';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <SolanaWalletProvider>
          {children}
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
```

### 5. Add the Page

Create `app/solana-sweep/page.tsx`:

```tsx
import SolanaSweeper from '@/components/solana-sweeper/SolanaSweeper';

export default function SolanaSweepPage() {
  return <SolanaSweeper />;
}
```

## File Structure

```
solana-sweeper/
├── solana-swap.ts           # Core swap logic (Jupiter integration)
├── SolanaSweeper.tsx        # React UI component
├── SolanaWalletProvider.tsx # Wallet adapter setup
└── SETUP.md                 # This file
```

## How Batching Works

### The Problem
Solana has strict transaction limits:
- **Size**: 1232 bytes max
- **Compute**: 1.4M units max
- **Accounts**: 64 unique accounts max

A single Jupiter swap uses:
- ~400-600 bytes
- ~200-400k compute units
- ~10-15 accounts

### The Solution: Instruction Bundling

Instead of getting a full transaction from Jupiter, we get just the instructions:

```typescript
// Old way: One transaction per swap
const { swapTransaction } = await fetch('/v6/swap', {...});

// New way: Get instructions, bundle ourselves
const { swapInstruction, setupInstructions, ... } = await fetch('/v6/swap-instructions', {...});
```

Then we combine multiple swap instructions into one transaction:

```typescript
const instructions = [
  // Compute budget (for all swaps)
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
  
  // Swap 1
  ...swap1.setupInstructions,
  swap1.swapInstruction,
  
  // Swap 2
  ...swap2.setupInstructions,
  swap2.swapInstruction,
  
  // Swap 3
  ...swap3.setupInstructions,
  swap3.swapInstruction,
];
```

### Address Lookup Tables

To fit more swaps, we use ALTs for compression:

```typescript
// Without ALT: Each account = 32 bytes
// With ALT: Each account = 1 byte (index into table)

const addressLookupTables = await getAddressLookupTables(
  connection, 
  [...swap1.addressLookupTableAddresses, ...swap2.addressLookupTableAddresses]
);

const message = new TransactionMessage({...}).compileToV0Message(addressLookupTables);
```

## Tuning Parameters

In `solana-swap.ts`:

```typescript
// Conservative defaults - increase after testing
const SWAPS_PER_BATCH = 2;       // Swaps per transaction
const QUOTE_BATCH_SIZE = 5;      // Parallel quote requests
const QUOTE_BATCH_DELAY_MS = 500; // Delay between quote batches
```

### Testing Higher Batch Sizes

1. Start with `SWAPS_PER_BATCH = 2`
2. Test a few sweeps
3. If no "transaction too large" errors, try `3`
4. Check transaction sizes in logs
5. If consistently < 1000 bytes, you have room for more

## Comparison: EVM vs Solana

| Aspect | EVM (RewardSwapper) | Solana (This) |
|--------|---------------------|---------------|
| Batching | Custom contract | Client-side bundling |
| Swaps/tx | 5-8 | 2-3 |
| Approvals | Required | Not needed! |
| Tx confirmation | ~12-15 seconds | ~400ms |
| Quote freshness | Critical | Less critical (fast txs) |

## Potential Improvements

1. **Custom Program**: Deploy a Solana program similar to RewardSwapper
   - Could fit 4-6 swaps per tx
   - More complex to develop/maintain

2. **Jito Bundles**: Use Jito for MEV protection
   - Prevents sandwich attacks
   - Requires Jito integration

3. **Dynamic Batch Sizing**: Measure tx size and adjust dynamically
   - Pack as many swaps as will fit
   - Requires simulation before signing

4. **Parallel Execution**: Send multiple batches simultaneously
   - Faster for many tokens
   - Risk of nonce conflicts

## Troubleshooting

### "Transaction too large"
- Reduce `SWAPS_PER_BATCH` to 1 or 2
- Some tokens have complex routes that use more space

### "Simulation failed"
- Quote may be stale
- Retry fetches fresh quote automatically

### Rate limiting
- Increase `QUOTE_BATCH_DELAY_MS`
- Use a paid RPC endpoint

### Wallet won't connect
- Make sure wallet extension is installed
- Try a different wallet (Phantom, Solflare)
- Check browser console for errors
