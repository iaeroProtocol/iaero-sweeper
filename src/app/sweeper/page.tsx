'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  useAccount, 
  usePublicClient, 
  useWriteContract,
  useChainId,
  useSwitchChain
} from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { 
  parseUnits, 
  formatUnits, 
  encodeAbiParameters,
  type Address 
} from 'viem';
import {
  Wallet,
  RefreshCw,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Coins,
  ArrowRight,
  Search,
  Settings,
  ChevronDown,
  ExternalLink,
  Zap,
  X,
  XCircle
} from 'lucide-react';

// ============================================================================
// CONFIGURATION
// ============================================================================

interface ChainConfig {
  name: string;
  swapper: Address;
  usdc: Address;
  usdcDecimals: number;
  weth: Address;
  allowanceHolder: Address;
  explorerUrl: string;
  coingeckoId: string;
}

const CHAIN_CONFIG: Record<number, ChainConfig> = {
  8453: { // Base
    name: 'Base',
    swapper: '0x25f11f947309df89bf4d36da5d9a9fb5f1e186c1',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
    weth: '0x4200000000000000000000000000000000000006',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://basescan.org',
    coingeckoId: 'base',
  },
  1: { // Ethereum
    name: 'Ethereum',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    usdcDecimals: 6,
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://etherscan.io',
    coingeckoId: 'ethereum',
  },
  42161: { // Arbitrum
    name: 'Arbitrum',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Native USDC
    usdcDecimals: 6,
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://arbiscan.io',
    coingeckoId: 'arbitrum-one',
  },
  10: { // Optimism
    name: 'Optimism',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // Native USDC
    usdcDecimals: 6,
    weth: '0x4200000000000000000000000000000000000006',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://optimistic.etherscan.io',
    coingeckoId: 'optimistic-ethereum',
  },
  137: { // Polygon - DEPLOYED
    name: 'Polygon',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Native USDC
    usdcDecimals: 6,
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // Bridged WETH
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://polygonscan.com',
    coingeckoId: 'polygon-pos',
  },
  56: { // BNB Chain - DEPLOYED
    name: 'BNB Chain',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC (18 decimals on BSC!)
    usdcDecimals: 18,
    weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://bscscan.com',
    coingeckoId: 'binance-smart-chain',
  },
  43114: { // Avalanche - DEPLOYED
    name: 'Avalanche',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Native USDC
    usdcDecimals: 6,
    weth: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://snowtrace.io',
    coingeckoId: 'avalanche',
  },
  534352: { // Scroll - DEPLOYED
    name: 'Scroll',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', // USDC
    usdcDecimals: 6,
    weth: '0x5300000000000000000000000000000000000004', // WETH
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://scrollscan.com',
    coingeckoId: 'scroll',
  },
  59144: { // Linea - DEPLOYED (different address due to nonce)
    name: 'Linea',
    swapper: '0x679e6e600E480d99f8aeD8555953AD2cF43bAB96',
    usdc: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', // USDC
    usdcDecimals: 6,
    weth: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f', // WETH
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://lineascan.build',
    coingeckoId: 'linea',
  },
};

const SWAPPER_ABI = [
  {
    name: 'executePlanFromCaller',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'plan',
        type: 'tuple[]',
        components: [
          { name: 'kind', type: 'uint8' },
          { name: 'tokenIn', type: 'address' },
          { name: 'outToken', type: 'address' },
          { name: 'useAll', type: 'bool' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'quotedIn', type: 'uint256' },
          { name: 'quotedOut', type: 'uint256' },
          { name: 'slippageBps', type: 'uint16' },
          { name: 'data', type: 'bytes' },
          { name: 'viaPermit2', type: 'bool' },
          { name: 'permitSig', type: 'bytes' },
          { name: 'permitAmount', type: 'uint256' },
          { name: 'permitDeadline', type: 'uint256' },
          { name: 'permitNonce', type: 'uint256' }
        ]
      },
      { name: 'recipient', type: 'address' }
    ],
    outputs: [{ type: 'uint256' }]
  }
] as const;

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }]
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }]
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }]
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  }
] as const;

// Router kind for aggregator swaps
const RouterKind = {
  AGGREGATOR: 2
} as const;

// ============================================================================
// TYPES
// ============================================================================

interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  balanceFormatted: string;
  price: number;
  valueUsd: number;
  logoUrl?: string;
}

interface TokenWithAmount extends TokenInfo {
  amountToSwap: bigint;
}

interface SwapQuote {
  token: TokenInfo;
  buyAmount: bigint;
  buyAmountFormatted: string;
  transactionTo: Address;
  transactionData: `0x${string}`;
  priceImpact: number;
}

interface SwapStep {
  kind: number;
  tokenIn: Address;
  outToken: Address;
  useAll: boolean;
  amountIn: bigint;
  quotedIn: bigint;
  quotedOut: bigint;
  slippageBps: number;
  data: `0x${string}`;
  viaPermit2: boolean;
  permitSig: `0x${string}`;
  permitAmount: bigint;
  permitDeadline: bigint;
  permitNonce: bigint;
}

interface SwapResultDetail {
  symbol: string;
  tokenIn: Address;
  amountIn: bigint;
  decimalsIn: number;
  inputValueUsd: number;        // DefiLlama valuation of input
  quotedOutputUsd: number;      // 0x quoted output value
  actualOutputUsd?: number;     // What was actually received
  executionSlippage: number;    // (quoted - actual) / quoted - TRUE efficiency
  totalCostPercent: number;     // (input - actual) / input - includes all fees/spreads
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

// Raw token info before pricing (for caching)
interface RawTokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  balance: string; // Stored as string for JSON serialization
  logoUrl?: string;
}

// ============================================================================
// CACHING SYSTEM
// ============================================================================

// Cache TTLs
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const FAILED_TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 hours
const EXTERNAL_SPAM_LIST_TTL = 24 * 60 * 60 * 1000; // 24 hours

// External spam list URLs (raw GitHub)
const EXTERNAL_SPAM_LISTS: Record<number, string> = {
  8453: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_base.json',
  1: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_ethereum.json',
  42161: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_arbitrum.json',
  10: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_optimism.json',
  137: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_polygon.json',
  56: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_bnb.json',
  43114: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_avalanche.json',
  534352: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_scroll.json',
  59144: 'https://raw.githubusercontent.com/iaeroProtocol/ChainProcessingBot/main/data/spam_tokens_linea.json',
};

// In-memory cache for external spam lists (avoids refetching within session)
const externalSpamCache: Map<number, { addresses: Set<string>; timestamp: number }> = new Map();

// Fetch external spam list from GitHub (with localStorage caching)
async function fetchExternalSpamList(chainId: number): Promise<Set<string>> {
  const url = EXTERNAL_SPAM_LISTS[chainId];
  if (!url) return new Set();
  
  // Check in-memory cache first
  const memCached = externalSpamCache.get(chainId);
  if (memCached && Date.now() - memCached.timestamp < EXTERNAL_SPAM_LIST_TTL) {
    console.log(`📋 Using in-memory spam list for chain ${chainId}: ${memCached.addresses.size} addresses`);
    return memCached.addresses;
  }
  
  // Check localStorage cache
  if (typeof window !== 'undefined') {
    try {
      const key = `sweeper_external_spam_${chainId}`;
      const cached = localStorage.getItem(key);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < EXTERNAL_SPAM_LIST_TTL) {
          const addresses = new Set<string>(data.addresses);
          externalSpamCache.set(chainId, { addresses, timestamp: data.timestamp });
          console.log(`📋 Using localStorage spam list for chain ${chainId}: ${addresses.size} addresses`);
          return addresses;
        }
      }
    } catch (e) {
      console.warn('Failed to read external spam cache:', e);
    }
  }
  
  // Fetch from GitHub
  try {
    console.log(`📥 Fetching external spam list for chain ${chainId}...`);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      console.warn(`Failed to fetch spam list: ${res.status}`);
      return new Set();
    }
    
    const data = await res.json();
    
    // Support multiple formats:
    // 1. Array of addresses: ["0x...", "0x..."]
    // 2. Object with tokens array: { tokens: [{ address: "0x..." }, ...] }
    // 3. Object with address keys: { "0x...": true }
    let addresses: string[] = [];
    let patterns: string[] = [];
    
    if (Array.isArray(data)) {
      // Simple array format
      addresses = data.map(a => String(a).toLowerCase());
    } else if (typeof data === 'object' && data !== null) {
      // Check for tokens array (iaeroProtocol format)
      if (data.tokens && Array.isArray(data.tokens)) {
        addresses = data.tokens
          .filter((t: any) => t)
          .map((t: any) => {
            // Handle both { address: "0x..." } and plain "0x..." formats
            if (typeof t === 'string') return t.toLowerCase();
            if (t.address) return String(t.address).toLowerCase();
            return null;
          })
          .filter((a: string | null) => a !== null);
        console.log(`  📋 Parsed ${addresses.length} addresses from tokens array`);
      } 
      // Check for symbolPatterns (for heuristic filtering)
      if (data.symbolPatterns && Array.isArray(data.symbolPatterns)) {
        patterns = data.symbolPatterns.map((p: string) => p.toLowerCase());
        console.log(`  🔍 Loaded ${patterns.length} symbol patterns for heuristic detection`);
      }
      // Fallback: object with address keys
      if (addresses.length === 0 && !data.tokens) {
        addresses = Object.keys(data)
          .filter(k => k.startsWith('0x'))
          .map(a => a.toLowerCase());
      }
    }
    
    const addressSet = new Set(addresses);
    console.log(`✅ Loaded ${addressSet.size} spam addresses for chain ${chainId}`);
    
    // Cache in memory (include patterns for future use)
    externalSpamCache.set(chainId, { addresses: addressSet, timestamp: Date.now() });
    
    // Also cache symbol patterns if present
    if (patterns.length > 0 && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`sweeper_spam_patterns_${chainId}`, JSON.stringify(patterns));
      } catch (e) {
        console.warn('Failed to cache spam patterns:', e);
      }
    }
    
    // Cache in localStorage
    if (typeof window !== 'undefined') {
      try {
        const key = `sweeper_external_spam_${chainId}`;
        localStorage.setItem(key, JSON.stringify({
          addresses: Array.from(addressSet),
          timestamp: Date.now()
        }));
      } catch (e) {
        console.warn('Failed to write external spam cache:', e);
      }
    }
    
    return addressSet;
  } catch (e) {
    console.warn('Failed to fetch external spam list:', e);
    return new Set();
  }
}

// Price cache (localStorage with 5 min TTL)
function getPriceCacheKey(chainId: number): string {
  return `sweeper_prices_${chainId}`;
}

function getCachedPrices(chainId: number): Record<string, { price: number; timestamp: number }> {
  if (typeof window === 'undefined') return {};
  try {
    const key = getPriceCacheKey(chainId);
    const cached = localStorage.getItem(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn('Failed to read price cache:', e);
  }
  return {};
}

function getCachedPrice(chainId: number, tokenAddress: string): number | null {
  const allPrices = getCachedPrices(chainId);
  const entry = allPrices[tokenAddress.toLowerCase()];
  if (entry && Date.now() - entry.timestamp < PRICE_CACHE_TTL) {
    return entry.price;
  }
  return null;
}

function setCachedPrice(chainId: number, tokenAddress: string, price: number): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getPriceCacheKey(chainId);
    const allPrices = getCachedPrices(chainId);
    allPrices[tokenAddress.toLowerCase()] = { price, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(allPrices));
  } catch (e) {
    console.warn('Failed to write price cache:', e);
  }
}

function clearPriceCache(chainId: number): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getPriceCacheKey(chainId);
    localStorage.removeItem(key);
    console.log('🗑️ Cleared price cache');
  } catch (e) {
    console.warn('Failed to clear price cache:', e);
  }
}

// Token cache (localStorage)
function getTokenCacheKey(address: string, chainId: number): string {
  return `sweeper_tokens_${address.toLowerCase()}_${chainId}`;
}

function getCachedTokens(address: string, chainId: number): RawTokenInfo[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getTokenCacheKey(address, chainId);
    const cached = localStorage.getItem(key);
    if (cached) {
      const data = JSON.parse(cached);
      // No TTL for tokens - valid until swap or manual refresh
      return data.tokens;
    }
  } catch (e) {
    console.warn('Failed to read token cache:', e);
  }
  return null;
}

function setCachedTokens(address: string, chainId: number, tokens: RawTokenInfo[]): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getTokenCacheKey(address, chainId);
    localStorage.setItem(key, JSON.stringify({ tokens, timestamp: Date.now() }));
  } catch (e) {
    console.warn('Failed to write token cache:', e);
  }
}

function clearTokenCache(address: string, chainId: number): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getTokenCacheKey(address, chainId);
    localStorage.removeItem(key);
    console.log('🗑️ Cleared token cache');
  } catch (e) {
    console.warn('Failed to clear token cache:', e);
  }
}

// Failed token cache (localStorage) - tracks tokens that returned no quote (runtime spam detection)
function getFailedTokensCacheKey(chainId: number): string {
  return `sweeper_failed_${chainId}`;
}

function getFailedTokens(chainId: number): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const key = getFailedTokensCacheKey(chainId);
    const cached = localStorage.getItem(key);
    if (cached) {
      const data = JSON.parse(cached);
      const now = Date.now();
      // Filter out expired entries
      const valid: Record<string, number> = {};
      for (const [addr, ts] of Object.entries(data)) {
        if (now - (ts as number) < FAILED_TOKEN_TTL) {
          valid[addr] = ts as number;
        }
      }
      // Update cache if we removed expired entries
      if (Object.keys(valid).length !== Object.keys(data).length) {
        localStorage.setItem(key, JSON.stringify(valid));
      }
      return new Set(Object.keys(valid));
    }
  } catch (e) {
    console.warn('Failed to read failed tokens cache:', e);
  }
  return new Set();
}

