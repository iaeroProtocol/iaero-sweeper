// ============================================================================
// SOLANA SWEEPER CONFIGURATION
// ============================================================================

import { PublicKey } from '@solana/web3.js';

// Well-known Solana token mints
export const SOLANA_TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112', // Wrapped SOL
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  MNGO: 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac',
  MSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  JITOSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  BSOL: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
} as const;

// Jupiter API endpoints
export const JUPITER_API = {
  QUOTE: 'https://quote-api.jup.ag/v6/quote',
  SWAP: 'https://quote-api.jup.ag/v6/swap',
  SWAP_INSTRUCTIONS: 'https://quote-api.jup.ag/v6/swap-instructions',
  TOKENS: 'https://token.jup.ag/all',
} as const;

// Helius API (for token discovery)
export const HELIUS_API = {
  // Set via environment variable
  BASE_URL: 'https://api.helius.xyz/v0',
  RPC_URL: 'https://mainnet.helius-rpc.com',
} as const;

// Batch configuration
export const SOLANA_BATCH_CONFIG = {
  // Max swaps per transaction (conservative - adjust based on testing)
  MAX_SWAPS_PER_TX: 2,
  
  // Compute units to request per swap
  COMPUTE_UNITS_PER_SWAP: 400_000,
  
  // Priority fee in microlamports per compute unit
  PRIORITY_FEE_MICROLAMPORTS: 50_000,
  
  // Default slippage in basis points
  DEFAULT_SLIPPAGE_BPS: 100, // 1%
  
  // Minimum value to sweep (USD)
  MIN_VALUE_USD: 0.10,
  
  // Delay between batch transactions (ms)
  INTER_BATCH_DELAY_MS: 1000,
} as const;

// Token info type
export interface SolanaTokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  balanceFormatted: string;
  price: number;
  valueUsd: number;
  logoUrl?: string;
}

// Jupiter quote response
export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
}

// Jupiter swap instructions response
export interface JupiterSwapInstructions {
  tokenLedgerInstruction?: any;
  computeBudgetInstructions: any[];
  setupInstructions: any[];
  swapInstruction: any;
  cleanupInstruction?: any;
  addressLookupTableAddresses: string[];
}

// Swap result
export interface SolanaSwapResult {
  mint: string;
  symbol: string;
  status: 'success' | 'failed' | 'skipped';
  signature?: string;
  inputAmount: bigint;
  outputAmount?: bigint;
  error?: string;
}
