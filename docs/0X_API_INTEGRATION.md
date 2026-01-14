# 0x API Integration Guide

A comprehensive guide for integrating the 0x Swap API for best execution in automated crypto protocols.

## Overview

The 0x API aggregates liquidity from multiple DEXs and provides optimal swap routing with:
- Best price execution across 100+ liquidity sources
- Price impact estimation
- Slippage protection
- Optional protocol fees

## API Endpoint

```
https://api.0x.org/swap/allowance-holder/quote
```

This is the **Allowance Holder** variant which is recommended for smart contract integrations. It uses the AllowanceHolder contract pattern instead of requiring approvals to individual DEX routers.

## Authentication

All requests require an API key in the header:

```typescript
const response = await fetch(url, {
  headers: {
    "0x-api-key": ZERO_EX_API_KEY,
    "0x-version": "v2",
  },
});
```

Get an API key at: https://0x.org/docs/introduction/getting-started

## Basic Quote Request

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | number | Chain ID (1=Ethereum, 8453=Base, 42161=Arbitrum, etc.) |
| `sellToken` | address | Token address to sell |
| `buyToken` | address | Token address to buy |
| `sellAmount` | string | Amount to sell in wei (token's smallest unit) |
| `taker` | address | Address that will execute the swap (your contract) |

### Example Request

```typescript
async function get0xQuote(
  chainId: number,
  sellToken: string,
  buyToken: string,
  sellAmount: bigint,
  taker: string
): Promise<Quote0x> {
  const params = new URLSearchParams({
    chainId: String(chainId),
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker,
  });

  const response = await fetch(
    `https://api.0x.org/swap/allowance-holder/quote?${params}`,
    {
      headers: {
        "0x-api-key": process.env.ZERO_EX_API_KEY!,
        "0x-version": "v2",
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.reason || error.message || 'Quote failed');
  }

  return response.json();
}
```

### Response Structure

```typescript
interface Quote0x {
  // Amounts
  sellAmount: string;           // Amount being sold (in wei)
  buyAmount: string;            // Expected output amount (in wei)

  // Price impact (requires priceImpactProtectionPercentage param)
  estimatedPriceImpact: string; // e.g., "0.45" = 0.45%

  // Transaction data for execution
  transaction: {
    to: string;                 // Contract to call (usually 0x Exchange Proxy)
    data: string;               // Encoded calldata
    value: string;              // ETH value to send (for ETH sells)
    gas: string;                // Estimated gas
    gasPrice: string;           // Gas price
  };

  // Routing info
  route: {
    fills: Array<{
      source: string;           // DEX name (e.g., "Uniswap_V3", "Curve")
      proportionBps: string;    // Proportion of swap (in basis points)
    }>;
  };

  // Allowance info
  issues?: {
    allowance?: {
      spender: string;          // Address to approve
      actual: string;           // Current allowance
      expected: string;         // Required allowance
    };
  };
}
```

## Price Impact Estimation

To get price impact data, include the `priceImpactProtectionPercentage` parameter:

```typescript
// Set to 0.99 (99%) to get price impact without blocking quotes
params.set("priceImpactProtectionPercentage", "0.99");
```

**Why 0.99?** Setting it lower would block quotes that exceed that impact. Using 0.99 means you'll get quotes for almost any swap and can handle price impact in your own logic.

### Calculating Price Impact

The `estimatedPriceImpact` from 0x is a rough estimate. For more accuracy, compare against a reference price:

```typescript
async function calculatePriceImpact(
  sellToken: string,
  sellAmount: bigint,
  sellDecimals: number,
  buyToken: string,
  buyDecimals: number,
  chainId: number,
  taker: string
): Promise<{ quote: Quote0x; priceImpact: number }> {
  // Get quote for actual amount
  const mainQuote = await get0xQuote(chainId, sellToken, buyToken, sellAmount, taker);

  // Get reference quote for small amount (e.g., $1 worth)
  const refAmount = parseUnits("1", sellDecimals); // 1 token
  const refQuote = await get0xQuote(chainId, sellToken, buyToken, refAmount, taker);

  // Calculate market rate from reference quote
  const refSellNum = Number(formatUnits(BigInt(refQuote.sellAmount), sellDecimals));
  const refBuyNum = Number(formatUnits(BigInt(refQuote.buyAmount), buyDecimals));
  const marketRate = refBuyNum / refSellNum; // buyToken per sellToken

  // Calculate expected output at market rate
  const sellNum = Number(formatUnits(sellAmount, sellDecimals));
  const expectedOutput = sellNum * marketRate;

  // Calculate actual output
  const actualOutput = Number(formatUnits(BigInt(mainQuote.buyAmount), buyDecimals));

  // Price impact = (expected - actual) / expected * 100
  const priceImpact = expectedOutput > 0
    ? Math.max(0, ((expectedOutput - actualOutput) / expectedOutput) * 100)
    : 0;

  return { quote: mainQuote, priceImpact };
}
```

## Slippage Configuration

### Setting Slippage Tolerance

```typescript
// Slippage in basis points (100 bps = 1%)
params.set("slippageBps", "50"); // 0.5% slippage
```

### Dynamic Slippage Based on Price Impact

For automated systems, calculate slippage dynamically:

```typescript
function calculateDynamicSlippage(priceImpactPercent: number): number {
  // Convert price impact percent to basis points
  const priceImpactBps = Math.ceil(priceImpactPercent * 100);

  // Base slippage: 30 bps (0.3%)
  // Add 1.5x the price impact as buffer
  // Cap at 500 bps (5%)
  const slippageBps = Math.min(500, Math.max(30, 30 + Math.ceil(priceImpactBps * 1.5)));

  return slippageBps;
}