function markTokenAsFailed(chainId: number, tokenAddress: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getFailedTokensCacheKey(chainId);
    const cached = localStorage.getItem(key);
    const data = cached ? JSON.parse(cached) : {};
    data[tokenAddress.toLowerCase()] = Date.now();
    localStorage.setItem(key, JSON.stringify(data));
    console.log(`🚫 Marked ${tokenAddress.slice(0, 10)}... as failed/spam`);
  } catch (e) {
    console.warn('Failed to write failed token cache:', e);
  }
}

function clearFailedTokensCache(chainId: number): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getFailedTokensCacheKey(chainId);
    localStorage.removeItem(key);
    console.log('🗑️ Cleared failed tokens cache');
  } catch (e) {
    console.warn('Failed to clear failed tokens cache:', e);
  }
}

// Track tokens that fail to get prices (no liquidity)
// After PRICE_FAIL_THRESHOLD consecutive failures, auto-mark as spam
const PRICE_FAIL_THRESHOLD = 2;

function getPriceFailureCacheKey(chainId: number): string {
  return `sweeper_price_failures_${chainId}`;
}

function getPriceFailures(chainId: number): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const cached = localStorage.getItem(getPriceFailureCacheKey(chainId));
    return cached ? JSON.parse(cached) : {};
  } catch (e) {
    return {};
  }
}

function incrementPriceFailure(chainId: number, tokenAddress: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const key = getPriceFailureCacheKey(chainId);
    const failures = getPriceFailures(chainId);
    const addr = tokenAddress.toLowerCase();
    failures[addr] = (failures[addr] || 0) + 1;
    localStorage.setItem(key, JSON.stringify(failures));
    return failures[addr];
  } catch (e) {
    return 0;
  }
}

function clearPriceFailure(chainId: number, tokenAddress: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getPriceFailureCacheKey(chainId);
    const failures = getPriceFailures(chainId);
    delete failures[tokenAddress.toLowerCase()];
    localStorage.setItem(key, JSON.stringify(failures));
  } catch (e) {
    // ignore
  }
}

// Get combined spam list (external + runtime failures)
async function getAllSpamTokens(chainId: number): Promise<Set<string>> {
  const externalSpam = await fetchExternalSpamList(chainId);
  const runtimeSpam = getFailedTokens(chainId);
  
  // Combine both sets
  const combined = new Set([...externalSpam, ...runtimeSpam]);
  console.log(`🚫 Total spam tokens: ${combined.size} (${externalSpam.size} external + ${runtimeSpam.size} runtime)`);
  return combined;
}

// Get spam symbol patterns for heuristic detection
function getSpamPatterns(chainId: number): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const cached = localStorage.getItem(`sweeper_spam_patterns_${chainId}`);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn('Failed to read spam patterns:', e);
  }
  return [];
}

// Check if a token symbol matches spam patterns
function isSpamBySymbol(symbol: string, patterns: string[]): boolean {
  if (!symbol || patterns.length === 0) return false;
  const lowerSymbol = symbol.toLowerCase();
  return patterns.some(pattern => lowerSymbol.includes(pattern.toLowerCase()));
}

// Debug: Get cache stats
function getCacheStats(chainId: number, walletAddress?: string): {
  externalSpam: number;
  runtimeSpam: number;
  cachedPrices: number;
  cachedTokens: number;
} {
  const externalCached = externalSpamCache.get(chainId);
  const runtimeSpam = getFailedTokens(chainId);
  const prices = getCachedPrices(chainId);
  let tokenCount = 0;
  if (walletAddress) {
    const tokens = getCachedTokens(walletAddress, chainId);
    tokenCount = tokens?.length || 0;
  }
  
  return {
    externalSpam: externalCached?.addresses.size || 0,
    runtimeSpam: runtimeSpam.size,
    cachedPrices: Object.keys(prices).length,
    cachedTokens: tokenCount
  };
}

interface QuotePreviewItem {
  token: TokenInfo & { amountToSwap: bigint };
  inputValueUsd: number;      // From 0x if available, else DefiLlama
  quotedOutputUsd: number;
  lossPercent: number;
  lossUsd: number;
  quote: SwapQuote;
  selected: boolean;
  forceHighSlippage?: boolean; // Allow user to override slippage cap for high-impact swaps
}

interface FailedQuoteItem {
  token: TokenInfo & { amountToSwap: bigint };
  error: string;
}