// For retries, use higher slippage
function calculateRetrySlippage(priceImpactPercent: number): number {
  const baseSlippage = calculateDynamicSlippage(priceImpactPercent);
  return Math.ceil(baseSlippage * 1.5); // 1.5x for retries
}
```

### Slippage Strategy Table

| Scenario | Slippage (bps) | Notes |
|----------|---------------|-------|
| Stable pairs (USDC/USDT) | 10-30 | Very low volatility |
| Major pairs (ETH/USDC) | 30-50 | Normal market conditions |
| Small cap tokens | 100-300 | Higher volatility |
| Low liquidity | 300-500 | Based on price impact |
| Retry after failure | 1.5x normal | Account for price movement |
| Forced high slippage | 500-1000 | User override for problem tokens |

## Protocol Fees

Add optional protocol fees to swaps:

```typescript
// Fee configuration
const SWAP_FEE_BPS = "5";              // 5 bps = 0.05%
const SWAP_FEE_RECIPIENT = "0x...";    // Your treasury address

// Add to params
params.set("swapFeeRecipient", SWAP_FEE_RECIPIENT);
params.set("swapFeeBps", SWAP_FEE_BPS);
params.set("swapFeeToken", buyToken);  // Fee taken from output token
```

## Executing the Swap

### On-Chain Execution

The 0x quote returns transaction data that can be executed directly or through your own contract:

```typescript
// Direct execution (EOA)
const tx = await wallet.sendTransaction({
  to: quote.transaction.to,
  data: quote.transaction.data,
  value: quote.transaction.value,
  gasLimit: BigInt(quote.transaction.gas) * 130n / 100n, // 30% buffer
});

// Through your contract
const tx = await yourContract.executeSwap(
  quote.transaction.to,
  quote.transaction.data,
  { value: quote.transaction.value }
);
```

### Smart Contract Integration Pattern

For automated protocols, wrap the 0x call in your contract:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract SwapExecutor {
    // 0x AllowanceHolder - universal across chains
    address constant ALLOWANCE_HOLDER = 0x0000000000001fF3684f28c67538d4D072C22734;

    // Whitelist of allowed swap targets (0x Exchange Proxy, etc.)
    mapping(address => bool) public allowedTargets;

    function executeSwap(
        address sellToken,
        uint256 sellAmount,
        address swapTarget,
        bytes calldata swapCalldata,
        uint256 minBuyAmount
    ) external returns (uint256 buyAmount) {
        require(allowedTargets[swapTarget], "Target not allowed");

        // Approve AllowanceHolder to spend tokens
        IERC20(sellToken).approve(ALLOWANCE_HOLDER, sellAmount);

        // Record balance before
        uint256 balanceBefore = IERC20(buyToken).balanceOf(address(this));

        // Execute swap
        (bool success, ) = swapTarget.call(swapCalldata);
        require(success, "Swap failed");

        // Check output
        uint256 balanceAfter = IERC20(buyToken).balanceOf(address(this));
        buyAmount = balanceAfter - balanceBefore;
        require(buyAmount >= minBuyAmount, "Slippage exceeded");
    }
}
```

### Key Addresses

| Contract | Address | Notes |
|----------|---------|-------|
| 0x Exchange Proxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | Main swap entry point |
| AllowanceHolder | `0x0000000000001fF3684f28c67538d4D072C22734` | Approve here for allowance-holder quotes |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | For gasless approvals |

These addresses are **universal across all EVM chains**.

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `INSUFFICIENT_ASSET_LIQUIDITY` | Not enough liquidity | Try smaller amount or different route |
| `VALIDATION_FAILED` | Invalid parameters | Check token addresses, amounts |
| `GAS_ESTIMATE_FAILED` | Simulation failed | Token may have transfer restrictions |
| Rate limit (429) | Too many requests | Implement exponential backoff |

### Retry Strategy

```typescript
async function fetchQuoteWithRetry(
  params: QuoteParams,
  maxRetries = 3
): Promise<Quote0x> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await get0xQuote(params);
    } catch (error: any) {
      lastError = error;

      // Don't retry validation errors
      if (error.message?.includes('VALIDATION')) {
        throw error;
      }

      // Exponential backoff for rate limits
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
```