interface QuotePreviewData {
  quotes: QuotePreviewItem[];
  failedQuotes: FailedQuoteItem[];
  outputToken: 'USDC' | 'WETH';
  outputPrice: number;
  outputDecimals: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatNumber(num: number, decimals: number = 2): string {
  if (num === 0) return '0';
  if (num < 0.0001) return '< 0.0001';
  if (num < 1) return num.toFixed(Math.min(decimals + 2, 6));
  if (num < 1000) return num.toFixed(decimals);
  if (num < 1000000) return `${(num / 1000).toFixed(1)}K`;
  return `${(num / 1000000).toFixed(2)}M`;
}

function formatUSD(value: number): string {
  if (value < 0.01) return '< $0.01';
  return `$${formatNumber(value)}`;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TokenSweeperPage() {
  // Wallet state
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();

  // UI state
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false); // Track if we've attempted scan (prevents loops)
  
  // Manual token input
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [manualTokens, setManualTokens] = useState<Set<string>>(new Set());
  const [manualTokensLoaded, setManualTokensLoaded] = useState(false);
  const [isAddingToken, setIsAddingToken] = useState(false);
  
  // Load manual tokens from localStorage on mount/chain change
  useEffect(() => {
    if (typeof window !== 'undefined' && chainId) {
      const stored = localStorage.getItem(`manualTokens_${chainId}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setManualTokens(new Set(parsed.map((a: string) => a.toLowerCase())));
          console.log(`📌 Loaded ${parsed.length} manual tokens for chain ${chainId}`);
        } catch (e) {
          console.warn('Failed to load manual tokens:', e);
        }
      } else {
        setManualTokens(new Set());
      }
      setManualTokensLoaded(true);
    }
  }, [chainId]);
  
  // Save manual tokens to localStorage
  const saveManualTokens = useCallback((tokens: Set<string>) => {
    if (typeof window !== 'undefined' && chainId) {
      localStorage.setItem(`manualTokens_${chainId}`, JSON.stringify(Array.from(tokens)));
    }
  }, [chainId]);
  
  // Token state
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  
  // Output token
  const [outputToken, setOutputToken] = useState<'USDC' | 'WETH'>('USDC');
  
  // Quote preview modal
  const [showQuotePreview, setShowQuotePreview] = useState(false);
  const [quotePreviewData, setQuotePreviewData] = useState<QuotePreviewData | null>(null);
  
  // Transaction results
  const [txHash, setTxHash] = useState<string | null>(null);
  const [swapResults, setSwapResults] = useState<{
    success: number;
    failed: number;
    totalValue: number;
  } | null>(null);
  const [detailedResults, setDetailedResults] = useState<SwapResultDetail[]>([]);
  const [showResultsModal, setShowResultsModal] = useState(false);

  // Chain config
  const config = CHAIN_CONFIG[chainId] || CHAIN_CONFIG[8453];
  const supportedChain = !!CHAIN_CONFIG[chainId];

  // Clear tokens and rescan when wallet address or chain changes
  useEffect(() => {
    // Clear all state when wallet changes
    setTokens([]);
    setSelectedTokens(new Set());
    setCustomAmounts({});
    setQuotePreviewData(null);
    setSwapResults(null);
    setDetailedResults([]);
    setError(null);
    setTxHash(null);
    
    // Don't auto-scan if not connected or unsupported chain
    if (!address || !supportedChain) return;
    
    console.log(`🔄 Wallet changed to ${address.slice(0, 8)}... on chain ${chainId}`);
    
  }, [address, chainId, supportedChain]);

  // Remove output token from selection when output token changes
  useEffect(() => {
    const outputTokenAddr = outputToken === 'USDC' ? config.usdc : config.weth;
    setSelectedTokens((prev: Set<string>) => {
      const newSet = new Set(prev);
      newSet.delete(outputTokenAddr);
      // Also handle lowercase comparison
      for (const addr of prev) {
        if (addr.toLowerCase() === outputTokenAddr.toLowerCase()) {
          newSet.delete(addr);
        }
      }
      return newSet;
    });
  }, [outputToken, config]);

  // ============================================================================
  // TOKEN SCANNING
  // ============================================================================

  const scanWalletTokens = useCallback(async (forceRefresh = false) => {
    if (!address || !publicClient || !supportedChain) return;
    
    setIsScanning(true);
    setError(null);
    setTokens([]);
    
    try {
      // Check for cached tokens (unless force refresh)
      let rawTokens: RawTokenInfo[] | null = null;
      
      if (!forceRefresh) {
        rawTokens = getCachedTokens(address, chainId);
        if (rawTokens) {
          console.log(`📦 Using cached tokens: ${rawTokens.length} tokens`);
          
          // Merge manual tokens into cached list (they may have been added after caching)
          if (manualTokens.size > 0) {
            const cachedAddrs = new Set(rawTokens.map(t => t.address.toLowerCase()));
            const manualArray: string[] = [...manualTokens];
            const missingManual = manualArray.filter((addr: string) => !cachedAddrs.has(addr.toLowerCase()));
            
            if (missingManual.length > 0) {
              console.log(`📌 Fetching ${missingManual.length} manual tokens not in cache...`);
              setProgressStep(`Fetching ${missingManual.length} manual tokens...`);
              
              const manualInfos = await fetchTokenInfos(missingManual as Address[], address, publicClient);
              const validManual = manualInfos.filter(t => t.balance > 0n);
              
              // Add to rawTokens
              for (const t of validManual) {
                rawTokens.push({
                  address: t.address,
                  symbol: t.symbol,
                  name: t.name,
                  decimals: t.decimals,
                  balance: t.balance.toString(),
                  logoUrl: t.logoUrl
                });
              }
              
              if (validManual.length > 0) {
                console.log(`📌 Added ${validManual.length} manual tokens to cached list`);
                // Update cache with new tokens
                setCachedTokens(address, chainId, rawTokens);
              }
            }
          }
        }
      } else {
        // Force refresh - clear token and price caches, but KEEP spam cache
        clearTokenCache(address, chainId);
        clearPriceCache(chainId);
        console.log('🔄 Force refresh - cleared token and price caches (spam list preserved)');
      }
      
      // Fetch tokens if not cached
      if (!rawTokens) {
        setProgressStep('Fetching token list...');
        
        // Fetch token list from multiple sources
        let tokenAddresses = await fetchTokenList(chainId, address);
        
        // Merge with manual tokens (always include these)
        if (manualTokens.size > 0) {
          const manualAddrs = Array.from(manualTokens) as Address[];
          const existingSet = new Set(tokenAddresses.map(a => a.toLowerCase()));
          for (const addr of manualAddrs) {
            if (!existingSet.has(addr.toLowerCase())) {
              tokenAddresses.push(addr as Address);
            }
          }
          console.log(`📌 Added ${manualTokens.size} manual tokens to scan`);
        }
        
        if (tokenAddresses.length === 0) {
          setError('No tokens found in wallet');
          return;
        }
        
        setProgressStep(`Checking ${tokenAddresses.length} tokens...`);
        
        // Get token info and balances via multicall
        const tokenInfos = await fetchTokenInfos(tokenAddresses, address, publicClient);
        
        // Filter tokens with balance > 0
        const validTokens = tokenInfos.filter(t => t.balance > 0n);
        
        if (validTokens.length === 0) {
          setError('No swappable tokens found in wallet');
          return;
        }
        
        // Convert to raw tokens for caching (bigint -> string)
        rawTokens = validTokens.map(t => ({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          balance: t.balance.toString(),
          logoUrl: t.logoUrl
        }));
        
        // Cache the tokens
        setCachedTokens(address, chainId, rawTokens);
        console.log(`💾 Cached ${rawTokens.length} tokens`);
      }
      
      setProgressStep('Loading spam lists...');
      
      // Get combined spam list (external GitHub list + runtime failures)
      const spamTokens = await getAllSpamTokens(chainId);
      
      // Get spam symbol patterns for heuristic detection
      const spamPatterns = getSpamPatterns(chainId);
      
      // Pre-filter raw tokens to remove spam BEFORE price fetching
      let patternMatches = 0;
      const nonSpamRawTokens = rawTokens.filter(t => {
        // Check address blacklist
        if (spamTokens.has(t.address.toLowerCase())) {
          return false;
        }
        // Check symbol patterns (heuristic detection)
        if (isSpamBySymbol(t.symbol, spamPatterns)) {
          patternMatches++;
          console.log(`🔍 Pattern match: ${t.symbol} (${t.address.slice(0, 10)}...)`);
          // Also mark it as spam for future runs
          markTokenAsFailed(chainId, t.address);
          return false;
        }
        return true;
      });
      
      const spamRemoved = rawTokens.length - nonSpamRawTokens.length;
      if (spamRemoved > 0) {
        console.log(`🧹 Pre-filtered ${spamRemoved} spam tokens (${patternMatches} by pattern)`);
      }
      
      setProgressStep('Fetching market prices...');
      
      // Use chain config for output token
      const outputTokenAddr = config.usdc;
      
      // Check which tokens need price fetching
      const tokensNeedingPrices: Array<{ address: Address; decimals: number; balance: bigint; symbol: string }> = [];
      const cachedPrices: Record<string, number> = {};
      
      for (const t of nonSpamRawTokens) {
        const addrLower = t.address.toLowerCase();
        
        // Check price cache
        const cachedPrice = getCachedPrice(chainId, t.address);
        if (cachedPrice !== null) {
          cachedPrices[addrLower] = cachedPrice;
        } else {
          tokensNeedingPrices.push({
            address: t.address as Address,
            decimals: t.decimals,
            balance: BigInt(t.balance),
            symbol: t.symbol
          });
        }
      }
      
      console.log(`💰 Using ${Object.keys(cachedPrices).length} cached prices, fetching ${tokensNeedingPrices.length} new`);
      
      // Fetch prices for tokens that need them
      let fetchedPrices: Record<string, number> = {};
      if (tokensNeedingPrices.length > 0) {
        fetchedPrices = await fetchMarketPrices(tokensNeedingPrices, chainId, outputTokenAddr, setProgressStep);
        
        // Cache the fetched prices and mark failures
        for (const t of tokensNeedingPrices) {
          const addrLower = t.address.toLowerCase();
          if (fetchedPrices[addrLower]) {
            setCachedPrice(chainId, t.address, fetchedPrices[addrLower]);
          } else {
            // Mark as failed (spam token)
            markTokenAsFailed(chainId, t.address);
          }
        }
      }
      
      // Combine cached and fetched prices
      const allPrices = { ...cachedPrices, ...fetchedPrices };
      
      // Known stablecoins (fallback to $1 if 0x quote fails)
      const KNOWN_STABLECOINS: Record<number, Record<string, number>> = {
        1: { // Ethereum mainnet
          '0xdac17f958d2ee523a2206206994597c13d831ec7': 1, // USDT
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1, // USDC
          '0x6b175474e89094c44da98b954eedeac495271d0f': 1, // DAI
          '0x4fabb145d64652a948d72533023f6e7a623c7c53': 1, // BUSD
          '0x8e870d67f660d95d5be530380d0ec0bd388289e1': 1, // USDP
          '0x0000000000085d4780b73119b644ae5ecd22b376': 1, // TUSD
          '0x853d955acef822db058eb8505911ed77f175b99e': 1, // FRAX
          '0x5f98805a4e8be255a32880fdec7f6728c6568ba0': 1, // LUSD
          '0x57ab1ec28d129707052df4df418d58a2d46d5f51': 1, // sUSD
        },
        8453: { // Base
          '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 1, // USDC
          '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 1, // USDbC
          '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 1, // DAI
        },
        42161: { // Arbitrum
          '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 1, // USDC
          '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 1, // USDC.e
          '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 1, // USDT
          '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 1, // DAI
        },
        10: { // Optimism
          '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 1, // USDC
          '0x7f5c764cbc14f9669b88837ca1490cca17c31607': 1, // USDC.e
          '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 1, // USDT
          '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 1, // DAI
          '0x2e3d870790dc77a83dd1d18184acc7439a53f475': 1, // FRAX
          '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9': 1, // sUSD
        },
        137: { // Polygon
          '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 1, // USDC
          '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 1, // USDC.e
          '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 1, // USDT
          '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 1, // DAI
          '0x45c32fa6df82ead1e2ef74d17b76547eddfaff89': 1, // FRAX
        },
        56: { // BNB Chain
          '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 1, // USDC
          '0x55d398326f99059ff775485246999027b3197955': 1, // USDT
          '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': 1, // DAI
          '0xe9e7cea3dedca5984780bafc599bd69add087d56': 1, // BUSD
          '0x14016e85a25aeb13065688cafb43044c2ef86784': 1, // TUSD
        },
        43114: { // Avalanche
          '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 1, // USDC
          '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664': 1, // USDC.e
          '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7': 1, // USDT
          '0xd586e7f844cea2f87f50152665bcbc2c279d8d70': 1, // DAI.e
          '0x130966628846bfd36ff31a822705796e8cb8c18d': 1, // MIM
        },
        534352: { // Scroll
          '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4': 1, // USDC
          '0xf55bec9cafdbe8730f096aa55dad6d22d44099df': 1, // USDT
        },
        59144: { // Linea
          '0x176211869ca2b568f2a7d4ee941e073a821ee1ff': 1, // USDC
          '0xa219439258ca9da29e9cc4ce5596924745e12b93': 1, // USDT
          '0x4af15ec2a0bd43db75dd04e62faa3b8ef36b00d5': 1, // DAI
        }
      };
      
      const chainStables = KNOWN_STABLECOINS[chainId] || {};
      
      // Enrich tokens with prices (already filtered for spam)
      const enrichedTokens = nonSpamRawTokens
        .map(t => {
          const addrLower = t.address.toLowerCase();
          // Use price, or fallback to stablecoin price
          const price = allPrices[addrLower] || chainStables[addrLower] || 0;
          const balance = BigInt(t.balance);
          const balanceNum = Number(formatUnits(balance, t.decimals));
          
          // Log if we used stablecoin fallback
          if (!allPrices[addrLower] && chainStables[addrLower]) {
            console.log(`💵 Using stablecoin fallback for ${t.symbol}: $${chainStables[addrLower]}`);
          }
          
          return {
            address: t.address as Address,
            symbol: t.symbol,
            name: t.name,
            decimals: t.decimals,
            balance,
            price,
            valueUsd: balanceNum * price,
            balanceFormatted: formatNumber(balanceNum, 4),
            logoUrl: t.logoUrl
          };
        }).filter(t => t.valueUsd >= 0.10); // Filter dust < $0.10
      
      // Sort by value descending
      enrichedTokens.sort((a, b) => b.valueUsd - a.valueUsd);
      
      setTokens(enrichedTokens);
      setSelectedTokens(new Set(enrichedTokens.map(t => t.address)));
      setCustomAmounts({});
      
    } catch (err: any) {
      console.error('Scan error:', err);
      setError(err.message || 'Failed to scan wallet');
    } finally {
      setIsScanning(false);
      setProgressStep('');
      setHasScanned(true); // Mark that we've attempted a scan
    }
  }, [address, publicClient, chainId, supportedChain, config, manualTokens]);

  // Reset hasScanned when wallet or chain changes
  useEffect(() => {
    setHasScanned(false);
  }, [address, chainId]);

  // Auto-scan when wallet connects or changes (wait for manual tokens to load first)
  useEffect(() => {
    if (address && supportedChain && !isScanning && !hasScanned && tokens.length === 0 && manualTokensLoaded) {
      // Small delay to let wallet connection settle
      const timer = setTimeout(() => {
        console.log('🔄 Auto-scanning new wallet...');
        scanWalletTokens();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [address, supportedChain, scanWalletTokens, isScanning, hasScanned, tokens.length, manualTokensLoaded]);

  // Fetch token list from unified API (handles all providers server-side)
  async function fetchTokenList(chainId: number, wallet: string): Promise<Address[]> {
    try {
      console.log('🔍 Fetching tokens via unified discovery API...');
      const res = await fetch(
        `/api/tokens/discover?chainId=${chainId}&wallet=${wallet}`
      );
      
      if (res.ok) {
        const data = await res.json();
        // Log the provider attempts
        if (data.logs) {
          data.logs.forEach((log: string) => console.log(`  📡 ${log}`));
        }
        console.log(`✅ Found ${data.count} tokens`);
        return data.tokens as Address[];
      } else {
        console.error('Token discovery API error:', res.status);
        return [];
      }
    } catch (e) {
      console.error('Token discovery failed:', e);
      return [];
    }
  }

  // Fetch token info via multicall
  async function fetchTokenInfos(
    addresses: Address[], 
    wallet: string, 
    client: any
  ): Promise<TokenInfo[]> {
    const calls = addresses.flatMap(addr => [
      { address: addr, abi: ERC20_ABI, functionName: 'symbol' },
      { address: addr, abi: ERC20_ABI, functionName: 'name' },
      { address: addr, abi: ERC20_ABI, functionName: 'decimals' },
      { address: addr, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet as Address] }
    ]);
    
    const results = await client.multicall({ contracts: calls });
    
    return addresses.map((addr, i) => {
      const symbolRes = results[i * 4];
      const nameRes = results[i * 4 + 1];
      const decimalsRes = results[i * 4 + 2];
      const balanceRes = results[i * 4 + 3];
      
      return {
        address: addr,
        symbol: symbolRes.status === 'success' ? (symbolRes.result as string) : 'UNKNOWN',
        name: nameRes.status === 'success' ? (nameRes.result as string) : 'Unknown Token',
        decimals: decimalsRes.status === 'success' ? Number(decimalsRes.result) : 18,
        balance: balanceRes.status === 'success' ? (balanceRes.result as bigint) : 0n,
        balanceFormatted: '0',
        price: 0,
        valueUsd: 0
      };
    });
  }

  // Fetch prices from 0x quotes (accurate market prices) - batched for speed
  async function fetchMarketPrices(
    tokens: Array<{ address: Address; decimals: number; balance: bigint; symbol: string }>,
    chainId: number,
    outputToken: Address,
    onProgress?: (msg: string) => void
  ): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    const outputPrice = 1; // USDC = $1
    
    // Get swapper address from chain config
    const chainConfig = CHAIN_CONFIG[chainId];
    if (!chainConfig) {
      console.warn(`No config for chain ${chainId}`);
      return prices;
    }
    const swapperAddress = chainConfig.swapper;
    const outputDecimals = chainConfig.usdcDecimals;
    
    console.log(`📊 Fetching market prices from 0x for ${tokens.length} tokens...`);
    
    // Track failures for summary
    const failedTokens: { address: string; symbol: string; reason: string }[] = [];
    const autoSpammed: string[] = [];
    
    // Process in batches of 5 to avoid rate limiting
    const BATCH_SIZE = 5;
    const BATCH_DELAY = 1500; // 1.5 seconds between batches
    const totalBatches = Math.ceil(tokens.length / BATCH_SIZE);
    
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      onProgress?.(`Fetching prices (${batchNum}/${totalBatches})...`);
      
      // Fetch all quotes in batch in parallel
      const batchPromises = batch.map(async (token) => {
        try {
          const refAmount = parseUnits('1', token.decimals);
          
          const params = new URLSearchParams({
            chainId: String(chainId),
            sellToken: token.address,
            buyToken: outputToken,
            sellAmount: refAmount.toString(),
            taker: swapperAddress
          });
          
          const res = await fetch(`/api/0x/quote?${params}`);
          if (!res.ok) {
            failedTokens.push({ address: token.address, symbol: token.symbol, reason: `HTTP ${res.status}` });
            // Track failure
            const failCount = incrementPriceFailure(chainId, token.address);
            if (failCount >= PRICE_FAIL_THRESHOLD) {
              markTokenAsFailed(chainId, token.address);
              autoSpammed.push(`${token.symbol} (${token.address.slice(0, 10)}...)`);
            }
            return null;
          }
          
          const quote = await res.json();
          
          if (quote?.buyAmount) {
            const buyAmountNum = Number(formatUnits(BigInt(quote.buyAmount), outputDecimals));
            const sellAmountNum = Number(formatUnits(refAmount, token.decimals));
            const pricePerToken = (buyAmountNum / sellAmountNum) * outputPrice;
            // Success - clear any previous failures
            clearPriceFailure(chainId, token.address);
            return { address: token.address.toLowerCase(), price: pricePerToken };
          }
          
          // No buyAmount = no liquidity
          failedTokens.push({ address: token.address, symbol: token.symbol, reason: 'no liquidity' });
          const failCount = incrementPriceFailure(chainId, token.address);
          if (failCount >= PRICE_FAIL_THRESHOLD) {
            markTokenAsFailed(chainId, token.address);
            autoSpammed.push(`${token.symbol} (${token.address.slice(0, 10)}...)`);
          }
          return null;
        } catch (err: any) {
          failedTokens.push({ address: token.address, symbol: token.symbol, reason: err.message?.slice(0, 30) || 'error' });
          const failCount = incrementPriceFailure(chainId, token.address);
          if (failCount >= PRICE_FAIL_THRESHOLD) {
            markTokenAsFailed(chainId, token.address);
            autoSpammed.push(`${token.symbol} (${token.address.slice(0, 10)}...)`);
          }
          return null;
        }
      });
      
      const results = await Promise.all(batchPromises);
      
      // Collect successful prices
      for (const result of results) {
        if (result) {
          prices[result.address] = result.price;
        }
      }
      
      // Delay between batches (skip delay after last batch)
      if (i + BATCH_SIZE < tokens.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }
    
    // Summary logs
    const successCount = Object.keys(prices).length;
    console.log(`  ✅ Got prices for ${successCount}/${tokens.length} tokens`);
    if (failedTokens.length > 0) {
      console.log(`  ⚠️ ${failedTokens.length} tokens had no price (no liquidity or API error)`);
    }
    if (autoSpammed.length > 0) {
      console.log(`  🚫 Auto-marked ${autoSpammed.length} tokens as spam (${PRICE_FAIL_THRESHOLD}+ failures): ${autoSpammed.join(', ')}`);
    }
    
    return prices;
  }

  // Fallback: Fetch prices from DefiLlama (less accurate but fast)
  async function fetchDefiLlamaPrices(addresses: Address[], chainId: number): Promise<Record<string, number>> {
    const chainNameMap: Record<number, string> = {
      1: 'ethereum',
      8453: 'base',
      42161: 'arbitrum',
      10: 'optimism',
      137: 'polygon',
      56: 'bsc',
      43114: 'avax',
      534352: 'scroll',
      59144: 'linea',
    };
    const chainName = chainNameMap[chainId] || 'ethereum';
    const ids = addresses.map(a => `${chainName}:${a}`).join(',');
    
    try {
      const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
      const data = await res.json();
      
      const prices: Record<string, number> = {};
      for (const [key, val] of Object.entries<any>(data.coins || {})) {
        const addr = key.split(':')[1]?.toLowerCase();
        if (addr && val?.price) {
          prices[addr] = Number(val.price);
        }
      }
      return prices;
    } catch {
      return {};
    }
  }

  // ============================================================================
  // SWAP EXECUTION WITH ROBUST BATCH HANDLING
  // ============================================================================

  // Simulate each swap individually to find failures (parallel)
  const simulateSwaps = async (plan: SwapStep[], recipient: Address): Promise<{
    passing: SwapStep[];
    failing: Array<{ swap: SwapStep; error: string }>;
  }> => {
    console.log(`\n🧪 === SIMULATION PHASE ===`);
    console.log(`Testing ${plan.length} swaps in parallel on chain ${chainId}...`);
    console.log(`Contract: ${config.swapper}`);
    
    // Log each swap's parameters
    plan.forEach((swap, idx) => {
      console.log(`  Swap ${idx + 1}: ${swap.tokenIn.slice(0, 10)}... → quotedOut=${swap.quotedOut.toString()}, slippageBps=${swap.slippageBps}`);
    });
    
    const simulations = plan.map(async (swap, idx) => {
      try {
        await publicClient!.simulateContract({
          address: config.swapper,
          abi: SWAPPER_ABI,
          functionName: 'executePlanFromCaller',
          args: [[swap], recipient],
          account: recipient,
        });
        
        return { index: idx, success: true, swap };
        
      } catch (e: any) {
        const fullError = String(e.message || e);
        const errorMsg = fullError.toLowerCase();
        
        // ALWAYS log the raw error for debugging
        console.error(`  ❌ Raw error for swap ${idx + 1} (${swap.tokenIn.slice(0,10)}...):`, fullError.substring(0, 300));
        
        let reason = 'Unknown error';
        
        // Parse specific error types - ORDER MATTERS, check specific errors first
        if (errorMsg.includes('aggregator') && errorMsg.includes('whitelist')) {
          reason = 'Aggregator not whitelisted - check contract config';
        } else if (errorMsg.includes('selector') && errorMsg.includes('whitelist')) {
          reason = 'Selector not whitelisted - check contract config';
        } else if (errorMsg.includes('outtoken') && errorMsg.includes('allowed')) {
          reason = 'Output token not allowed - check contract config';
        } else if (errorMsg.includes('#1002') || errorMsg.includes('agg swap fail')) {
          // Check aggregator failures BEFORE slippage since viem errors include "slippageBps" in function sig
          reason = 'Swap failed - token may have transfer tax or no liquidity';
        } else if (errorMsg.includes('slippage exceeded') || errorMsg.includes('too little received') || errorMsg.includes('slippage too high')) {
          // Be more specific to avoid matching "slippageBps" parameter name
          reason = 'Slippage exceeded - price moved too much';
        } else if (errorMsg.includes('insufficient') && errorMsg.includes('balance')) {
          reason = 'Insufficient balance';
        } else if (errorMsg.includes('allowance') || errorMsg.includes('approve')) {
          reason = 'Insufficient allowance';
        } else if (errorMsg.includes('transfer') && errorMsg.includes('fail')) {
          reason = 'Token transfer failed - possible tax token';
        } else if (errorMsg.includes('liquidity') || errorMsg.includes('no route')) {
          reason = 'No liquidity available';
        } else if (errorMsg.includes('expired') || errorMsg.includes('deadline')) {
          reason = 'Quote expired - try again';
        } else {
          // Extract just the revert reason if present
          const revertMatch = errorMsg.match(/reverted with the following reason:\s*([^\n]+)/i);
          if (revertMatch) {
            reason = revertMatch[1].trim();
          } else {
            reason = fullError.substring(0, 100);
          }
        }
        
        return { index: idx, success: false, swap, error: reason };
      }
    });
    
    const results = await Promise.all(simulations);
    
    const passing: SwapStep[] = [];
    const failing: Array<{ swap: SwapStep; error: string }> = [];
    
    results.forEach((result) => {
      if (result.success) {
        passing.push(result.swap);
        console.log(`  ✅ Swap ${result.index + 1}: PASS`);
      } else {
        failing.push({ swap: result.swap, error: result.error || "Unknown" });
        console.log(`  ❌ Swap ${result.index + 1}: FAIL - ${result.error}`);
      }
    });
    
    console.log(`\n📊 Simulation: ${passing.length} passing, ${failing.length} failing`);
    return { passing, failing };
  };

  // Isolate problem tokens in a failed batch by exclusion testing
  const isolateProblemTokens = async (
    failedPlan: SwapStep[],
    recipient: Address
  ): Promise<{ workingPlan: SwapStep[]; problemTokens: SwapStep[] }> => {
    console.log(`\n🔍 === PROBLEM TOKEN ISOLATION ===`);
    console.log(`Analyzing ${failedPlan.length} swaps...`);

    const problemTokens: SwapStep[] = [];
    let remainingPlan = [...failedPlan];
    let attempts = 0;
    const maxAttempts = failedPlan.length;

    while (attempts < maxAttempts && remainingPlan.length > 1) {
      attempts++;
      
      // Try to simulate the current remaining plan as a batch
      try {
        await publicClient!.estimateContractGas({
          address: config.swapper,
          abi: SWAPPER_ABI,
          functionName: 'executePlanFromCaller',
          args: [remainingPlan, recipient],
          account: recipient,
        });
        
        console.log(`✅ Found working batch with ${remainingPlan.length} tokens`);
        break;
        
      } catch {
        console.log(`❌ Batch of ${remainingPlan.length} fails, isolating...`);
        
        let foundProblem = false;
        
        // Try excluding each token one at a time
        for (let i = 0; i < remainingPlan.length; i++) {
          const testPlan = remainingPlan.filter((_, idx) => idx !== i);
          const excludedSwap = remainingPlan[i];
          
          if (testPlan.length === 0) continue;
          
          try {
            await publicClient!.estimateContractGas({
              address: config.swapper,
              abi: SWAPPER_ABI,
              functionName: 'executePlanFromCaller',
              args: [testPlan, recipient],
              account: recipient,
            });
            
            console.log(`🎯 Found problem token: ${excludedSwap.tokenIn}`);
            problemTokens.push(excludedSwap);
            remainingPlan = testPlan;
            foundProblem = true;
            break;
            
          } catch {
            continue;
          }
        }
        
        if (!foundProblem) {
          console.log(`⚠️ Multiple issues - marking all as problem tokens`);
          problemTokens.push(...remainingPlan);
          remainingPlan = [];
          break;
        }
      }
    }

    console.log(`📊 Isolation: ${remainingPlan.length} working, ${problemTokens.length} problematic`);
    return { workingPlan: remainingPlan, problemTokens };
  };

  // Execute problem tokens individually with higher slippage
  const executeProblemTokensIndividually = async (
    problemTokens: SwapStep[],
    recipient: Address
  ): Promise<{ successCount: number; successfulAddresses: string[] }> => {
    console.log(`\n🔄 === EXECUTING PROBLEM TOKENS INDIVIDUALLY ===`);
    
    let successCount = 0;
    const successfulAddresses: string[] = [];
    const BOOSTED_SLIPPAGE = 500; // 5% for problem tokens
    
    for (const swap of problemTokens) {
      console.log(`  Attempting: ${swap.tokenIn}`);
      
      const modifiedSwap = {
        ...swap,
        slippageBps: Math.max(swap.slippageBps, BOOSTED_SLIPPAGE)
      };
      
      try {
        // Estimate gas first
        let gas: bigint;
        try {
          gas = await publicClient!.estimateContractGas({
            address: config.swapper,
            abi: SWAPPER_ABI,
            functionName: 'executePlanFromCaller',
            args: [[modifiedSwap], recipient],
            account: recipient,
          });
          gas = (gas * 150n) / 100n; // 50% buffer
        } catch {
          console.log(`    ❌ Gas estimation failed - skipping`);
          continue;
        }
        
        const hash = await writeContractAsync({
          address: config.swapper,
          abi: SWAPPER_ABI,
          functionName: 'executePlanFromCaller',
          args: [[modifiedSwap], recipient],
          gas
        });
        
        const receipt = await publicClient!.waitForTransactionReceipt({ hash });
        
        // Check if transaction actually succeeded
        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted on-chain');
        }
        
        console.log(`    ✅ Individual swap succeeded!`);
        successCount++;
        successfulAddresses.push(swap.tokenIn.toLowerCase());
        
      } catch (e: any) {
        console.log(`    ❌ Failed: ${e.message?.substring(0, 80)}`);
      }
    }
    
    return { successCount, successfulAddresses };
  };

  // Phase 1: Fetch quotes and show preview modal
  const fetchQuotesAndShowPreview = useCallback(async () => {
    if (!address || !publicClient || selectedTokens.size === 0) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      // Brief delay to let 0x rate limit recover after price fetching
      setProgressStep('Preparing quotes...');
      await new Promise(r => setTimeout(r, 2500));
      
      // Get selected tokens with amounts
      const tokensToSwap = tokens
        .filter((t: TokenInfo) => selectedTokens.has(t.address))
        .map((t: TokenInfo) => {
          const customInput = customAmounts[t.address];
          let amountToSwap = t.balance;
          
          if (customInput && customInput !== '') {
            try {
              amountToSwap = parseUnits(customInput, t.decimals);
              if (amountToSwap > t.balance) amountToSwap = t.balance;
            } catch {}
          }
          
          return { ...t, amountToSwap };
        })
        .filter((t: TokenInfo & { amountToSwap: bigint }) => t.amountToSwap > 0n);
      
      if (tokensToSwap.length === 0) {
        setError('No tokens to swap');
        setIsProcessing(false);
        return;
      }

      const outputTokenAddr = outputToken === 'USDC' ? config.usdc : config.weth;
      const outputDecimals = outputToken === 'USDC' ? config.usdcDecimals : 18;
      
      // Output token price (USDC = $1, WETH needs lookup)
      let outputPrice = 1;
      if (outputToken === 'WETH') {
        setProgressStep('Fetching ETH price...');
        try {
          const res = await fetch('https://coins.llama.fi/prices/current/coingecko:ethereum');
          const data = await res.json();
          outputPrice = data.coins?.['coingecko:ethereum']?.price || 3500;
        } catch {
          outputPrice = 3500; // Fallback
        }
      }
      
      // Fetch quotes for all tokens in batches
      const successfulQuotes: QuotePreviewItem[] = [];
      const failedQuotes: FailedQuoteItem[] = [];
      
      const QUOTE_BATCH_SIZE = 5;
      const QUOTE_BATCH_DELAY = 1500; // 1.5 seconds between batches
      
      console.log(`📊 Fetching quotes for ${tokensToSwap.length} tokens (batches of ${QUOTE_BATCH_SIZE})...`);
      
      for (let batchStart = 0; batchStart < tokensToSwap.length; batchStart += QUOTE_BATCH_SIZE) {
        const batch = tokensToSwap.slice(batchStart, batchStart + QUOTE_BATCH_SIZE);
        const batchNum = Math.floor(batchStart / QUOTE_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(tokensToSwap.length / QUOTE_BATCH_SIZE);
        
        setProgressStep(`Fetching quotes (batch ${batchNum}/${totalBatches})...`);
        console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.map((t: TokenWithAmount) => t.symbol).join(', ')}`);
        
        // Fetch main quotes for this batch in parallel
        const mainQuotePromises = batch.map(async (token: TokenWithAmount) => {
          try {
            const quote = await fetch0xQuote(
              chainId,
              token.address,
              outputTokenAddr,
              token.amountToSwap,
              config.swapper
            );
            return { token, quote, error: null as string | null };
          } catch (err: any) {
            return { token, quote: null as any, error: err.message || 'Quote failed' };
          }
        });
        
        const mainResults = await Promise.all(mainQuotePromises);
        
        // Small delay before reference quotes
        await new Promise(r => setTimeout(r, 300));
        
        // Fetch reference quotes for successful main quotes in parallel
        const tokensNeedingRef = mainResults.filter((r: { token: TokenWithAmount; quote: any; error: string | null }) => r.quote?.transaction?.data);
        
        const refQuotePromises = tokensNeedingRef.map(async ({ token, quote }: { token: TokenWithAmount; quote: any }) => {
          try {
            // Use a small amount to get market rate (~$1 worth, minimal slippage)
            const tokenPriceEstimate = token.valueUsd / Number(formatUnits(token.amountToSwap, token.decimals));
            const refTokenAmount = Math.max(1, Math.ceil(1 / tokenPriceEstimate)); // ~$1 worth
            const refAmount = parseUnits(refTokenAmount.toString(), token.decimals);
            
            const refQuote = await fetch0xQuote(
              chainId,
              token.address,
              outputTokenAddr,
              refAmount,
              config.swapper
            );
            return { token, mainQuote: quote, refQuote, error: null };
          } catch (err: any) {
            // Reference quote failed, but we still have main quote
            return { token, mainQuote: quote, refQuote: null, error: err.message };
          }
        });
        
        const refResults = await Promise.all(refQuotePromises);
        
        // Process results
        for (const { token, mainQuote, refQuote, error } of refResults) {
          const buyAmountBigInt = BigInt(mainQuote.buyAmount);
          const quotedOutputUsd = Number(formatUnits(buyAmountBigInt, outputDecimals)) * outputPrice;
          
          let inputValueUsd: number;
          let priceImpact: number;
          
          if (refQuote?.buyAmount) {
            // Calculate market price from reference quote
            const tokenPriceEstimate = token.valueUsd / Number(formatUnits(token.amountToSwap, token.decimals));
            const refTokenAmount = Math.max(1, Math.ceil(1 / tokenPriceEstimate));
            const refAmount = parseUnits(refTokenAmount.toString(), token.decimals);
            
            const refBuyAmount = Number(formatUnits(BigInt(refQuote.buyAmount), outputDecimals));
            const refSellAmount = Number(formatUnits(refAmount, token.decimals));
            const marketPricePerToken = (refBuyAmount / refSellAmount) * outputPrice;
            
            // Calculate input value at market rate
            const sellAmountNum = Number(formatUnits(token.amountToSwap, token.decimals));
            inputValueUsd = sellAmountNum * marketPricePerToken;
            // Price impact should never be negative - if output > input that's favorable
            priceImpact = inputValueUsd > 0 ? Math.max(0, ((inputValueUsd - quotedOutputUsd) / inputValueUsd) * 100) : 0;
            
            console.log(`    ${token.symbol}: impact=${quotedOutputUsd >= inputValueUsd ? '~0%' : priceImpact.toFixed(2) + '%'}`);
          } else {
            // Fallback: use output as input value, but use conservative slippage since we don't know impact
            console.warn(`    ${token.symbol}: ref quote failed, using output as value (will use 2% slippage)`);
            inputValueUsd = quotedOutputUsd;
            priceImpact = 2; // Assume 2% to be safe when we can't calculate
          }
          
          const swapQuote: SwapQuote = {
            token,
            buyAmount: buyAmountBigInt,
            buyAmountFormatted: formatUnits(buyAmountBigInt, outputDecimals),
            transactionTo: mainQuote.transaction.to as Address,
            transactionData: mainQuote.transaction.data as `0x${string}`,
            priceImpact
          };
          
          successfulQuotes.push({
            token,
            inputValueUsd,
            quotedOutputUsd,
            lossPercent: priceImpact,
            lossUsd: Math.max(0, inputValueUsd - quotedOutputUsd),
            quote: swapQuote,
            selected: priceImpact < 10 // Auto-deselect if > 10% price impact
          });
        }
        
        // Add failed main quotes
        for (const { token, quote, error } of mainResults) {
          if (!quote?.transaction?.data) {
            console.warn(`    ${token.symbol}: quote failed - ${error}`);
            failedQuotes.push({ token, error: error || 'No quote available' });
          }
        }
        
        // Delay before next batch (if not last batch)
        if (batchStart + QUOTE_BATCH_SIZE < tokensToSwap.length) {
          await new Promise(r => setTimeout(r, QUOTE_BATCH_DELAY));
        }
      }
      
      console.log(`✅ Got ${successfulQuotes.length} quotes, ${failedQuotes.length} failed`);
      
      if (successfulQuotes.length === 0) {
        setError('Failed to get quotes for any tokens');
        setIsProcessing(false);
        return;
      }
      
      // Show preview modal
      setQuotePreviewData({
        quotes: successfulQuotes,
        failedQuotes,
        outputToken,
        outputPrice,
        outputDecimals
      });
      setShowQuotePreview(true);
      setIsProcessing(false);
      setProgressStep('');
      
    } catch (err: any) {
      console.error('Quote fetch error:', err);
      setError(err.message || 'Failed to fetch quotes');
      setIsProcessing(false);
    }
  }, [address, publicClient, selectedTokens, tokens, customAmounts, outputToken, config, chainId]);

  // Toggle quote selection in preview
  const toggleQuoteSelection = useCallback((tokenAddress: string) => {
    if (!quotePreviewData) return;
    
    setQuotePreviewData((prev: QuotePreviewData | null) => {
      if (!prev) return prev;
      return {
        ...prev,
        quotes: prev.quotes.map((q: QuotePreviewItem) => 
          q.token.address === tokenAddress 
            ? { ...q, selected: !q.selected }
            : q
        )
      };
    });
  }, [quotePreviewData]);

  // Toggle force high slippage for a token in preview
  const toggleForceSlippage = useCallback((tokenAddress: string) => {
    if (!quotePreviewData) return;
    
    setQuotePreviewData((prev: QuotePreviewData | null) => {
      if (!prev) return prev;
      return {
        ...prev,
        quotes: prev.quotes.map((q: QuotePreviewItem) => 
          q.token.address === tokenAddress 
            ? { ...q, forceHighSlippage: !q.forceHighSlippage }
            : q
        )
      };
    });
  }, [quotePreviewData]);

  // Phase 2: Execute confirmed swaps
  const executeConfirmedSwaps = useCallback(async () => {
    if (!address || !publicClient || !quotePreviewData) return;
    
    const selectedQuotes = quotePreviewData.quotes.filter((q: QuotePreviewItem) => q.selected);
    if (selectedQuotes.length === 0) {
      setError('No tokens selected for swap');
      return;
    }
    
    // Separate high-impact tokens that need Force but don't have it
    const executableQuotes = selectedQuotes.filter((q: QuotePreviewItem) => 
      q.lossPercent <= 5 || q.forceHighSlippage
    );
    const skippedHighImpact = selectedQuotes.filter((q: QuotePreviewItem) => 
      q.lossPercent > 5 && !q.forceHighSlippage
    );
    
    if (executableQuotes.length === 0) {
      setError('All selected tokens have >5% impact and require "Force" to be enabled');
      return;
    }
    
    setShowQuotePreview(false);
    setIsProcessing(true);
    setError(null);
    setTxHash(null);
    setSwapResults(null);
    setDetailedResults([]);
    
    let totalSuccess = 0;
    let totalFailed = 0;
    const results: SwapResultDetail[] = [];
    
    // Pre-populate skipped high-impact tokens
    for (const sq of skippedHighImpact) {
      results.push({
        symbol: sq.token.symbol,
        tokenIn: sq.token.address,
        amountIn: sq.token.amountToSwap,
        decimalsIn: sq.token.decimals,
        inputValueUsd: sq.inputValueUsd,
        quotedOutputUsd: sq.quotedOutputUsd,
        executionSlippage: 0,
        totalCostPercent: sq.lossPercent,
        status: 'skipped',
        error: `${sq.lossPercent.toFixed(1)}% impact requires "Force" to swap`
      });
    }
    
    const successfulTokens = new Set<string>();
    const failedTokens = new Map<string, string>();
    
    const { outputPrice, outputDecimals, outputToken: outToken } = quotePreviewData;
    const outputTokenAddr = outToken === 'USDC' ? config.usdc : config.weth;
    
    try {
      // Get output token balance BEFORE swaps
      const balanceBefore = await publicClient.readContract({
        address: outputTokenAddr,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address]
      }) as bigint;
      
      const tokensToSwap = executableQuotes.map((q: QuotePreviewItem) => q.token);

      // Step 1: Check and do approvals (track if any were needed)
      setProgressStep(`Checking approvals...`);
      let approvalsNeeded = 0;
      
      // USDT on mainnet requires approval reset to 0 before setting new value
      const USDT_MAINNET = '0xdac17f958d2ee523a2206206994597c13d831ec7';
      
      for (let i = 0; i < tokensToSwap.length; i++) {
        const token = tokensToSwap[i];
        
        try {
          const allowance = await publicClient.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [address, config.swapper]
          }) as bigint;
          
          if (allowance < token.amountToSwap) {
            approvalsNeeded++;
            setProgressStep(`Approving ${token.symbol} (${approvalsNeeded})...`);
            
            // USDT special case: reset to 0 first if there's existing allowance
            const isUSDT = chainId === 1 && token.address.toLowerCase() === USDT_MAINNET;
            if (isUSDT && allowance > 0n) {
              console.log(`📝 Resetting USDT approval to 0 first (required by USDT contract)`);
              const resetHash = await writeContractAsync({
                address: token.address,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [config.swapper, 0n]
              });
              const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
              if (resetReceipt.status === 'reverted') {
                throw new Error('USDT approval reset reverted');
              }
            }
            
            // Approve for 10x current balance to avoid re-approvals on future swaps
            const approvalAmount = token.balance * 10n;
            console.log(`📝 Approving ${token.symbol}: ${formatUnits(approvalAmount, token.decimals)} (10x balance)`);
            
            const hash = await writeContractAsync({
              address: token.address,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [config.swapper, approvalAmount]
            });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            if (receipt.status === 'reverted') {
              throw new Error('Approval transaction reverted');
            }
          }
        } catch (err: any) {
          console.warn(`Approval failed for ${token.symbol}:`, err);
          failedTokens.set(token.address.toLowerCase(), `Approval failed: ${err.message}`);
          totalFailed++;
        }
      }
      