## Batch Swapping Strategy

For multiple token swaps, implement batch processing with retry logic:

```typescript
async function executeBatchSwaps(
  tokens: TokenToSwap[],
  buyToken: string,
  taker: string
): Promise<BatchResult> {
  const results: SwapResult[] = [];
  const BATCH_SIZE = 5; // Process 5 at a time

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);

    // Fetch quotes in parallel
    const quotes = await Promise.all(
      batch.map(async (token) => {
        try {
          const { quote, priceImpact } = await calculatePriceImpact(
            token.address,
            token.amount,
            token.decimals,
            buyToken,
            buyTokenDecimals,
            chainId,
            taker
          );
          return { token, quote, priceImpact, error: null };
        } catch (error: any) {
          return { token, quote: null, priceImpact: 0, error: error.message };
        }
      })
    );

    // Execute successful quotes
    for (const { token, quote, priceImpact, error } of quotes) {
      if (error || !quote) {
        results.push({ token, success: false, error: error || 'No quote' });
        continue;
      }

      const slippage = calculateDynamicSlippage(priceImpact);
      const minOutput = BigInt(quote.buyAmount) * BigInt(10000 - slippage) / 10000n;

      try {
        const txHash = await executeSwap(quote, minOutput);
        results.push({ token, success: true, txHash });
      } catch (execError: any) {
        // On failure, re-quote and retry once
        try {
          const { quote: freshQuote } = await calculatePriceImpact(...);
          const retrySlippage = calculateRetrySlippage(priceImpact);
          const retryMinOutput = BigInt(freshQuote.buyAmount) * BigInt(10000 - retrySlippage) / 10000n;
          const txHash = await executeSwap(freshQuote, retryMinOutput);
          results.push({ token, success: true, txHash, retried: true });
        } catch (retryError: any) {
          results.push({ token, success: false, error: retryError.message });
        }
      }
    }
  }

  return results;
}
```

## Supported Chains

| Chain | ID | Status |
|-------|-----|--------|
| Ethereum | 1 | Full support |
| Base | 8453 | Full support |
| Arbitrum | 42161 | Full support |
| Optimism | 10 | Full support |
| Polygon | 137 | Full support |
| BNB Chain | 56 | Full support |
| Avalanche | 43114 | Full support |
| Scroll | 534352 | Limited |
| Linea | 59144 | Limited |

## Best Practices for Automated Protocols

1. **Always simulate before executing** - Use `eth_call` to verify the swap will succeed
2. **Use dynamic slippage** - Base it on price impact, not fixed values
3. **Implement retry logic** - Re-quote and retry on failures
4. **Monitor price impact** - Skip swaps with >10% impact or alert
5. **Rate limit requests** - 0x has rate limits; implement backoff
6. **Whitelist swap targets** - Only allow calls to known 0x contracts
7. **Set minimum outputs** - Calculate from quote minus slippage
8. **Log everything** - Quote params, responses, and execution results
9. **Handle token edge cases** - Fee-on-transfer tokens, rebasing tokens
10. **Test on testnets first** - 0x has testnet support for major chains

## Example: Complete Swap Flow

```typescript
async function performSwap(
  sellToken: string,
  sellAmount: bigint,
  buyToken: string,
  chainId: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // 1. Get quote with price impact
    const { quote, priceImpact } = await calculatePriceImpact(
      sellToken,
      sellAmount,
      sellDecimals,
      buyToken,
      buyDecimals,
      chainId,
      contractAddress
    );

    // 2. Check price impact threshold
    if (priceImpact > 10) {
      return { success: false, error: `Price impact too high: ${priceImpact.toFixed(2)}%` };
    }

    // 3. Calculate slippage and minimum output
    const slippageBps = calculateDynamicSlippage(priceImpact);
    const minOutput = BigInt(quote.buyAmount) * BigInt(10000 - slippageBps) / 10000n;

    // 4. Check/set approval
    const allowance = await sellTokenContract.allowance(contractAddress, ALLOWANCE_HOLDER);
    if (allowance < sellAmount) {
      const approveTx = await sellTokenContract.approve(ALLOWANCE_HOLDER, MAX_UINT256);
      await approveTx.wait();
    }

    // 5. Execute swap
    const tx = await swapContract.executeSwap(
      sellToken,
      sellAmount,
      quote.transaction.to,
      quote.transaction.data,
      minOutput
    );
    const receipt = await tx.wait();

    return { success: true, txHash: receipt.hash };

  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
```

## Resources

- [0x API Documentation](https://0x.org/docs/api)
- [0x API Explorer](https://0x.org/docs/api#tag/Swap)
- [Supported DEX Sources](https://0x.org/docs/introduction/0x-cheat-sheet#dex-sources)
- [Chain Support](https://0x.org/docs/introduction/0x-cheat-sheet#networks)