      console.log(`✅ Approvals complete: ${approvalsNeeded} needed`);

      // Filter out tokens that failed approval
      let quotesToExecute = executableQuotes.filter(
        (sq: QuotePreviewItem) => !failedTokens.has(sq.token.address.toLowerCase())
      );
      
      if (quotesToExecute.length === 0) {
        throw new Error('All token approvals failed');
      }
      
      // Step 2: Re-fetch quotes ONLY if any approvals were needed (prices may have moved)
      if (approvalsNeeded > 0) {
        setProgressStep('Refreshing quotes...');
        console.log(`🔄 Re-fetching ${quotesToExecute.length} quotes (${approvalsNeeded} approvals caused delay)...`);
        
        // Re-fetch quotes in parallel batches
        const REQUOTE_BATCH_SIZE = 5;
        const freshQuotes: typeof executableQuotes = [];
        
        for (let batchStart = 0; batchStart < quotesToExecute.length; batchStart += REQUOTE_BATCH_SIZE) {
          const batch = quotesToExecute.slice(batchStart, batchStart + REQUOTE_BATCH_SIZE);
          const batchNum = Math.floor(batchStart / REQUOTE_BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(quotesToExecute.length / REQUOTE_BATCH_SIZE);
          
          setProgressStep(`Refreshing quotes (${batchNum}/${totalBatches})...`);
          
          // Fetch all quotes in this batch in parallel
          const quotePromises = batch.map(async (sq: QuotePreviewItem) => {
            try {
              const freshQuote = await fetch0xQuote(
                chainId,
                sq.token.address,
                outputTokenAddr,
                sq.token.amountToSwap,
                config.swapper
              );
              
              if (!freshQuote?.transaction?.to || !freshQuote?.transaction?.data) {
                throw new Error('Invalid quote response');
              }
              
              return { sq, freshQuote, error: null };
            } catch (err: any) {
              return { sq, freshQuote: null, error: err.message || 'Re-quote failed' };
            }
          });
          
          const results = await Promise.all(quotePromises);
          
          // Process results
          for (const { sq, freshQuote, error } of results) {
            if (freshQuote) {
              const newBuyAmount = BigInt(freshQuote.buyAmount);
              const newQuotedOutputUsd = Number(formatUnits(newBuyAmount, outputDecimals)) * outputPrice;
              
              const priceChange = sq.quotedOutputUsd > 0 
                ? ((newQuotedOutputUsd - sq.quotedOutputUsd) / sq.quotedOutputUsd) * 100 
                : 0;
              
              console.log(`  ${sq.token.symbol}: $${sq.quotedOutputUsd.toFixed(2)} → $${newQuotedOutputUsd.toFixed(2)} (${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%)`);
              
              const newLossPercent = sq.inputValueUsd > 0 
                ? Math.max(0, ((sq.inputValueUsd - newQuotedOutputUsd) / sq.inputValueUsd) * 100) 
                : 0;
              
              freshQuotes.push({
                ...sq,
                quotedOutputUsd: newQuotedOutputUsd,
                lossPercent: newLossPercent,
                lossUsd: Math.max(0, sq.inputValueUsd - newQuotedOutputUsd),
                quote: {
                  token: sq.token,
                  buyAmount: newBuyAmount,
                  buyAmountFormatted: formatUnits(newBuyAmount, outputDecimals),
                  transactionTo: freshQuote.transaction.to as Address,
                  transactionData: freshQuote.transaction.data as `0x${string}`,
                  priceImpact: newLossPercent
                }
              });
            } else {
              console.warn(`  ${sq.token.symbol}: re-quote failed - ${error}`);
              failedTokens.set(sq.token.address.toLowerCase(), `Re-quote failed: ${error}`);
              totalFailed++;
            }
          }
          
          // Small delay between batches
          if (batchStart + REQUOTE_BATCH_SIZE < quotesToExecute.length) {
            await new Promise(r => setTimeout(r, 300));
          }
        }
        
        if (freshQuotes.length === 0) {
          throw new Error('All re-quotes failed');
        }
        
        console.log(`✅ Got ${freshQuotes.length} fresh quotes`);
        quotesToExecute = freshQuotes;
      } else {
        console.log('✅ No approvals needed - using original quotes');
      }

      // Step 3: Execute in batches with per-batch simulation
      const EXECUTION_BATCH_SIZE = 5;
      const totalBatches = Math.ceil(quotesToExecute.length / EXECUTION_BATCH_SIZE);
      
      console.log(`🚀 Executing ${quotesToExecute.length} swaps in ${totalBatches} batch(es) of up to ${EXECUTION_BATCH_SIZE}...`);
      
      for (let batchStart = 0; batchStart < quotesToExecute.length; batchStart += EXECUTION_BATCH_SIZE) {
        const batchQuotes = quotesToExecute.slice(batchStart, batchStart + EXECUTION_BATCH_SIZE);
        const batchNum = Math.floor(batchStart / EXECUTION_BATCH_SIZE) + 1;
        
        console.log(`\n📦 Batch ${batchNum}/${totalBatches}: ${batchQuotes.map((sq: QuotePreviewItem) => sq.token.symbol).join(', ')}`);
        
        // Build swap plan for this batch
        setProgressStep(`Batch ${batchNum}/${totalBatches}: Building plan...`);
        const batchPlan: SwapStep[] = batchQuotes.map((sq: QuotePreviewItem) => {
          const q = sq.quote;
          const encodedData = encodeAbiParameters(
            [{ type: 'address' }, { type: 'bytes' }],
            [q.transactionTo, q.transactionData]
          );
          
          const priceImpactBps = Math.ceil((q.priceImpact || 0) * 100);
          // Base slippage of 30 bps (0.3%), scales up with price impact
          const dynamicSlippage = sq.forceHighSlippage
            ? Math.min(9900, Math.max(500, priceImpactBps + 1000))
            : Math.min(500, Math.max(30, 30 + Math.ceil(priceImpactBps * 1.5)));
          
          // Log swap parameters for debugging - including the ROUTER ADDRESS
          console.log(`  ${sq.token.symbol}: router=${q.transactionTo}, slippageBps=${dynamicSlippage}`);
          
          return {
            kind: RouterKind.AGGREGATOR,
            tokenIn: sq.token.address,
            outToken: outputTokenAddr,
            useAll: sq.token.amountToSwap >= sq.token.balance,
            amountIn: sq.token.amountToSwap,
            quotedIn: sq.token.amountToSwap,
            quotedOut: q.buyAmount,
            slippageBps: dynamicSlippage,
            data: encodedData as `0x${string}`,
            viaPermit2: false,
            permitSig: '0x' as `0x${string}`,
            permitAmount: 0n,
            permitDeadline: 0n,
            permitNonce: 0n
          };
        });
        
        // Simulate this batch
        setProgressStep(`Batch ${batchNum}/${totalBatches}: Simulating...`);
        const { passing, failing } = await simulateSwaps(batchPlan, address);
        
        // Mark simulation failures
        for (const { swap, error } of failing) {
          failedTokens.set(swap.tokenIn.toLowerCase(), error);
          totalFailed++;
        }
        
        if (passing.length === 0) {
          console.log(`  ⚠️ Batch ${batchNum}: All swaps failed simulation`);
          continue;
        }
        
        // Validate batch with gas estimation
        setProgressStep(`Batch ${batchNum}/${totalBatches}: Validating...`);
        let planToExecute = passing;
        let problemTokensToRetry: SwapStep[] = [];
        
        try {
          await publicClient.estimateContractGas({
            address: config.swapper,
            abi: SWAPPER_ABI,
            functionName: 'executePlanFromCaller',
            args: [passing, address],
            account: address,
          });
          console.log(`  ✅ Batch ${batchNum} validated`);
          
        } catch (batchValidationError: any) {
          console.log(`  ❌ Batch ${batchNum} validation failed, isolating problem tokens...`);
          
          const { workingPlan, problemTokens } = await isolateProblemTokens(passing, address);
          planToExecute = workingPlan;
          problemTokensToRetry = problemTokens;
          
          if (workingPlan.length === 0) {
            console.log(`  ⚠️ No working batch found, will try all tokens individually`);
            
            // Execute all tokens individually with higher slippage
            const { successCount, successfulAddresses } = await executeProblemTokensIndividually(passing, address);
            
            for (const addr of successfulAddresses) {
              successfulTokens.add(addr);
            }
            totalSuccess += successCount;
            
            // Mark failed tokens
            for (const swap of passing) {
              const addr = swap.tokenIn.toLowerCase();
              if (!successfulAddresses.includes(addr)) {
                failedTokens.set(addr, 'Individual execution failed');
                totalFailed++;
              }
            }
            
            continue; // Skip to next batch
          }
        }
        
        // Execute the working batch
        if (planToExecute.length > 0) {
          setProgressStep(`Batch ${batchNum}/${totalBatches}: Executing ${planToExecute.length} swaps...`);
          
          try {
            const gas = await publicClient.estimateContractGas({
              address: config.swapper,
              abi: SWAPPER_ABI,
              functionName: 'executePlanFromCaller',
              args: [planToExecute, address],
              account: address,
            });
            
            const hash = await writeContractAsync({
              address: config.swapper,
              abi: SWAPPER_ABI,
              functionName: 'executePlanFromCaller',
              args: [planToExecute, address],
              gas: (gas * 130n) / 100n
            });
            
            setTxHash(hash);
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            
            if (receipt.status === 'reverted') {
              throw new Error('Transaction reverted on-chain');
            }
            
            console.log(`  ✅ Batch ${batchNum} executed: ${planToExecute.length} swaps`);
            for (const swap of planToExecute) {
              successfulTokens.add(swap.tokenIn.toLowerCase());
              totalSuccess++;
            }
            
          } catch (execError: any) {
            const errorMsg = execError.message || String(execError);
            console.error(`  ❌ Batch ${batchNum} execution failed:`, errorMsg.slice(0, 100));
            
            if (errorMsg.includes('reverted on-chain') || errorMsg.includes('Transaction reverted')) {
              // On-chain revert - mark all as failed
              for (const swap of planToExecute) {
                failedTokens.set(swap.tokenIn.toLowerCase(), 'Transaction reverted: likely slippage exceeded');
                totalFailed++;
              }
            } else {
              // Try individual execution as fallback
              const { successCount, successfulAddresses } = await executeProblemTokensIndividually(planToExecute, address);
              
              for (const addr of successfulAddresses) {
                successfulTokens.add(addr);
              }
              totalSuccess += successCount;
              
              for (const swap of planToExecute) {
                const addr = swap.tokenIn.toLowerCase();
                if (!successfulAddresses.includes(addr)) {
                  failedTokens.set(addr, 'Individual execution failed');
                  totalFailed++;
                }
              }
            }
          }
        }
        
        // Execute problem tokens individually
        if (problemTokensToRetry.length > 0) {
          console.log(`  🔄 Trying ${problemTokensToRetry.length} problem tokens individually...`);
          const { successCount, successfulAddresses } = await executeProblemTokensIndividually(problemTokensToRetry, address);
          
          for (const addr of successfulAddresses) {
            successfulTokens.add(addr);
          }
          totalSuccess += successCount;
          
          for (const swap of problemTokensToRetry) {
            const addr = swap.tokenIn.toLowerCase();
            if (!successfulAddresses.includes(addr)) {
              failedTokens.set(addr, 'Individual execution failed');
              totalFailed++;
            }
          }
        }
        
        // Small delay between batches
        if (batchStart + EXECUTION_BATCH_SIZE < quotesToExecute.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Build and show detailed results
      setProgressStep('Finalizing...');
      
      const balanceAfter = await publicClient.readContract({
        address: outputTokenAddr,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address]
      }) as bigint;
      
      const totalReceived = balanceAfter - balanceBefore;
      const totalReceivedUsd = Number(formatUnits(totalReceived, outputDecimals)) * outputPrice;
      
      console.log('📊 Balance tracking:', {
        balanceBefore: formatUnits(balanceBefore, outputDecimals),
        balanceAfter: formatUnits(balanceAfter, outputDecimals),
        totalReceived: formatUnits(totalReceived, outputDecimals),
        totalReceivedUsd: totalReceivedUsd.toFixed(6)
      });
      
      // Build detailed results for executed tokens
      for (const sq of quotesToExecute) {
        const addr = sq.token.address.toLowerCase();
        
        if (successfulTokens.has(addr)) {
          results.push({
            symbol: sq.token.symbol,
            tokenIn: sq.token.address,
            amountIn: sq.token.amountToSwap,
            decimalsIn: sq.token.decimals,
            inputValueUsd: sq.inputValueUsd,
            quotedOutputUsd: sq.quotedOutputUsd,
            actualOutputUsd: undefined,
            executionSlippage: 0,
            totalCostPercent: sq.lossPercent,
            status: 'success'
          });
        } else {
          results.push({
            symbol: sq.token.symbol,
            tokenIn: sq.token.address,
            amountIn: sq.token.amountToSwap,
            decimalsIn: sq.token.decimals,
            inputValueUsd: sq.inputValueUsd,
            quotedOutputUsd: sq.quotedOutputUsd,
            executionSlippage: 0,
            totalCostPercent: 0,
            status: 'failed',
            error: failedTokens.get(addr) || 'Unknown error'
          });
        }
      }
      
      // Add tokens that failed approval or re-quoting (in executableQuotes but not in quotesToExecute)
      for (const sq of executableQuotes) {
        const addr = sq.token.address.toLowerCase();
        // Add if it failed and we haven't already added it
        if (failedTokens.has(addr) && !results.some(r => r.tokenIn.toLowerCase() === addr)) {
          results.push({
            symbol: sq.token.symbol,
            tokenIn: sq.token.address,
            amountIn: sq.token.amountToSwap,
            decimalsIn: sq.token.decimals,
            inputValueUsd: sq.inputValueUsd,
            quotedOutputUsd: sq.quotedOutputUsd,
            executionSlippage: 0,
            totalCostPercent: 0,
            status: 'failed',
            error: failedTokens.get(addr) || 'Unknown error'
          });
        }
      }
      
      // Add failed quotes
      for (const fq of quotePreviewData.failedQuotes) {
        results.push({
          symbol: fq.token.symbol,
          tokenIn: fq.token.address,
          amountIn: fq.token.amountToSwap,
          decimalsIn: fq.token.decimals,
          inputValueUsd: fq.token.valueUsd,
          quotedOutputUsd: 0,
          executionSlippage: 0,
          totalCostPercent: 0,
          status: 'skipped',
          error: fq.error
        });
      }
      
      setDetailedResults(results);
      setSwapResults({
        success: totalSuccess,
        failed: totalFailed,
        totalValue: totalReceivedUsd
      });
      setShowResultsModal(true);
      
      // Force refresh to get new balances after swap
      await scanWalletTokens(true);
      
    } catch (err: any) {
      console.error('Swap execution error:', err);
      setError(err.message || 'Swap failed');
    } finally {
      setIsProcessing(false);
      setProgressStep('');
      setQuotePreviewData(null);
    }
  }, [address, publicClient, quotePreviewData, config, writeContractAsync, scanWalletTokens, simulateSwaps, isolateProblemTokens, executeProblemTokensIndividually]);


  // Fetch 0x quote
  async function fetch0xQuote(
    chainId: number,
    sellToken: string,
    buyToken: string,
    sellAmount: bigint,
    taker: string
  ): Promise<any> {
    const params = new URLSearchParams({
      chainId: String(chainId),
      sellToken,
      buyToken,
      sellAmount: sellAmount.toString(),
      taker
    });
    
    const res = await fetch(`/api/0x/quote?${params}`);
    if (!res.ok) {
      const err = await res.json();
      const errorMsg = err.error || err.reason || err.message || 'Quote failed';
      console.error(`0x quote error for ${sellToken}:`, err);
      throw new Error(errorMsg);
    }
    
    return res.json();
  }

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  // Filter out the currently selected output token from display
  const displayTokens = useMemo(() => {
    const outputTokenAddr = outputToken === 'USDC' ? config.usdc : config.weth;
    return tokens.filter((t: TokenInfo) => t.address.toLowerCase() !== outputTokenAddr.toLowerCase());
  }, [tokens, outputToken, config]);

  const totalSelectedValue = useMemo(() => {
    const outputTokenAddr = outputToken === 'USDC' ? config.usdc : config.weth;
    return tokens
      .filter((t: TokenInfo) => selectedTokens.has(t.address) && t.address.toLowerCase() !== outputTokenAddr.toLowerCase())
      .reduce((sum: number, t: TokenInfo) => {
        const customInput = customAmounts[t.address];
        if (customInput) {
          try {
            const amount = parseFloat(customInput);
            return sum + (amount * t.price);
          } catch {}
        }
        return sum + t.valueUsd;
      }, 0);
  }, [tokens, selectedTokens, customAmounts, outputToken, config]);

  // Count only non-output tokens that are selected
  const selectedCount = useMemo(() => {
    const outputTokenAddr = outputToken === 'USDC' ? config.usdc : config.weth;
    return [...selectedTokens].filter(addr => addr.toLowerCase() !== outputTokenAddr.toLowerCase()).length;
  }, [selectedTokens, outputToken, config]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950">
      
      {/* Quote Preview Modal */}
      {showQuotePreview && quotePreviewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl"
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-700 bg-gradient-to-r from-amber-500/10 to-orange-500/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                    <AlertTriangle className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Review Swap Quotes</h3>
                    <p className="text-sm text-slate-400">
                      {quotePreviewData.quotes.length} quotes received, {quotePreviewData.failedQuotes.length} failed
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowQuotePreview(false);
                    setQuotePreviewData(null);
                  }}
                  className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Input Value</p>
                  <p className="text-lg font-bold text-white">
                    {formatUSD(quotePreviewData.quotes
                      .filter((q: QuotePreviewItem) => q.selected)
                      .reduce((sum: number, q: QuotePreviewItem) => sum + q.inputValueUsd, 0))}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">You'll Receive</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {formatUSD(quotePreviewData.quotes
                      .filter((q: QuotePreviewItem) => q.selected)
                      .reduce((sum: number, q: QuotePreviewItem) => sum + q.quotedOutputUsd, 0))}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Price Impact</p>
                  {(() => {
                    const selectedQuotes = quotePreviewData.quotes.filter((q: QuotePreviewItem) => q.selected);
                    // Weighted average price impact
                    const totalInput = selectedQuotes.reduce((sum: number, q: QuotePreviewItem) => sum + q.inputValueUsd, 0);
                    const weightedImpact = totalInput > 0 
                      ? selectedQuotes.reduce((sum: number, q: QuotePreviewItem) => sum + (q.lossPercent * q.inputValueUsd), 0) / totalInput
                      : 0;
                    return (
                      <p className={`text-lg font-bold ${weightedImpact > 2 ? 'text-red-400' : weightedImpact > 0.5 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                        {weightedImpact > 0.01 ? `-${weightedImpact.toFixed(2)}%` : '~0%'}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>
            
            {/* Token List */}
            <div className="overflow-y-auto max-h-[400px] p-4">
              <table className="w-full">
                <thead className="text-xs text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="text-left pb-3 pl-2">Include</th>
                    <th className="text-left pb-3">Token</th>
                    <th className="text-right pb-3">Input Value</th>
                    <th className="text-right pb-3">You Receive</th>
                    <th className="text-right pb-3 pr-2">Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {quotePreviewData.quotes.map((quoteData: QuotePreviewItem, idx: number) => (
                    <tr 
                      key={idx} 
                      className={`hover:bg-slate-700/30 transition-colors ${!quoteData.selected ? 'opacity-50' : ''}`}
                    >
                      <td className="py-3 pl-2">
                        <input
                          type="checkbox"
                          checked={quoteData.selected}
                          onChange={() => toggleQuoteSelection(quoteData.token.address)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {quoteData.lossPercent > 5 ? (
                            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          ) : quoteData.lossPercent > 1 ? (
                            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          )}
                          <span className="font-medium text-white">{quoteData.token.symbol}</span>
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-slate-300">{formatUSD(quoteData.inputValueUsd)}</span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-emerald-400 font-medium">{formatUSD(quoteData.quotedOutputUsd)}</span>
                      </td>
                      <td className="py-3 text-right pr-2">
                        <div className="flex items-center justify-end gap-2">
                          <span className={`font-medium ${
                            quoteData.lossPercent > 5 ? 'text-red-400' : 
                            quoteData.lossPercent > 1 ? 'text-yellow-400' : 
                            'text-emerald-400'
                          }`}>
                            {quoteData.lossPercent > 0.01 ? `-${quoteData.lossPercent.toFixed(2)}%` : '~0%'}
                          </span>
                          {/* Show Force toggle for high-impact tokens (>5%) */}
                          {quoteData.lossPercent > 5 && quoteData.selected && (
                            <button
                              onClick={() => toggleForceSlippage(quoteData.token.address)}
                              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                quoteData.forceHighSlippage
                                  ? 'bg-orange-500/30 text-orange-300 border border-orange-500/50'
                                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-300'
                              }`}
                              title={quoteData.forceHighSlippage 
                                ? `Slippage unlocked to ~${Math.ceil(quoteData.lossPercent + 10)}%` 
                                : 'Click to allow higher slippage for this swap'}
                            >
                              {quoteData.forceHighSlippage ? '⚠️ Forced' : 'Force'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  
                  {/* Failed quotes */}
                  {quotePreviewData.failedQuotes.map((fq: FailedQuoteItem, idx: number) => (
                    <tr key={`failed-${idx}`} className="opacity-50">
                      <td className="py-3 pl-2">
                        <input type="checkbox" disabled className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          <span className="font-medium text-white">{fq.token.symbol}</span>
                        </div>
                        <p className="text-xs text-red-400 mt-1 truncate max-w-[150px]" title={fq.error}>
                          {fq.error}
                        </p>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-slate-500">{formatUSD(fq.token.valueUsd)}</span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-slate-500">—</span>
                      </td>
                      <td className="py-3 text-right pr-2">
                        <span className="text-slate-500">—</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {quotePreviewData.quotes.length === 0 && quotePreviewData.failedQuotes.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  No quotes to display
                </div>
              )}
            </div>
            
            {/* Warning for high price impact */}
            {quotePreviewData.quotes.some((q: QuotePreviewItem) => q.selected && q.lossPercent > 5) && (
              <div className="mx-4 mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {quotePreviewData.quotes.some((q: QuotePreviewItem) => q.selected && q.lossPercent > 5 && !q.forceHighSlippage) 
                      ? <>High-impact tokens ({quotePreviewData.quotes.filter((q: QuotePreviewItem) => q.selected && q.lossPercent > 5 && !q.forceHighSlippage).length}) require "Force" to swap. Click the Force button or they will be skipped.</>
                      : <>Some tokens have &gt;5% price impact.</>
                    }
                  </span>
                </div>
                {quotePreviewData.quotes.some((q: QuotePreviewItem) => q.selected && q.forceHighSlippage) && (
                  <div className="mt-2 text-xs text-orange-400">
                    ⚠️ Force enabled for {quotePreviewData.quotes.filter((q: QuotePreviewItem) => q.selected && q.forceHighSlippage).length} token(s) — 
                    these will execute with higher slippage tolerance (~{Math.max(...quotePreviewData.quotes.filter((q: QuotePreviewItem) => q.selected && q.forceHighSlippage).map((q: QuotePreviewItem) => Math.ceil(q.lossPercent + 10)))}%).
                  </div>
                )}
              </div>
            )}
            
            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-700 bg-slate-900/50 flex gap-3">
              <button
                onClick={() => {
                  setShowQuotePreview(false);
                  setQuotePreviewData(null);
                }}
                className="flex-1 py-3 px-4 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={executeConfirmedSwaps}
                disabled={!quotePreviewData.quotes.some((q: QuotePreviewItem) => q.selected && (q.lossPercent <= 5 || q.forceHighSlippage))}
                className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200"
              >
                {(() => {
                  const executable = quotePreviewData.quotes.filter((q: QuotePreviewItem) => q.selected && (q.lossPercent <= 5 || q.forceHighSlippage)).length;
                  const skipped = quotePreviewData.quotes.filter((q: QuotePreviewItem) => q.selected && q.lossPercent > 5 && !q.forceHighSlippage).length;
                  return skipped > 0 
                    ? `Confirm Sweep (${executable} tokens, ${skipped} skipped)`
                    : `Confirm Sweep (${executable} tokens)`;
                })()}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      
      {/* Results Modal */}
      {showResultsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl"
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-700 bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                    <CheckCircle className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Sweep Complete</h3>
                    <p className="text-sm text-slate-400">
                      {swapResults?.success || 0} successful, {swapResults?.failed || 0} failed
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowResultsModal(false)}
                  className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Total Input Value</p>
                  <p className="text-lg font-bold text-white">
                    {formatUSD(detailedResults
                      .filter((r: SwapResultDetail) => r.status === 'success')
                      .reduce((sum: number, r: SwapResultDetail) => sum + r.inputValueUsd, 0))}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Actual Received</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {formatUSD(swapResults?.totalValue || 0)}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Price Impact</p>
                  {(() => {
                    const successfulResults = detailedResults.filter((r: SwapResultDetail) => r.status === 'success');
                    const totalInput = successfulResults.reduce((sum: number, r: SwapResultDetail) => sum + r.inputValueUsd, 0);
                    const totalReceived = swapResults?.totalValue || 0;
                    // Positive = gain (received more than input), Negative = loss
                    const impactPercent = totalInput > 0 ? ((totalReceived - totalInput) / totalInput) * 100 : 0;
                    
                    // Debug logging
                    console.log('📊 Price impact calculation:', {
                      totalInput: totalInput.toFixed(2),
                      totalReceived: totalReceived.toFixed(2),
                      difference: (totalReceived - totalInput).toFixed(2),
                      impactPercent: impactPercent.toFixed(4)
                    });
                    
                    return (
                      <p className={`text-lg font-bold ${
                        impactPercent < -5 ? 'text-red-400' : 
                        impactPercent < -2 ? 'text-yellow-400' : 
                        'text-emerald-400'
                      }`}>
                        {Math.abs(impactPercent) < 0.01 
                          ? '~0%' 
                          : impactPercent >= 0 
                            ? `+${impactPercent.toFixed(2)}%` 
                            : `${impactPercent.toFixed(2)}%`}
                      </p>
                    );
                  })()}
                </div>
              </div>
              
              {/* Transaction Link */}
              {txHash && (
                <a
                  href={`${config.explorerUrl}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View transaction on explorer
                </a>
              )}
            </div>
            
            {/* Token Results List */}
            <div className="overflow-y-auto max-h-[400px] p-4">
              <table className="w-full">
                <thead className="text-xs text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="text-left pb-3 pl-2">Token</th>
                    <th className="text-right pb-3">Input Value</th>
                    <th className="text-right pb-3">Quoted Output</th>
                    <th className="text-right pb-3 pr-2">Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {detailedResults.map((result: SwapResultDetail, idx: number) => {
                    // Calculate impact: positive = gain, negative = loss
                    const impactPercent = result.inputValueUsd > 0 
                      ? ((result.quotedOutputUsd - result.inputValueUsd) / result.inputValueUsd) * 100
                      : 0;
                    
                    return (
                      <tr 
                        key={idx} 
                        className={`${result.status === 'failed' ? 'opacity-50' : ''} hover:bg-slate-700/30 transition-colors`}
                      >
                        <td className="py-3 pl-2">
                          <div className="flex items-center gap-2">
                            {result.status === 'success' ? (
                              <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                            ) : result.status === 'failed' ? (
                              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                            )}
                            <span className="font-medium text-white">{result.symbol}</span>
                          </div>
                          {result.error && (
                            <p className="text-xs text-red-400 mt-1 ml-6 truncate max-w-[150px]" title={result.error}>
                              {result.error}
                            </p>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <span className="text-slate-400">{formatUSD(result.inputValueUsd)}</span>
                        </td>
                        <td className="py-3 text-right">
                          {result.status === 'success' ? (
                            <span className="text-emerald-400">{formatUSD(result.quotedOutputUsd)}</span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right pr-2">
                          {result.status === 'success' ? (
                            <span className={`font-medium ${
                              impactPercent < -5 ? 'text-red-400' : 
                              impactPercent < -2 ? 'text-yellow-400' : 
                              'text-emerald-400'
                            }`}>
                              {Math.abs(impactPercent) < 0.01 
                                ? '~0%' 
                                : impactPercent >= 0 
                                  ? `+${impactPercent.toFixed(2)}%` 
                                  : `${impactPercent.toFixed(2)}%`}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              
              {detailedResults.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  No swap results to display
                </div>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-700 bg-slate-900/50">
              <button
                onClick={() => setShowResultsModal(false)}
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold rounded-xl transition-all duration-200"
              >
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-5 animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-slate-800/50 backdrop-blur-xl bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Token Sweeper</h1>
                <p className="text-xs text-slate-400">Batch swap to USDC or WETH</p>
              </div>
            </div>
            
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8">
        
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Sweep Your Tokens
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Convert multiple tokens to USDC or WETH in a single transaction. 
            Select tokens, customize amounts, and execute.
          </p>
        </motion.div>

        {/* Chain Warning */}
        {isConnected && !supportedChain && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              <div>
                <p className="text-yellow-200 font-medium">Unsupported Network</p>
                <p className="text-sm text-yellow-200/70">
                  Please switch to Base or Ethereum mainnet
                </p>
              </div>
              <button
                onClick={() => switchChain?.({ chainId: 8453 })}
                className="ml-auto px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 rounded-lg text-sm font-medium transition"
              >
                Switch to Base
              </button>
            </div>
          </motion.div>
        )}

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl overflow-hidden"
        >
          {/* Not Connected State */}
          {!isConnected && (
            <div className="p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-700/50 flex items-center justify-center">
                <Wallet className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Connect Your Wallet</h3>
              <p className="text-slate-400 mb-6">Connect your wallet to scan for tokens to sweep</p>
              <ConnectButton />
            </div>
          )}

          {/* Connected State */}
          {isConnected && supportedChain && (
            <>
              {/* Controls Bar */}
              <div className="p-4 border-b border-slate-700/50 bg-slate-900/30">
                <div className="flex flex-wrap items-center gap-4">
                  {/* Scan Button */}
                  <button
                    onClick={() => scanWalletTokens(false)}
                    disabled={isScanning || isProcessing}
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium transition"
                  >
                    {isScanning ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : tokens.length > 0 ? (
                      <RefreshCw className="w-4 h-4" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                    {isScanning ? 'Scanning...' : tokens.length > 0 ? 'Refresh' : 'Scan Wallet'}
                  </button>

                  {/* Force Refresh Button - always visible, clears token/price caches */}
                  <button
                    onClick={() => scanWalletTokens(true)}
                    disabled={isScanning || isProcessing}
                    className="flex items-center gap-2 px-3 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition"
                    title="Force re-scan blockchain (clears cache)"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Re-scan
                  </button>

                  {/* Clear Runtime Spam Cache Button */}
                  {tokens.length > 0 && (
                    <button
                      onClick={() => {
                        // Only clear runtime-detected spam (tokens that failed 0x quotes)
                        // Do NOT clear the external GitHub spam list - that's authoritative
                        clearFailedTokensCache(chainId);
                        console.log('🗑️ Cleared runtime spam cache (GitHub list preserved)');
                        // Trigger a re-scan
                        scanWalletTokens(true);
                      }}
                      disabled={isScanning || isProcessing}
                      className="flex items-center gap-2 px-3 py-2.5 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition"
                      title="Clear locally-detected spam and re-scan (GitHub spam list preserved)"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reset Spam
                    </button>
                  )}

                  {/* Output Token Selector */}
                  <div className="flex items-center gap-2 bg-slate-900/50 rounded-xl p-1">
                    <button
                      onClick={() => setOutputToken('USDC')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                        outputToken === 'USDC'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      → USDC
                    </button>
                    <button
                      onClick={() => setOutputToken('WETH')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                        outputToken === 'WETH'
                          ? 'bg-purple-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      → WETH
                    </button>
                  </div>

                  {/* Chain Badge */}
                  <div className="ml-auto flex items-center gap-3">
                    {/* Cache Stats (only show when tokens loaded) */}
                    {tokens.length > 0 && (
                      <div className="text-xs text-slate-500" title="External (GitHub) + Runtime (local) spam tokens filtered">
                        🚫 {(() => {
                          const stats = getCacheStats(chainId, address);
                          return `${stats.externalSpam}+${stats.runtimeSpam} spam`;
                        })()}
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/50 rounded-lg">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-sm text-slate-300">{config.name}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Manual Token Input */}
              <div className="px-4 py-3 border-b border-slate-700/50 bg-slate-900/20">
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Add token by address (0x...)"
                      value={manualTokenInput}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setManualTokenInput(e.target.value)}
                      onKeyDown={async (e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter' && manualTokenInput.match(/^0x[a-fA-F0-9]{40}$/) && publicClient && address) {
                          const addr = manualTokenInput.toLowerCase() as Address;
                          
                          // Save to manual tokens list
                          const newManual = new Set(manualTokens);
                          newManual.add(addr);
                          setManualTokens(newManual);
                          saveManualTokens(newManual);
                          setManualTokenInput('');
                          console.log(`📌 Added manual token: ${addr}`);
                          
                          // Fetch this token's info directly (no full rescan needed)
                          setIsAddingToken(true);
                          try {
                            const infos = await fetchTokenInfos([addr], address, publicClient);
                            if (infos.length > 0 && infos[0].balance > 0n) {
                              const newToken = infos[0];
                              // Calculate formatted balance
                              const balanceNum = Number(formatUnits(newToken.balance, newToken.decimals));
                              newToken.balanceFormatted = formatNumber(balanceNum, 4);
                              // Fetch price for this token (use USDC as output)
                              const prices = await fetchMarketPrices([newToken], chainId, config.usdc as Address);
                              newToken.price = prices[addr.toLowerCase()] || 0;
                              newToken.valueUsd = balanceNum * newToken.price;
                              
                              // Add to tokens list (avoid duplicates)
                              setTokens((prev: TokenInfo[]) => {
                                const exists = prev.some((t: TokenInfo) => t.address.toLowerCase() === addr);
                                if (exists) return prev;
                                return [...prev, newToken].sort((a, b) => b.valueUsd - a.valueUsd);
                              });
                              console.log(`✅ Added ${newToken.symbol}: ${newToken.balanceFormatted} ($${newToken.valueUsd.toFixed(2)})`);
                            } else {
                              console.warn(`⚠️ Token ${addr.slice(0, 10)}... has no balance`);
                            }
                          } catch (err) {
                            console.error('Failed to fetch token:', err);
                          }
                          setIsAddingToken(false);
                        }
                      }}
                      className="flex-1 bg-slate-800/50 text-sm text-white outline-none placeholder:text-slate-500 px-3 py-2 rounded-lg border border-slate-600/50 focus:border-emerald-500/50"
                    />
                    <button
                      onClick={async () => {
                        if (manualTokenInput.match(/^0x[a-fA-F0-9]{40}$/) && publicClient && address) {
                          const addr = manualTokenInput.toLowerCase() as Address;
                          
                          // Save to manual tokens list
                          const newManual = new Set(manualTokens);
                          newManual.add(addr);
                          setManualTokens(newManual);
                          saveManualTokens(newManual);
                          setManualTokenInput('');
                          console.log(`📌 Added manual token: ${addr}`);
                          
                          // Fetch this token's info directly
                          setIsAddingToken(true);
                          try {
                            const infos = await fetchTokenInfos([addr], address, publicClient);
                            if (infos.length > 0 && infos[0].balance > 0n) {
                              const newToken = infos[0];
                              // Calculate formatted balance
                              const balanceNum = Number(formatUnits(newToken.balance, newToken.decimals));
                              newToken.balanceFormatted = formatNumber(balanceNum, 4);
                              // Fetch price (use USDC as output)
                              const prices = await fetchMarketPrices([newToken], chainId, config.usdc as Address);
                              newToken.price = prices[addr.toLowerCase()] || 0;
                              newToken.valueUsd = balanceNum * newToken.price;
                              
                              setTokens((prev: TokenInfo[]) => {
                                const exists = prev.some((t: TokenInfo) => t.address.toLowerCase() === addr);
                                if (exists) return prev;
                                return [...prev, newToken].sort((a, b) => b.valueUsd - a.valueUsd);
                              });
                              console.log(`✅ Added ${newToken.symbol}: ${newToken.balanceFormatted} ($${newToken.valueUsd.toFixed(2)})`);
                            } else {
                              console.warn(`⚠️ Token ${addr.slice(0, 10)}... has no balance`);
                            }
                          } catch (err) {
                            console.error('Failed to fetch token:', err);
                          }
                          setIsAddingToken(false);
                        }
                      }}
                      disabled={!manualTokenInput.match(/^0x[a-fA-F0-9]{40}$/) || isScanning || isAddingToken}
                      className="px-3 py-2 bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg font-medium transition"
                    >
                      {isAddingToken ? '...' : '+ Add'}
                    </button>
                  </div>
                  
                  {/* Show manual tokens count */}
                  {manualTokens.size > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        📌 {manualTokens.size} manual
                      </span>
                      <button
                        onClick={() => {
                          setManualTokens(new Set());
                          saveManualTokens(new Set());
                          console.log('🗑️ Cleared all manual tokens');
                        }}
                        className="text-xs text-red-400 hover:text-red-300"
                        title="Clear all manual tokens"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Manual tokens list (expandable) */}
                {manualTokens.size > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[...manualTokens].map((addr: string) => (
                      <div 
                        key={addr}
                        className="flex items-center gap-1.5 px-2 py-1 bg-emerald-600/20 text-emerald-300 text-xs rounded-lg border border-emerald-500/30"
                      >
                        <span className="font-mono">{addr.slice(0, 6)}...{addr.slice(-4)}</span>
                        <button
                          onClick={() => {
                            const newManual = new Set(manualTokens);
                            newManual.delete(addr);
                            setManualTokens(newManual);
                            saveManualTokens(newManual);
                            console.log(`🗑️ Removed manual token: ${addr}`);
                          }}
                          className="text-emerald-400 hover:text-red-400 ml-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Token List */}
              <div className="p-4">
                {tokens.length === 0 && !isScanning && (
                  <div className="py-12 text-center">
                    <Coins className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                    <p className="text-slate-400">Click "Scan Wallet" to find tokens</p>
                  </div>
                )}

                {isScanning && (
                  <div className="py-12 text-center">
                    <Loader2 className="w-10 h-10 text-emerald-400 mx-auto mb-4 animate-spin" />
                    <p className="text-slate-300">{progressStep || 'Scanning...'}</p>
                  </div>
                )}

                {tokens.length > 0 && (
                  <>
                    {/* Select All / None */}
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm text-slate-400">
                        {selectedCount} of {displayTokens.length} tokens selected
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSelectedTokens(new Set(displayTokens.map((t: TokenInfo) => t.address)))}
                          className="text-xs text-emerald-400 hover:text-emerald-300"
                        >
                          Select All
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          onClick={() => setSelectedTokens(new Set())}
                          className="text-xs text-slate-400 hover:text-slate-300"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {/* Token Grid */}
                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                      {displayTokens.map((token: TokenInfo) => {
                        const isSelected = selectedTokens.has(token.address);
                        const customAmount = customAmounts[token.address] || '';
                        
                        return (
                          <motion.div
                            key={token.address}
                            layout
                            className={`p-3 rounded-xl border transition ${
                              isSelected 
                                ? 'bg-slate-800 border-emerald-500/50' 
                                : 'bg-slate-800/30 border-transparent opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {/* Checkbox */}
                              <button
                                onClick={() => {
                                  const next = new Set(selectedTokens);
                                  if (next.has(token.address)) {
                                    next.delete(token.address);
                                  } else {
                                    next.add(token.address);
                                  }
                                  setSelectedTokens(next);
                                }}
                                className={`w-5 h-5 rounded flex items-center justify-center border transition ${
                                  isSelected 
                                    ? 'bg-emerald-500 border-emerald-500' 
                                    : 'border-slate-600 hover:border-slate-500'
                                }`}
                              >
                                {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                              </button>

                              {/* Token Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-white">{token.symbol}</span>
                                  <span className="text-xs text-slate-500">{shortenAddress(token.address)}</span>
                                </div>
                                <div className="text-sm text-slate-400">
                                  Balance: {token.balanceFormatted}
                                </div>
                              </div>

                              {/* Value */}
                              <div className="text-right">
                                <div className="text-emerald-400 font-medium">
                                  {formatUSD(token.valueUsd)}
                                </div>
                                <div className="text-xs text-slate-500">
                                  @ ${formatNumber(token.price, 4)}
                                </div>
                              </div>
                              
                              {/* Mark as Spam button */}
                              <button
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  markTokenAsFailed(chainId, token.address);
                                  // Remove from tokens list
                                  setTokens((prev: TokenInfo[]) => prev.filter((t: TokenInfo) => t.address !== token.address));
                                  // Remove from selection
                                  setSelectedTokens((prev: Set<string>) => {
                                    const next = new Set(prev);
                                    next.delete(token.address);
                                    return next;
                                  });
                                  console.log(`🚫 Marked ${token.symbol} as spam`);
                                }}
                                className="ml-2 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition"
                                title="Mark as spam (hide this token)"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Custom Amount Input */}
                            {isSelected && (
                              <div className="mt-3 flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2 border border-slate-700">
                                <input
                                  type="text"
                                  placeholder={token.balanceFormatted}
                                  value={customAmount}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    setCustomAmounts((prev: Record<string, string>) => ({
                                      ...prev,
                                      [token.address]: e.target.value
                                    }));
                                  }}
                                  className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                                />
                                <button
                                  onClick={() => {
                                    setCustomAmounts((prev: Record<string, string>) => {
                                      const copy = { ...prev };
                                      delete copy[token.address];
                                      return copy;
                                    });
                                  }}
                                  className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
                                >
                                  MAX
                                </button>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Action Footer */}
              {tokens.length > 0 && (
                <div className="p-4 border-t border-slate-700/50 bg-slate-900/30">
                  {/* Summary */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <span className="text-sm text-slate-400">Total Value:</span>
                      <span className="ml-2 text-xl font-bold text-white">
                        {formatUSD(totalSelectedValue)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400">
                      {selectedCount} token{selectedCount !== 1 ? 's' : ''} → {outputToken}
                    </div>
                  </div>

                  {/* Execute Button */}
                  <button
                    onClick={fetchQuotesAndShowPreview}
                    disabled={isProcessing || selectedCount === 0}
                    className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-lg transition flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {progressStep || 'Processing...'}
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-5 h-5" />
                        Sweep {selectedCount} Token{selectedCount !== 1 ? 's' : ''} to {outputToken}
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* Error Display */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <p className="text-red-200">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="ml-auto text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Display */}
        <AnimatePresence>
          {swapResults && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl"
            >
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
                <div className="flex-1">
                  <p className="text-emerald-200 font-medium">
                    Successfully swept {swapResults.success} token{swapResults.success !== 1 ? 's' : ''}!
                  </p>
                  <p className="text-sm text-emerald-200/70">
                    Total value: {formatUSD(swapResults.totalValue)}
                  </p>
                </div>
                {txHash && (
                  <a
                    href={`${config.explorerUrl}/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
                  >
                    View TX <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <div className="p-4 bg-slate-800/30 backdrop-blur border border-slate-700/50 rounded-xl">
            <Coins className="w-6 h-6 text-emerald-400 mb-2" />
            <h3 className="font-medium text-white mb-1">Batch Swaps</h3>
            <p className="text-sm text-slate-400">
              Swap multiple tokens in a single transaction, saving gas
            </p>
          </div>
          <div className="p-4 bg-slate-800/30 backdrop-blur border border-slate-700/50 rounded-xl">
            <Zap className="w-6 h-6 text-blue-400 mb-2" />
            <h3 className="font-medium text-white mb-1">Best Rates</h3>
            <p className="text-sm text-slate-400">
              Uses 0x aggregator for optimal swap routing
            </p>
          </div>
          <div className="p-4 bg-slate-800/30 backdrop-blur border border-slate-700/50 rounded-xl">
            <Settings className="w-6 h-6 text-purple-400 mb-2" />
            <h3 className="font-medium text-white mb-1">Full Control</h3>
            <p className="text-sm text-slate-400">
              Select specific tokens and customize amounts
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}