'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrandHeader, BrandFooter } from '@/components/brand';
import { AERO, SLIPPAGE_BPS, QUOTE_TTL_MS, exactAmount, minimumOutput, preserveMinimum, bind0xQuote, pendingKey, validatePending, matchesPending, pendingTransactionKind, walletReceiptOutput, isWalletRejection, isProvenNotSubmitted, mapBounded, sameAddress, type PendingSweep, type OutputToken } from '@/lib/sweep-guards';
import type { BaseNativeQuote, BaseNativeConfig, BaseNativeClient } from '@/lib/base-native-sweep';
import { independentPrice, currentIndependentPrice, assessQuoteValue, acceptValueRisk, quoteValueExecutable, assertRefreshedQuoteValue, type IndependentPrice, type QuoteValueQuality, type ValueRiskConsent } from '@/lib/sweep-value-quality';
import { discoveryFailureMessage, discoveredTokenAddresses } from '@/lib/sweep-discovery-ui';
import { inventoryHasDisplayPrice, isDisplayStock, sweepInventory } from '@/lib/sweep-inventory';
import { bindSubmittedWalletRequest } from '@/lib/sweep-transaction-proof';
import { createExecutionPriceReader } from '@/lib/sweep-execution-prices';
import { runStockDisplayEstimates, stockDisplayValue, type StockDisplayEstimate } from '@/lib/stock-display-estimates';
import { 
  useAccount, 
  usePublicClient, 
  useWriteContract,
  useChainId,
  useSwitchChain,
  useWalletClient
} from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { 
  parseUnits, 
  formatUnits, 
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  type Hex,
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
  ChevronRight,
  ExternalLink,
  Zap,
  X,
  XCircle,
  HelpCircle
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
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    usdcDecimals: 6,
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://arbiscan.io',
    coingeckoId: 'arbitrum-one',
  },
  10: { // Optimism
    name: 'Optimism',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    usdcDecimals: 6,
    weth: '0x4200000000000000000000000000000000000006',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://optimistic.etherscan.io',
    coingeckoId: 'optimistic-ethereum',
  },
  137: { // Polygon
    name: 'Polygon',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    usdcDecimals: 6,
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://polygonscan.com',
    coingeckoId: 'polygon-pos',
  },
  56: { // BNB Chain
    name: 'BNB Chain',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    usdcDecimals: 18,
    weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://bscscan.com',
    coingeckoId: 'binance-smart-chain',
  },
  43114: { // Avalanche
    name: 'Avalanche',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    usdcDecimals: 6,
    weth: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://snowtrace.io',
    coingeckoId: 'avalanche',
  },
  534352: { // Scroll
    name: 'Scroll',
    swapper: '0x75f57Faf06f0191a1422a665BFc297bcb6Aa765a',
    usdc: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4',
    usdcDecimals: 6,
    weth: '0x5300000000000000000000000000000000000004',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://scrollscan.com',
    coingeckoId: 'scroll',
  },
  59144: { // Linea
    name: 'Linea',
    swapper: '0x679e6e600E480d99f8aeD8555953AD2cF43bAB96',
    usdc: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
    usdcDecimals: 6,
    weth: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
    explorerUrl: 'https://lineascan.build',
    coingeckoId: 'linea',
  },
};

const SWAPPER_ABI = parseAbi([
  'function executePlanFromCallerAdvanced((uint8 kind,address tokenIn,address outToken,bool useAll,uint256 amountIn,uint256 quotedIn,uint256 quotedOut,uint16 slippageBps,bytes data,bool viaPermit2,bytes permitSig,uint256 permitAmount,uint256 permitDeadline,uint256 permitNonce)[] plan,address recipient,(uint256 minTotalOut,bool allowPartial) opts) returns(uint256)',
]);

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
  unitsVerified: boolean;
  balance: bigint;
  balanceFormatted: string;
  price: number;
  valueUsd: number;
  logoUrl?: string;
  priceSource?: 'zerox' | 'defillama' | 'coingecko' | 'stablecoin' | 'unknown';
  priceObservation?: IndependentPrice;
  displayEstimate?: StockDisplayEstimate;
}

type MarketPrice = { price: number; source: string; observation?: IndependentPrice };

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
  minimum: bigint;
  quotedAt: number;
  native?: BaseNativeQuote;
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
  inputValueUsd: number;
  quotedOutputUsd: number;
  actualOutputUsd?: number;
  estimatedInputValueUsd?: number;
  estimatedInputUsdc?: string;
  executionSlippage: number;
  totalCostPercent: number;
  independentValuationAvailable: boolean;
  status: 'success' | 'failed' | 'skipped' | 'pending';
  error?: string;
}

interface RawTokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  unitsVerified: boolean;
  balance: string;
  logoUrl?: string;
}

// ============================================================================
// CACHING SYSTEM
// ============================================================================

const PRICE_CACHE_TTL = 5 * 60 * 1000;
const EXTERNAL_SPAM_LIST_TTL = 24 * 60 * 60 * 1000;

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

const KNOWN_GOOD_TOKENS: Record<number, Set<string>> = {
  1: new Set([
    '0xd533a949740bb3306d119cc777fa900ba034cd52',
    '0x808507121b80c02388fad14726482e061b8da827',
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    '0xc00e94cb662c3520282e6f5717214004a7f26888',
    '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2',
    '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2',
    '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e',
    '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f',
    '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b',
    '0x5a98fcbea516cf06857215779fd812ca3bef1b32',
    '0xba100000625a3754423978a60c9317c58a424e3d',
    '0x111111111117dc0aa78b770fa6a738034120c302',
    '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
    '0x514910771af9ca656af840dff83e8264ecf986ca',
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    '0xae78736cd615f374d3085123a210448e74fc6393',
    '0xbe9895146f7af43049ca1c1ae358b0541ea49704',
    '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
    '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff',
  ].map(a => a.toLowerCase())),
  8453: new Set([
    '0x940181a94a35a4569e4529a3cdfb74e38fd98631', // AERO (Aerodrome, old)
    '0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee', // AERO (Aero, new since 2026-10-22)
    '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
    '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452',
    '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c',
    '0x4200000000000000000000000000000000000006',
  ].map(a => a.toLowerCase())),
  42161: new Set([
    '0x912ce59144191c1204e64559fe8253a0e49e6548',
    '0x11cdb42b0eb46d95f990bedd4695a6e3fa034978',
    '0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8',
    '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a',
    '0x539bde0d7dbd336b79148aa742883198bbf60342',
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    '0x5979d7b546e38e414f7e9822514be443a4800529',
  ].map(a => a.toLowerCase())),
  10: new Set([
    '0x4200000000000000000000000000000000000042',
    '0x0994206dfe8de6ec6920ff4d779b0d950605fb53',
    '0x9560e827af36c94d2ac33a39bce1fe78631088db',
    '0x4200000000000000000000000000000000000006',
    '0x1f32b1c2345538c0c6f582fcb022739c4a194ebb',
  ].map(a => a.toLowerCase())),
  137: new Set([
    '0x172370d5cd63279efa6d502dab29171933a610af',
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
    '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39',
  ].map(a => a.toLowerCase())),
  56: new Set([
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
    '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
  ].map(a => a.toLowerCase())),
  43114: new Set([
    '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
    '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
    '0x152b9d0fdc40c096757f570a51e494bd4b943e50',
  ].map(a => a.toLowerCase())),
};

function isKnownGoodToken(chainId: number, address: string): boolean {
  const whitelist = KNOWN_GOOD_TOKENS[chainId];
  return whitelist ? whitelist.has(address.toLowerCase()) : false;
}

// Tokens that share a symbol with another token on the same chain; the label is shown next to the symbol.
const TOKEN_LABELS: Record<number, Record<string, string>> = {
  8453: {
    '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 'Aerodrome (old)',
    '0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee': 'Aero (new)',
  },
};

function getTokenLabel(chainId: number, address: string): string | undefined {
  return TOKEN_LABELS[chainId]?.[address.toLowerCase()];
}

const KNOWN_GOOD_SYMBOLS = new Set([
  'CRV', 'CVX', 'AAVE', 'UNI', 'SUSHI', 'COMP', 'MKR', 'YFI', 'BAL', '1INCH', 'SNX', 'LDO',
  'PENDLE',
  'STETH', 'WSTETH', 'RETH', 'CBETH', 'SFRXETH', 'FRXETH', 'ANKRETH', 'SWETH', 'ETHX',
  'METH', 'EETH', 'WEETH', 'RSETH', 'EZETH', 'PUFETH',
  'WETH', 'WBTC', 'WMATIC', 'WAVAX', 'WBNB', 'ARB', 'OP', 'MATIC', 'AVAX', 'ETH', 'BTC',
  'USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'SUSD', 'BUSD', 'TUSD', 'USDP', 'GHO', 'CRVUSD', 'PYUSD',
  'USDE', 'SUSDE', 'ENA', 'SENA',
  'LINK', 'GRT', 'ENS', 'APE', 'SHIB', 'PEPE', 'DOGE', 'IMX', 'BLUR', 'RNDR', 'FET', 'OCEAN',
  'AERO', 'VELO', 'GMX', 'JOE', 'CAKE', 'QUICK', 'MAGIC',
  'EIGEN', 'PZETH',
  'MORPHO',
  'GLP', 'SGLP',
]);

function isKnownGoodSymbol(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  if (KNOWN_GOOD_SYMBOLS.has(upper)) return true;
  if (upper.startsWith('PT-') || upper.startsWith('YT-') || upper.startsWith('SY-')) return true;
  if (upper.includes('CRV') || upper.includes('CURVE')) return true;
  if (upper.startsWith('CVX')) return true;
  if (upper.match(/^A[A-Z]+V[23]?$/)) return true;
  if (upper.match(/^C[A-Z]+$/)) return true;
  return false;
}

function isProtectedToken(chainId: number, address: string, symbol: string): boolean {
  return isKnownGoodToken(chainId, address) || isKnownGoodSymbol(symbol);
}

const externalSpamCache: Map<number, { addresses: Set<string>; patterns: string[]; timestamp: number }> = new Map();

// FIXED: Returns Set<string> consistently
async function fetchExternalSpamList(chainId: number): Promise<{ addresses: Set<string>; patterns: string[] }> {
  const url = EXTERNAL_SPAM_LISTS[chainId];
  if (!url) return { addresses: new Set(), patterns: [] };
  
  // Check in-memory cache first
  const memCached = externalSpamCache.get(chainId);
  if (memCached && Date.now() - memCached.timestamp < EXTERNAL_SPAM_LIST_TTL) {
    console.log(`📋 Using in-memory spam list for chain ${chainId}: ${memCached.addresses.size} addresses`);
    return { addresses: memCached.addresses, patterns: memCached.patterns };
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
          const patterns = data.patterns || [];
          externalSpamCache.set(chainId, { addresses, patterns, timestamp: data.timestamp });
          console.log(`📋 Using localStorage spam list for chain ${chainId}: ${addresses.size} addresses`);
          return { addresses, patterns };
        }
      }
    } catch (e) {
      console.warn('Failed to read external spam cache:', e);
    }
  }
  
  // Fetch from GitHub
  try {
    console.log(`📥 Fetching external spam list for chain ${chainId}...`);
    const res = await fetch(url, { cache: 'no-cache', signal:AbortSignal.timeout(2500) });
    if (!res.ok) {
      console.warn(`Failed to fetch spam list: ${res.status}`);
      return { addresses: new Set(), patterns: [] };
    }
    
    const data = await res.json();
    
    let addresses: string[] = [];
    let patterns: string[] = [];
    
    if (Array.isArray(data)) {
      addresses = data.map(a => String(a).toLowerCase());
    } else if (typeof data === 'object' && data !== null) {
      if (data.tokens && Array.isArray(data.tokens)) {
        addresses = data.tokens
          .filter((t: any) => t)
          .map((t: any) => {
            if (typeof t === 'string') return t.toLowerCase();
            if (t.address) return String(t.address).toLowerCase();
            return null;
          })
          .filter((a: string | null) => a !== null);
        console.log(`  📋 Parsed ${addresses.length} addresses from tokens array`);
      } 
      if (data.symbolPatterns && Array.isArray(data.symbolPatterns)) {
        patterns = data.symbolPatterns.map((p: string) => p.toLowerCase());
        console.log(`  🔍 Loaded ${patterns.length} symbol patterns for heuristic detection`);
      }
      if (addresses.length === 0 && !data.tokens) {
        addresses = Object.keys(data)
          .filter(k => k.startsWith('0x'))
          .map(a => a.toLowerCase());
      }
    }
    
    const addressSet = new Set(addresses);
    console.log(`✅ Loaded ${addressSet.size} spam addresses for chain ${chainId}`);
    
    // Cache in memory (include patterns)
    externalSpamCache.set(chainId, { addresses: addressSet, patterns, timestamp: Date.now() });
    
    // Also cache symbol patterns if present
    if (patterns.length > 0 && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`sweeper_spam_patterns_${chainId}`, JSON.stringify(patterns));
      } catch (e) {
        console.warn('Failed to cache spam patterns:', e);
      }
    }
    
    // Cache in localStorage (include patterns)
    if (typeof window !== 'undefined') {
      try {
        const key = `sweeper_external_spam_${chainId}`;
        localStorage.setItem(key, JSON.stringify({
          addresses: Array.from(addressSet),
          patterns,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.warn('Failed to write external spam cache:', e);
      }
    }
    
    return { addresses: addressSet, patterns };
  } catch (e) {
    console.warn('Failed to fetch external spam list:', e);
    return { addresses: new Set(), patterns: [] };
  }
}

function getPriceCacheKey(chainId: number): string {
  return `sweeper_prices_${chainId}`;
}

function getCachedPrices(chainId: number): Record<string, MarketPrice & { timestamp: number }> {
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

function getCachedPrice(chainId: number, tokenAddress: string): MarketPrice | null {
  const allPrices = getCachedPrices(chainId);
  const entry = allPrices[tokenAddress.toLowerCase()];
  if (entry && Number.isFinite(entry.price) && entry.price > 0 && Number.isSafeInteger(entry.timestamp) && entry.timestamp <= Date.now() && Date.now() - entry.timestamp < PRICE_CACHE_TTL) {
    return { price: entry.price, source: entry.source, observation: currentIndependentPrice(entry.observation, chainId, tokenAddress) };
  }
  return null;
}

function setCachedPrice(chainId: number, tokenAddress: string, price: MarketPrice): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getPriceCacheKey(chainId);
    const allPrices = getCachedPrices(chainId);
    allPrices[tokenAddress.toLowerCase()] = { ...price, timestamp: price.observation?.retrievedAt ?? Date.now() };
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

function getTokenCacheKey(address: string, chainId: number): string {
  return `sweeper_tokens_v2_${address.toLowerCase()}_${chainId}`;
}

function getCachedTokens(address: string, chainId: number): RawTokenInfo[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getTokenCacheKey(address, chainId);
    const cached = localStorage.getItem(key);
    if (cached) {
      const data = JSON.parse(cached);
      if(!Number.isFinite(data.timestamp)||Date.now()-data.timestamp>PRICE_CACHE_TTL||!Array.isArray(data.tokens))return null;
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

function getUserHiddenTokensKey(chainId: number): string {
  return `sweeper_user_hidden_${chainId}`;
}

function getUserHiddenTokens(chainId: number): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const cached = localStorage.getItem(getUserHiddenTokensKey(chainId));
    if (cached) {
      return new Set(JSON.parse(cached));
    }
  } catch (e) {
    console.warn('Failed to read user hidden tokens:', e);
  }
  return new Set();
}

function hideToken(chainId: number, tokenAddress: string): void {
  if (typeof window === 'undefined') return;
  try {
    const hidden = getUserHiddenTokens(chainId);
    hidden.add(tokenAddress.toLowerCase());
    localStorage.setItem(getUserHiddenTokensKey(chainId), JSON.stringify(Array.from(hidden)));
    console.log(`🚫 User hid token: ${tokenAddress.slice(0, 10)}...`);
  } catch (e) {
    console.warn('Failed to hide token:', e);
  }
}

function clearUserHiddenTokens(chainId: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getUserHiddenTokensKey(chainId));
    console.log('🗑️ Cleared user hidden tokens');
  } catch (e) {
    console.warn('Failed to clear user hidden tokens:', e);
  }
}

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

function isSpamBySymbol(symbol: string, patterns: string[]): boolean {
  if (!symbol || patterns.length === 0) return false;
  const lowerSymbol = symbol.toLowerCase();
  return patterns.some(pattern => lowerSymbol.includes(pattern.toLowerCase()));
}

function getCacheStats(chainId: number, walletAddress?: string): {
  externalSpam: number;
  userHidden: number;
  cachedPrices: number;
  cachedTokens: number;
} {
  const externalCached = externalSpamCache.get(chainId);
  const userHidden = getUserHiddenTokens(chainId);
  const prices = getCachedPrices(chainId);
  let tokenCount = 0;
  if (walletAddress) {
    const tokens = getCachedTokens(walletAddress, chainId);
    tokenCount = tokens?.length || 0;
  }
  
  return {
    externalSpam: externalCached?.addresses.size || 0,
    userHidden: userHidden.size,
    cachedPrices: Object.keys(prices).length,
    cachedTokens: tokenCount
  };
}

interface QuotePreviewItem {
  token: TokenInfo & { amountToSwap: bigint };
  inputValueUsd: number;
  quotedOutputUsd: number;
  lossPercent: number;
  lossUsd: number;
  quote: SwapQuote;
  selected: boolean;
  quality: QuoteValueQuality;
  riskConsent?: ValueRiskConsent;
  estimatedInputValueUsd?: number;
  estimatedInputUsdc?: string;
}

interface FailedQuoteItem {
  token: TokenInfo & { amountToSwap: bigint };
  error: string;
}

interface QuotePreviewData {
  quotes: QuotePreviewItem[];
  failedQuotes: FailedQuoteItem[];
  outputToken: OutputToken;
  outputPrice: number;
  outputPriceObservation?: IndependentPrice;
  outputDecimals: number;
  account: Address;
  chainId: number;
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
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const contextRef = useRef({ key: '', epoch: 0 });
  const contextKey = `${chainId}:${address?.toLowerCase() ?? ''}`;
  if (contextRef.current.key !== contextKey) contextRef.current = {key: contextKey, epoch: contextRef.current.epoch + 1};
  const scanEpoch = useRef(0);
  const sendLock = useRef(false);
  const [journalError, setJournalError] = useState(false);
  const [pending, setPending] = useState<PendingSweep | null>(null);
  const [recoveryHash, setRecoveryHash] = useState('');
  const scope = () => ({...contextRef.current});
  const checkScope = (captured: {key:string;epoch:number}) => {
    if (contextRef.current.key !== captured.key || contextRef.current.epoch !== captured.epoch) throw new Error('Wallet or network changed. Review again.');
  };

  const [discoveryNotice, setDiscoveryNotice] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [manualTokens, setManualTokens] = useState<Set<string>>(new Set());
  const [manualTokensLoaded, setManualTokensLoaded] = useState(false);
  const [isAddingToken, setIsAddingToken] = useState(false);
  
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
  
  const saveManualTokens = useCallback((tokens: Set<string>) => {
    if (typeof window !== 'undefined' && chainId) {
      localStorage.setItem(`manualTokens_${chainId}`, JSON.stringify(Array.from(tokens)));
    }
  }, [chainId]);
  
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [stockPriceCycle, setStockPriceCycle] = useState(0);
  const stockPriceJob = useRef<Promise<void> | null>(null);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  
  const [outputToken, setOutputToken] = useState<OutputToken>('USDC');
  
  const [showQuotePreview, setShowQuotePreview] = useState(false);
  const [quotePreviewData, setQuotePreviewData] = useState<QuotePreviewData | null>(null);
  
  const [txHash, setTxHash] = useState<string | null>(null);
  const [swapResults, setSwapResults] = useState<{
    success: number;
    failed: number;
    skipped: number;
    pending: number;
    problem?: string;
    walletRequest?: {label:string;hash?:Hex};
    totalValue: number;
    totalOutput: string;
    outputToken: OutputToken;
    valuationAvailable: boolean;
  } | null>(null);
  const [detailedResults, setDetailedResults] = useState<SwapResultDetail[]>([]);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [lastScannedKey, setLastScannedKey] = useState<string | null>(null);  

  const config = CHAIN_CONFIG[chainId] || CHAIN_CONFIG[8453];
  const supportedChain = !!CHAIN_CONFIG[chainId];
  const outputAddress = (token: OutputToken): Address => token === 'AERO' ? AERO : token === 'USDC' ? config.usdc : config.weth;

  useEffect(() => {
    setTokens([]);
    setVisibleCount(50);
    setInventoryQuery('');
    setSelectedTokens(new Set());
    setCustomAmounts({});
    setQuotePreviewData(null);
    setSwapResults(null);
    setDetailedResults([]);
    setError(null);
    setTxHash(null);
    setShowQuotePreview(false);
    setIsProcessing(false);
    setIsScanning(false);
    setPending(null);
    setDiscoveryNotice('');
    setJournalError(false);
    if (chainId !== 8453) setOutputToken('USDC');
    if (address) {
      try {
        const raw = localStorage.getItem(pendingKey(address, chainId));
        if (raw) {const record=validatePending(JSON.parse(raw),address,chainId);if(!record)throw new Error();setPending(record);}
      } catch { setJournalError(true);setError('Transaction history is unavailable. Check wallet activity before swapping.'); }
    }
    if (!address || !supportedChain) return;
    
    console.log(`🔄 Wallet changed to ${address.slice(0, 8)}... on chain ${chainId}`);
    
  }, [address, chainId, supportedChain]);

  useEffect(() => {
    const outputTokenAddr = outputAddress(outputToken);
    setSelectedTokens((prev: Set<string>) => {
      const newSet = new Set(prev);
      newSet.delete(outputTokenAddr);
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
    
    const captured = scope();
    const scanId = ++scanEpoch.current;
    const isCurrent = () => captured.key === contextRef.current.key && captured.epoch === contextRef.current.epoch && scanId === scanEpoch.current;
    setIsScanning(true);
    setDiscoveryNotice('');
    setError(null);
    
    try {
      let rawTokens: RawTokenInfo[] | null = null;
      
      if (!forceRefresh) {
        rawTokens = getCachedTokens(address, chainId);
        if (rawTokens) {
          console.log(`📦 Using cached tokens: ${rawTokens.length} tokens`);
          
          if (manualTokens.size > 0) {
            const cachedAddrs = new Set(rawTokens.map(t => t.address.toLowerCase()));
            const manualArray: string[] = [...manualTokens];
            const missingManual = manualArray.filter((addr: string) => !cachedAddrs.has(addr.toLowerCase()));
            
            if (missingManual.length > 0) {
              console.log(`📌 Fetching ${missingManual.length} manual tokens not in cache...`);
              setProgressStep(`Fetching ${missingManual.length} manual tokens...`);
              
              const manualInfos = await fetchTokenInfos(missingManual as Address[], address, publicClient);
              const validManual = manualInfos.filter(t => t.balance > 0n);
              
              for (const t of validManual) {
                rawTokens.push({
                  address: t.address,
                  symbol: t.symbol,
                  name: t.name,
                  decimals: t.decimals,
                  unitsVerified: t.unitsVerified,
                  balance: t.balance.toString(),
                  logoUrl: t.logoUrl
                });
              }
              
              if (validManual.length > 0) {
                console.log(`📌 Added ${validManual.length} manual tokens to cached list`);
                setCachedTokens(address, chainId, rawTokens);
              }
            }
          }
        }
      } else {
        clearTokenCache(address, chainId);
        clearPriceCache(chainId);
        console.log('🔄 Force refresh - cleared token and price caches (spam list preserved)');
      }
      
      if (!rawTokens) {
        setProgressStep('Fetching token list...');
        
        let tokenAddresses = await fetchTokenList(chainId, address);
        
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
          setTokens([]);setSelectedTokens(new Set());setCustomAmounts({});
          setError('No tokens found in wallet');
          return;
        }
        
        setProgressStep(`Checking ${tokenAddresses.length} tokens...`);
        
        const tokenInfos = await fetchTokenInfos(tokenAddresses, address, publicClient);
        
        const validTokens = tokenInfos.filter(t => t.balance > 0n);
        
        if (validTokens.length === 0) {
          setTokens([]);setSelectedTokens(new Set());setCustomAmounts({});
          setError('No swappable tokens found in wallet');
          return;
        }
        
        rawTokens = validTokens.map(t => ({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
                  unitsVerified: t.unitsVerified,
          balance: t.balance.toString(),
          logoUrl: t.logoUrl
        }));
        
        setCachedTokens(address, chainId, rawTokens);
        console.log(`💾 Cached ${rawTokens.length} tokens`);
      }
      
      setProgressStep('Loading spam lists...');
      
      console.log(`📋 All ${rawTokens.length} tokens in wallet:`, rawTokens.map(t => t.symbol).join(', '));
      
      // Get spam lists: external GitHub list + user-hidden tokens

      const { addresses: externalSpam, patterns: externalPatterns } = await fetchExternalSpamList(chainId);
      const userHidden = getUserHiddenTokens(chainId);

      // Combine spam sources
      const spamTokens = new Set([...externalSpam, ...userHidden]);

// Get spam symbol patterns for heuristic detection (use external patterns or fallback to localStorage)
const spamPatterns = externalPatterns.length > 0 ? externalPatterns : getSpamPatterns(chainId);
      
      let patternMatches = 0;
      let whitelistSaved = 0;
      const nonSpamRawTokens = rawTokens.filter(t => {
        const addrLower = t.address.toLowerCase();
        if(manualTokens.has(addrLower))return true;
        
        if (isProtectedToken(chainId, addrLower, t.symbol)) {
          if (spamTokens.has(addrLower)) {
            whitelistSaved++;
            console.log(`✅ Whitelist saved: ${t.symbol} (was in spam list)`);
          }
          return true;
        }
        
        if (spamTokens.has(addrLower)) {
          console.log(`🚫 Filtering spam: ${t.symbol} (${t.address.slice(0, 10)}...)`);
          return false;
        }
        if (isSpamBySymbol(t.symbol, spamPatterns)) {
          patternMatches++;
          console.log(`🔍 Pattern match: ${t.symbol} (${t.address.slice(0, 10)}...)`);
          return false;
        }
        return true;
      });
      
      const spamRemoved = rawTokens.length - nonSpamRawTokens.length;
      if (spamRemoved > 0) {
        console.log(`🧹 Pre-filtered ${spamRemoved} spam tokens (${patternMatches} by pattern)`);
      }
      if (whitelistSaved > 0) {
        console.log(`✅ Whitelist protected ${whitelistSaved} known good tokens`);
      }
      
      if (!isCurrent()) return;
      setTokens(nonSpamRawTokens.map(t => ({...t, balance:BigInt(t.balance), price:0, valueUsd:0, priceSource:'unknown' as const,
        balanceFormatted:t.unitsVerified ? formatNumber(Number(formatUnits(BigInt(t.balance),t.decimals)),4) : 'Units unavailable'})));
      setProgressStep('Fetching market prices...');
      
      const outputTokenAddr = config.usdc;
      
      const tokensNeedingPrices: Array<{ address: Address; decimals: number; unitsVerified?: boolean; balance: bigint; symbol: string }> = [];
      const cachedPrices: Record<string, MarketPrice> = {};

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
                  unitsVerified: t.unitsVerified,
            balance: BigInt(t.balance),
            symbol: t.symbol
          });
        }
      }

      console.log(`💰 Using ${Object.keys(cachedPrices).length} cached prices, fetching ${tokensNeedingPrices.length} new`);

      // Fetch prices for tokens that need them
      let fetchedPrices: Record<string, MarketPrice> = {};
      if (tokensNeedingPrices.length > 0) {
        fetchedPrices = await fetchMarketPrices(tokensNeedingPrices, chainId, outputTokenAddr, setProgressStep);
        
        // Cache the fetched prices
        for (const t of tokensNeedingPrices) {
          const addrLower = t.address.toLowerCase();
          if (fetchedPrices[addrLower]) {
            setCachedPrice(chainId, t.address, fetchedPrices[addrLower]);
          }
        }
      }

      // Combine cached and fetched prices
      const allPrices = { ...cachedPrices, ...fetchedPrices };

      
      const KNOWN_STABLECOINS: Record<number, Record<string, number>> = {
        1: {
          '0xdac17f958d2ee523a2206206994597c13d831ec7': 1,
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,
          '0x6b175474e89094c44da98b954eedeac495271d0f': 1,
          '0x4fabb145d64652a948d72533023f6e7a623c7c53': 1,
          '0x8e870d67f660d95d5be530380d0ec0bd388289e1': 1,
          '0x0000000000085d4780b73119b644ae5ecd22b376': 1,
          '0x853d955acef822db058eb8505911ed77f175b99e': 1,
          '0x5f98805a4e8be255a32880fdec7f6728c6568ba0': 1,
          '0x57ab1ec28d129707052df4df418d58a2d46d5f51': 1,
        },
        8453: {
          '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 1,
          '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 1,
          '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 1,
        },
        42161: {
          '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 1,
          '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 1,
          '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 1,
          '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 1,
        },
        10: {
          '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 1,
          '0x7f5c764cbc14f9669b88837ca1490cca17c31607': 1,
          '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 1,
          '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 1,
          '0x2e3d870790dc77a83dd1d18184acc7439a53f475': 1,
          '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9': 1,
        },
        137: {
          '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 1,
          '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 1,
          '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 1,
          '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 1,
          '0x45c32fa6df82ead1e2ef74d17b76547eddfaff89': 1,
        },
        56: {
          '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 1,
          '0x55d398326f99059ff775485246999027b3197955': 1,
          '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': 1,
          '0xe9e7cea3dedca5984780bafc599bd69add087d56': 1,
          '0x14016e85a25aeb13065688cafb43044c2ef86784': 1,
        },
        43114: {
          '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 1,
          '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664': 1,
          '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7': 1,
          '0xd586e7f844cea2f87f50152665bcbc2c279d8d70': 1,
          '0x130966628846bfd36ff31a822705796e8cb8c18d': 1,
        },
        534352: {
          '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4': 1,
          '0xf55bec9cafdbe8730f096aa55dad6d22d44099df': 1,
        },
        59144: {
          '0x176211869ca2b568f2a7d4ee941e073a821ee1ff': 1,
          '0xa219439258ca9da29e9cc4ce5596924745e12b93': 1,
          '0x4af15ec2a0bd43db75dd04e62faa3b8ef36b00d5': 1,
        }
      };
      
      const chainStables = KNOWN_STABLECOINS[chainId] || {};
      
      const enrichedTokens = nonSpamRawTokens
        .map(t => {
          const addrLower = t.address.toLowerCase();
          const priceData = allPrices[addrLower];
          let price = 0;
          let priceSource: 'zerox' | 'defillama' | 'coingecko' | 'stablecoin' | 'unknown' = 'unknown';
          
          if (priceData) {
            price = priceData.price;
            priceSource = priceData.source as any;
          } else if (chainStables[addrLower]) {
            price = chainStables[addrLower];
            priceSource = 'stablecoin';
            console.log(`💵 Using stablecoin fallback for ${t.symbol}: $${price}`);
          }

          const balance = BigInt(t.balance);
          const balanceNum = t.unitsVerified ? Number(formatUnits(balance, t.decimals)) : 0;
          
          return {
            address: t.address as Address,
            symbol: t.symbol,
            name: t.name,
            decimals: t.decimals,
                  unitsVerified: t.unitsVerified,
            balance,
            price,
            priceSource,
            priceObservation: priceData?.observation,
            valueUsd: balanceNum * price,
            balanceFormatted: t.unitsVerified ? formatNumber(balanceNum, 4) : 'Units unavailable',
            logoUrl: t.logoUrl
          };
        });
      
      enrichedTokens.sort((a, b) => b.valueUsd - a.valueUsd);
      
      if (!isCurrent()) return;
      setTokens(enrichedTokens);
      // Only auto-select tokens with known prices
      setSelectedTokens(new Set(enrichedTokens.filter(t => t.unitsVerified && t.valueUsd >= 0.10 && !sameAddress(t.address, outputAddress(outputToken))).map(t => t.address)));
      setCustomAmounts({});
      
    } catch (err: any) {
      if (!isCurrent()) return;
      setError(err.message || 'Failed to scan wallet');
    } finally {
      if (!isCurrent()) return;
      setIsScanning(false);
      setProgressStep('');
      setHasScanned(true);
    }
  }, [address, publicClient, chainId, supportedChain, config, manualTokens]);

  // Reset scan state when wallet or chain changes
  useEffect(() => {
    const currentKey = address && chainId ? `${address}-${chainId}` : null;
    
    // If wallet/chain combo changed, reset everything
    if (currentKey !== lastScannedKey) {
      setTokens([]);
      setSelectedTokens(new Set());
      setCustomAmounts({});
      setHasScanned(false);
      console.log(`🔄 Wallet/chain changed: ${currentKey}`);
    }
  }, [address, chainId, lastScannedKey]);

  // Auto-scan new wallet/chain combos
  useEffect(() => {
    const currentKey = address && chainId ? `${address}-${chainId}` : null;
    
    if (
      address && 
      supportedChain && 
      !isScanning && 
      !hasScanned && 
      tokens.length === 0 && 
      manualTokensLoaded &&
      currentKey !== lastScannedKey
    ) {
      const timer = setTimeout(() => {
        console.log(`🔄 Auto-scanning ${address.slice(0, 8)}... on chain ${chainId}...`);
        setLastScannedKey(currentKey);
        scanWalletTokens();
      }, 800);
      
      return () => clearTimeout(timer);
    }
  }, [address, chainId, supportedChain, scanWalletTokens, isScanning, hasScanned, tokens.length, manualTokensLoaded, lastScannedKey]);

  async function fetchTokenList(chainId: number, wallet: string): Promise<Address[]> {
    const captured=scope();
    let res:Response;
    try {
      res = await fetch(
        `/api/tokens/discover?chainId=${chainId}&wallet=${wallet}`
      );
    } catch {
      checkScope(captured);
      throw new Error('Token discovery could not be reached. Retry the scan.');
    }
    checkScope(captured);
    if(!res.ok)throw new Error(discoveryFailureMessage(res.status,res.headers.get('Retry-After')));
    let data:unknown;
    try { data=await res.json(); } catch { throw new Error('Token discovery returned an invalid response. Retry the scan.'); }
    checkScope(captured);
    const addresses=discoveredTokenAddresses(data);
    if((data as {partial?:boolean}).partial)setDiscoveryNotice('Some discovery services were unavailable. You can re-scan or add a missing token by address.');
    return addresses;
  }

  async function fetchTokenInfos(
    addresses: Address[], 
    wallet: string, 
    client: any
  ): Promise<TokenInfo[]> {
    const pages=Array.from({length:Math.ceil(addresses.length/50)},(_,i)=>addresses.slice(i*50,i*50+50));
    const results=(await mapBounded(pages,3,async page=>client.multicall({contracts:page.flatMap(addr=>[
      {address:addr,abi:ERC20_ABI,functionName:'symbol'},
      {address:addr,abi:ERC20_ABI,functionName:'name'},
      {address:addr,abi:ERC20_ABI,functionName:'decimals'},
      {address:addr,abi:ERC20_ABI,functionName:'balanceOf',args:[wallet as Address]}
    ]),batchSize:50_000,allowFailure:true}))).flat();

    return addresses.map((addr, i) => {
      const symbolRes = results[i * 4];
      const nameRes = results[i * 4 + 1];
      const decimalsRes = results[i * 4 + 2];
      const balanceRes = results[i * 4 + 3];
      
      return {
        address: addr,
        symbol: symbolRes.status === 'success' ? (symbolRes.result as string) : 'UNKNOWN',
        name: nameRes.status === 'success' ? (nameRes.result as string) : 'Unknown Token',
        decimals: decimalsRes.status === 'success' && Number(decimalsRes.result) <= 36 ? Number(decimalsRes.result) : 0,
        unitsVerified: decimalsRes.status === 'success' && Number.isInteger(Number(decimalsRes.result)) && Number(decimalsRes.result) >= 0 && Number(decimalsRes.result) <= 36,
        balance: balanceRes.status === 'success' ? (balanceRes.result as bigint) : 0n,
        balanceFormatted: '0',
        price: 0,
        valueUsd: 0
      };
    });
  }

  async function fetchMarketPrices(
    tokens: Array<{ address: Address; decimals: number; balance: bigint; symbol: string }>,
    chainId: number,
    outputToken: Address,
    onProgress?: (msg: string) => void
  ): Promise<Record<string, MarketPrice>> {
    onProgress?.('Updating display prices…');
    const prices: Record<string, MarketPrice> = {};
    const chunks = Array.from({length:Math.ceil(tokens.length / 60)},(_,i)=>tokens.slice(i*60,i*60+60));
    await mapBounded(chunks, 3, async(chunk) => {
      const [llama, gecko] = await Promise.all([fetchDefiLlamaPrices(chunk.map(t=>t.address),chainId), fetchCoinGeckoPrices(chunk.map(t=>t.address),chainId)]);
      for (const t of chunk) {
        const key=t.address.toLowerCase();
        if (llama[key]) prices[key]=llama[key];
        else {
          const observation=independentPrice({chainId,token:key,price:gecko[key],source:'coingecko',retrievedAt:Date.now()});
          if(observation)prices[key]={price:observation.price,source:'coingecko',observation};
        }
      }
    });
    return prices;
  }

  async function fetchDefiLlamaPrices(addresses: Address[], chainId: number): Promise<Record<string, MarketPrice>> {
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
    const chainName = chainNameMap[chainId];
    if(!chainName)return {};
    const ids = addresses.map(a => `${chainName}:${a}`).join(',');
    
    try {
      const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`, {signal:AbortSignal.timeout(4500)});
      if(!res.ok)return {};
      const data = await res.json();
      const retrievedAt=Date.now();
      const requested=new Set(addresses.map(a=>`${chainName}:${a.toLowerCase()}`));
      const prices: Record<string, MarketPrice> = {};
      for (const [key, val] of Object.entries<any>(data.coins || {})) {
        if(!requested.has(key.toLowerCase()))continue;
        const addr = key.split(':')[1].toLowerCase();
        const observation=independentPrice({chainId,token:addr,price:val?.price,source:'defillama',retrievedAt,
          ...(val?.timestamp === undefined ? {} : {observedAt: typeof val.timestamp === 'number' ? val.timestamp*1000 : NaN})});
        if(observation)prices[addr]={price:observation.price,source:'defillama',observation};
      }
      return prices;
    } catch {
      return {};
    }
  }

  async function fetchCoinGeckoPrices(addresses: string[], chainId: number): Promise<Record<string, number>> {
    try {
      const res = await fetch('/api/coingecko/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId, addresses }),
        signal: AbortSignal.timeout(4500)
      });
      
      if (!res.ok) {
        console.warn('CoinGecko API error:', res.status);
        return {};
      }
      
      const data = await res.json();
      
      return data.prices || {};
    } catch (e) {
      console.warn('CoinGecko fetch failed:', e);
      return {};
    }
  }

  const aggregatorOutputAllowed = async (output: OutputToken) => publicClient!.readContract({address:config.swapper,abi:parseAbi(['function allowedOutToken(address) view returns(bool)']),functionName:'allowedOutToken',args:[outputAddress(output)]});

  const loadNative = async () => {
    const [engine, pins] = await Promise.all([import('@/lib/base-native-sweep'), import('@/lib/base-native-pins.json')]);
    return {engine, session:engine.createBaseNativeSweepSession(publicClient as unknown as BaseNativeClient, pins.default as BaseNativeConfig)};
  };
  const stockValueFor=(token:TokenInfo,amount=token.balance)=>address?stockDisplayValue(token.displayEstimate,{chainId,account:address,token:token.address,decimals:token.decimals,unitsVerified:token.unitsVerified,balance:token.balance,amount}):undefined;

  // Estimates are presentation data only: price/valueUsd/priceObservation and
  // every selection, consent and execution guard remain independent of them.
  const stockPriceKey = JSON.stringify(tokens.filter(t=>isDisplayStock(chainId,t.address)&&!inventoryHasDisplayPrice(t)).map(t=>[t.address,t.balance.toString(),t.decimals,t.unitsVerified]));
  useEffect(()=>{
    const update=()=>setStockPriceCycle(n=>n+1);
    document.addEventListener('visibilitychange',update);
    window.addEventListener('focus',update);
    return()=>{document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update);};
  },[]);
  useEffect(()=>{
    if(chainId!==8453||!address||!publicClient||isScanning||isProcessing||showQuotePreview||pending||showResultsModal||document.visibilityState!=='visible'||lastScannedKey!==`${address}-${chainId}`)return;
    const candidates=tokens.filter(t=>isDisplayStock(chainId,t.address)&&!inventoryHasDisplayPrice(t)&&t.unitsVerified&&t.balance>0n);
    if(!candidates.length)return;
    const captured=scope(),scanId=scanEpoch.current,account=address;
    let active=true,timer:ReturnType<typeof setTimeout>|undefined;
    const current=()=>active&&captured.key===contextRef.current.key&&captured.epoch===contextRef.current.epoch&&scanId===scanEpoch.current&&document.visibilityState==='visible';
    const previousJob=stockPriceJob.current;
    const job=(async()=>{
      // A cancelled read can finish in the background, but a new display job
      // never overlaps it or delays an action from the wallet controls.
      await previousJob?.catch(()=>{});
      if(!current())return;
      const missing=candidates.filter(t=>!stockDisplayValue(t.displayEstimate,{chainId,account,token:t.address,decimals:t.decimals,unitsVerified:t.unitsVerified,balance:t.balance}));
      if(!missing.length)return;
      const usdc='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address;
      const known=currentIndependentPrice(tokens.find(t=>sameAddress(t.address,usdc))?.priceObservation,chainId,usdc);
      const [native,prices]=await Promise.all([loadNative(),known?Promise.resolve(undefined):fetchMarketPrices([{address:usdc,decimals:6,balance:0n,symbol:'USDC'}],chainId,usdc)]);
      if(!current())return;
      await runStockDisplayEstimates({chainId,account,inputs:missing.map(t=>({token:t.address,decimals:t.decimals,unitsVerified:t.unitsVerified,balance:t.balance})),usdcPrice:known??prices?.[usdc]?.observation,
        quote:input=>native.session.quote({...input,slippageBps:SLIPPAGE_BPS}),shouldContinue:current,
        onEstimate:estimate=>{
          if(!current())return;
          setTokens(previous=>current()?previous.map(t=>t.address.toLowerCase()===estimate.token&&t.balance===estimate.balance&&t.decimals===estimate.decimals&&t.unitsVerified?{...t,displayEstimate:estimate}:t):previous);
        },
      });
    })();
    stockPriceJob.current=job;
    void job.catch(()=>{}).finally(()=>{
      if(stockPriceJob.current===job)stockPriceJob.current=null;
      if(current())timer=setTimeout(()=>{if(current())setStockPriceCycle(n=>n+1);},60_000);
    });
    return()=>{active=false;if(timer)clearTimeout(timer);};
  // The key excludes estimates, so publishing a result never restarts its job.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[stockPriceKey,stockPriceCycle,chainId,address,publicClient,isScanning,isProcessing,showQuotePreview,pending,showResultsModal,lastScannedKey]);

  async function quoteToken(token: TokenWithAmount, output: OutputToken, outPrice: number, native: () => ReturnType<typeof loadNative>, route: 'auto'|'native'|'0x' = 'auto'): Promise<SwapQuote> {
    const out = outputAddress(output);
    const decimals = output === 'USDC' ? config.usdcDecimals : 18;
    if (!token.unitsVerified) throw new Error('Token units unavailable.');
    const nativeQuote = async (): Promise<SwapQuote> => {
      const {session,engine}=await native();
      const q=await session.quote({account:address!,tokenIn:token.address,tokenOut:out,amountIn:token.amountToSwap,decimals:token.unitsVerified?token.decimals:null,slippageBps:SLIPPAGE_BPS});
      if(!q)throw new Error('This token is already the selected output.');
      return {token,buyAmount:q.netAmountOut,buyAmountFormatted:formatUnits(q.netAmountOut,decimals),transactionTo:engine.BASE_NATIVE.router,transactionData:'0x',priceImpact:Math.max(0,Number((q.marginalAmountOut-q.netAmountOut)*10000n/q.marginalAmountOut)/100),minimum:q.minimumNet,quotedAt:q.quotedAt,native:q};
    };
    // B20 contracts use native Base pools first. This is a routing hint only;
    // the same factory/runtime/liquidity/units checks authenticate every input.
    if(route==='auto'&&chainId===8453&&token.address.toLowerCase().startsWith('0xb200')){
      try{return await nativeQuote();}catch{/* Aggregator can still provide a better supported route. */}
    }
    let aggregatorError: unknown;
    if (route !== 'native') {
      try {
        const raw = await fetch0xQuote(chainId,token.address,out,token.amountToSwap,config.swapper);
        const bound=bind0xQuote(raw,{sellToken:token.address,buyToken:out,amount:token.amountToSwap,taker:config.swapper,target:config.allowanceHolder});
        let impact: number;
        const inputUsd=Number(formatUnits(token.amountToSwap,token.decimals))*token.price;
        const outputUsd=Number(formatUnits(bound.buyAmount,decimals))*outPrice;
        if (inputUsd>0 && outPrice>0) impact=Math.max(0,(1-outputUsd/inputUsd)*100);
        else {
          const referenceAmount=token.amountToSwap/100n;
          if (referenceAmount<=0n) throw new Error('Trade is too small to verify execution quality.');
          const referenceRaw=await fetch0xQuote(chainId,token.address,out,referenceAmount,config.swapper);
          const reference=bind0xQuote(referenceRaw,{sellToken:token.address,buyToken:out,amount:referenceAmount,taker:config.swapper,target:config.allowanceHolder});
          const marginal=reference.buyAmount*token.amountToSwap/referenceAmount;
          if(marginal<=0n) throw new Error('Price impact could not be verified.');
          impact=Math.max(0,Number((marginal-bound.buyAmount)*10000n/marginal)/100);
        }
        if(!Number.isFinite(impact))throw new Error('Execution quality could not be verified.');
        return {token,...bound,buyAmountFormatted:formatUnits(bound.buyAmount,decimals),priceImpact:impact,minimum:bound.minimum,quotedAt:Date.now()};
      } catch (e) { aggregatorError=e; if (route==='0x') throw e; }
    }
    if(chainId!==8453) throw aggregatorError ?? new Error('No executable route found.');
    return nativeQuote();
  }

  const quoteValueQuality = (token: TokenWithAmount, quote: SwapQuote, output: OutputToken, outputDecimals: number, outputPrice: IndependentPrice | undefined, reviewedMinimum = quote.minimum) => assessQuoteValue({
    context: `${address?.toLowerCase()}:${token.amountToSwap}:${reviewedMinimum}`,
    chainId, tokenIn: token.address, tokenOut: outputAddress(output),
    inputUnits: Number(formatUnits(token.amountToSwap, token.decimals)),
    outputUnits: Number(formatUnits(quote.buyAmount, outputDecimals)),
    minimumOutputUnits: Number(formatUnits(reviewedMinimum, outputDecimals)),
    inputPrice: token.priceObservation, outputPrice, routeCostPercent: quote.priceImpact,
  });

  const fetchQuotesAndShowPreview = useCallback(async () => {
    if (!address || !publicClient || !supportedChain || isProcessing || sendLock.current || pending || journalError) return;
    const captured=scope();
    setIsProcessing(true); setError(null); setSwapResults(null);
    try {
      if(localStorage.getItem(pendingKey(address,chainId)))throw new Error('Check the previous wallet request before quoting again.');
      const selected=tokens.filter(t=>selectedTokens.has(t.address)&&!sameAddress(t.address,outputAddress(outputToken)));
      if(!selected.length) throw new Error('Select tokens to sweep.');
      let tokensToSwap=selected.map(t=>({...t,amountToSwap:exactAmount(customAmounts[t.address],t.balance,t.decimals,t.unitsVerified)}));
      const outputDecimals=outputToken==='USDC'?config.usdcDecimals:18;
      // Reuse current scan observations. Only missing/stale valuations are fetched
      // in the existing bounded bulk reader when the user explicitly reviews.
      const out=outputAddress(outputToken);
      let outputPriceObservation=currentIndependentPrice(tokens.find(t=>sameAddress(t.address,out))?.priceObservation,chainId,out);
      const needsPrices=tokensToSwap.filter(t=>!currentIndependentPrice(t.priceObservation,chainId,t.address));
      const priceInputs=needsPrices.map(t=>({address:t.address,decimals:t.decimals,balance:t.balance,symbol:t.symbol}));
      if(!outputPriceObservation)priceInputs.push({address:out,decimals:outputDecimals,balance:0n,symbol:outputToken});
      const prices=priceInputs.length?await fetchMarketPrices(priceInputs,chainId,out):{};
      tokensToSwap=tokensToSwap.map(t=>{
        const observation=currentIndependentPrice(t.priceObservation,chainId,t.address)??prices[t.address.toLowerCase()]?.observation;
        return {...t,priceObservation:observation,...(observation?{price:observation.price,priceSource:observation.source}:{})};
      });
      outputPriceObservation??=prices[out.toLowerCase()]?.observation;
      checkScope(captured);
      // A hardcoded stablecoin peg is not an independent USD observation.
      const outputPrice=outputPriceObservation?.price??0;
      const allowAggregator=await aggregatorOutputAllowed(outputToken);
      checkScope(captured);
      let nativePromise:ReturnType<typeof loadNative>|undefined;
      const native=()=>nativePromise??=(loadNative());
      let complete=0;
      const results=await mapBounded(tokensToSwap,4,async token=>{
        try {
          checkScope(captured);
          if(!allowAggregator&&chainId!==8453)throw new Error('This output is not enabled on this network.');
          const quote=await quoteToken(token,outputToken,outputPrice,native,allowAggregator?'auto':'native');
          checkScope(captured);
          const quality=quoteValueQuality(token,quote,outputToken,outputDecimals,outputPriceObservation);
          const inputValueUsd=quality.inputUsd??0,quotedOutputUsd=quality.outputUsd??0;
          let estimate=stockValueFor(token,token.amountToSwap);
          if(quality.inputUsd===null&&quote.native&&outputToken==='USDC'){
            // Reuse this already-verified exact-amount quote for presentation;
            // this callback issues no additional quote or provider request.
            const display=await runStockDisplayEstimates({chainId,account:address,inputs:[{token:token.address,decimals:token.decimals,unitsVerified:token.unitsVerified,balance:token.amountToSwap}],usdcPrice:outputPriceObservation,quote:async()=>quote.native});
            estimate=stockDisplayValue(display[token.address.toLowerCase()],{chainId,account:address,token:token.address,decimals:token.decimals,unitsVerified:token.unitsVerified,balance:token.amountToSwap});
          }
          return {ok:true as const,value:{token,inputValueUsd,quotedOutputUsd,lossPercent:quality.independentLossPercent??quote.priceImpact,lossUsd:Math.max(0,inputValueUsd-quotedOutputUsd),quote,quality,selected:quality.defaultSelected,estimatedInputValueUsd:estimate?.valueUsd??undefined,estimatedInputUsdc:estimate?formatUnits(estimate.usdcUnits,6):undefined}};
        } catch(e:any) { return {ok:false as const,value:{token,error:e?.message||'No executable route found.'}}; }
        finally { if(captured.key===contextRef.current.key&&captured.epoch===contextRef.current.epoch) setProgressStep(`Quoting ${++complete} of ${tokensToSwap.length} tokens…`); }
      });
      checkScope(captured);
      setQuotePreviewData({quotes:results.flatMap(r=>r.ok?[r.value]:[]),failedQuotes:results.flatMap(r=>!r.ok?[r.value]:[]),outputToken,outputPrice,outputPriceObservation,outputDecimals,account:address,chainId});
      setShowQuotePreview(true);
    } catch(e:any) { if(captured.key===contextRef.current.key&&captured.epoch===contextRef.current.epoch)setError(e?.message||'Could not quote these tokens.'); }
    finally { if(captured.key===contextRef.current.key&&captured.epoch===contextRef.current.epoch){setIsProcessing(false);setProgressStep('');} }
  },[address,publicClient,supportedChain,isProcessing,pending,journalError,tokens,selectedTokens,customAmounts,outputToken,chainId,config]);

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

  const toggleValueRiskConsent = useCallback((tokenAddress: string) => {
    if (!quotePreviewData) return;
    
    setQuotePreviewData((prev: QuotePreviewData | null) => {
      if (!prev) return prev;
      return {
        ...prev,
        quotes: prev.quotes.map((q: QuotePreviewItem) => 
          q.token.address === tokenAddress 
            ? { ...q, riskConsent: q.riskConsent ? undefined : acceptValueRisk(q.quality) }
            : q
        )
      };
    });
  }, [quotePreviewData]);

  const savePending = (record: PendingSweep | null, account: Address, network: number) => {
    const key=pendingKey(account,network);
    // A durable pre-submit marker is required. Storage errors hold execution.
    if(record) localStorage.setItem(key,JSON.stringify(record)); else localStorage.removeItem(key);
    if(contextRef.current.key===`${network}:${account.toLowerCase()}`)setPending(record);
  };
  const reconcilePending = async () => {
    if(sendLock.current||isProcessing||!pending||!publicClient||!address||chainId!==pending.chainId||!sameAddress(address,pending.account))return;
    const captured=scope();
    sendLock.current=true;setIsReconciling(true);
    try {
      const journalKey=pendingKey(address,chainId);
      let journalSnapshot:string|null=JSON.stringify(pending);
      const requireCurrentJournal=()=>{
        checkScope(captured);
        if(localStorage.getItem(journalKey)!==journalSnapshot)throw new Error('The saved wallet request changed. Refresh before checking it again.');
      };
      const saveReconciled=(value:PendingSweep|null)=>{
        requireCurrentJournal();savePending(value,address,chainId);
        journalSnapshot=value?JSON.stringify(value):null;
      };
      requireCurrentJournal();
      const hash=/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)?recoveryHash as Hex:pending.hash;
      if(!hash)throw new Error('Paste the transaction hash from your wallet to check it.');
      const transaction=await publicClient.getTransaction({hash});
      let record=pending;
      let approvalProof:ReturnType<typeof bindSubmittedWalletRequest>['approvalProof'];
      const anchor=record.originalHash??record.hash;
      const isOriginal=!!anchor&&sameAddress(hash,anchor);
      // A legacy pre-read nonce is only a baseline. Rebind it using the
      // immutable hash already returned by the wallet and exact original intent.
      // Old replacement journals already proved their original nonce before
      // recording originalHash; hashless recovery retains its strict nonce gate.
      if(isOriginal){
        const bound=bindSubmittedWalletRequest(record,transaction,anchor);
        record=bound;approvalProof=bound.approvalProof;saveReconciled(record);
      }else if(record.hash && !record.nonceVerified && !record.originalHash){
        const original=sameAddress(hash,record.hash)?transaction:await publicClient.getTransaction({hash:record.hash});
        const bound=bindSubmittedWalletRequest(record,original);
        record=bound;approvalProof=bound.approvalProof;saveReconciled(record);
      }
      if(!sameAddress(transaction.hash,hash)||transaction.chainId!==undefined&&transaction.chainId!==chainId)throw new Error('The transaction lookup does not match the saved hash or network.');
      const kind=isOriginal?'intent':pendingTransactionKind(record,transaction);
      const receipt=await publicClient.getTransactionReceipt({hash});
      if(!record.createdBlock||receipt.blockNumber<BigInt(record.createdBlock)||receipt.transactionHash.toLowerCase()!==hash.toLowerCase()||(await publicClient.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw new Error('Transaction confirmation is not canonical yet.');
      if(kind==='intent'&&receipt.status==='success'&&approvalProof){
        const required=BigInt(approvalProof.reviewedAmount);
        const available=await publicClient.readContract({address:record.target,abi:ERC20_ABI,functionName:'allowance',args:[address,approvalProof.spender],blockNumber:receipt.blockNumber});
        if(required===0n?available!==0n:available<required)throw new Error('The confirmed approval did not set the required allowance. Check this request before retrying.');
      }
      checkScope(captured);
      saveReconciled(null);
      setError(kind==='replacement'?'The saved transaction was replaced or cancelled. Balances have been refreshed; review any remaining tokens.':receipt.status==='success'?'Transaction confirmed. Balances have been refreshed; review a new quote for any remaining tokens.':'Transaction reverted. No swap from this transaction was completed.');
      setRecoveryHash(''); setQuotePreviewData(null); setShowQuotePreview(false);
      await scanWalletTokens(true);
    } catch(e:any) { if(captured.key===contextRef.current.key&&captured.epoch===contextRef.current.epoch)setError(e?.name==='TransactionReceiptNotFoundError'?'Transaction is still pending. Check again before sending another transaction.':e?.message||'Could not confirm this transaction.'); }
    finally {sendLock.current=false;setIsReconciling(false);}
  };

  const executeConfirmedSwaps = useCallback(async () => {
    if(!address||!publicClient||!walletClient||!quotePreviewData||sendLock.current||pending||journalError)return;
    const captured=scope(),account=address,network=chainId,preview=quotePreviewData;
    if(!sameAddress(preview.account,account)||preview.chainId!==network){setError('Wallet or network changed. Review a new quote.');return;}
    const chosen=preview.quotes.filter(q=>q.selected&&quoteValueExecutable(q.quality,q.riskConsent));
    if(!chosen.length){setError('Select a token with an executable quote.');return;}
    sendLock.current=true;setIsProcessing(true);setShowQuotePreview(false);setError(null);setSwapResults(null);setDetailedResults([]);
    const results:SwapResultDetail[]=[];
    let received=0, success=0,totalRaw=0n;
    let stopReason:string|undefined;
    let awaitingSwap:QuotePreviewItem[]=[];
    const failureText=(e:any)=>{
      if(isWalletRejection(e))return 'Wallet request cancelled.';
      const parts=[String(e?.shortMessage||e?.message||'Could not prepare this sweep.')];
      for(let cause=e,depth=0;cause&&depth<5;cause=cause.cause,depth++){
        for(const value of [cause.reason,cause.details])if(typeof value==='string'&&value&&!parts.includes(value))parts.push(value);
      }
      return parts.join(' ').replace(/https?:\/\/\S+/g,'[read service]').slice(0,400);
    };
    const isOperationBlocker=(e:any)=>!!e?.stopQueue||isProvenNotSubmitted(e)||/rate.?limit|429|timeout|timed out|HTTP request failed|failed to fetch|temporarily unavailable|runtime changed|missing a reviewed runtime pin|Native registry changed|Native factory registry is invalid/i.test(failureText(e));
    const assertWallet=async()=>{
      checkScope(captured);
      const [accounts,currentChain]=await Promise.all([walletClient.getAddresses(),walletClient.getChainId()]);
      checkScope(captured);
      if(currentChain!==network||!accounts.some(a=>sameAddress(a,account)))throw Object.assign(new Error('Wallet or network changed. Review again.'),{stopQueue:true});
      const raw=localStorage.getItem(pendingKey(account,network));
      if(raw)throw Object.assign(new Error('A previous wallet request needs to be checked before continuing.'),{stopQueue:true});
    };
    const send=async(request:any,label:string)=>{
      await assertWallet();
      const data=encodeFunctionData(request);
      const [nonce,createdBlock]=await Promise.all([publicClient.getTransactionCount({address:account,blockTag:'pending'}),publicClient.getBlockNumber()]);
      await assertWallet();
      let record:PendingSweep={version:1,account,chainId:network,target:request.address,data,value:'0',nonce,createdBlock:createdBlock.toString(),createdAt:Date.now(),label};
      savePending(record,account,network);
      let hash:Hex;
      try {
        hash=await writeContractAsync({...request,account,chainId:network,value:0n,nonce});
      }catch(e){
        if(isProvenNotSubmitted(e))savePending(null,account,network);
        throw e;
      }
      if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Object.assign(new Error('Your wallet did not return a transaction hash. Check its activity before retrying.'),{stopQueue:true});
      // Keep the original scope's journal even if the wallet changes while prompting.
      record={...record,hash};savePending(record,account,network);
      if(contextRef.current.key===captured.key&&contextRef.current.epoch===captured.epoch)setTxHash(hash);
      // Capture the accepted nonce as soon as the transaction is visible.
      let visible:Awaited<ReturnType<typeof publicClient.getTransaction>>|undefined;
      try{visible=await publicClient.getTransaction({hash});}catch{/* Keep the hash held while the node catches up. */}
      if(visible){record=bindSubmittedWalletRequest(record,visible,hash);savePending(record,account,network);}
      const receipt=await publicClient.waitForTransactionReceipt({hash,timeout:90_000,onReplaced:replacement=>{
        try{
          const original=bindSubmittedWalletRequest(record,replacement.replacedTransaction,hash);
          pendingTransactionKind(original,replacement.transaction);
          if(!/^0x[0-9a-fA-F]{64}$/.test(replacement.transaction.hash))return;
          record={...original,originalHash:hash,hash:replacement.transaction.hash};
          savePending(record,account,network);
        }catch{/* A replacement without original hash/intent proof stays held. */}
      }});
      const transaction=await publicClient.getTransaction({hash:receipt.transactionHash});
      if(!sameAddress(transaction.hash,receipt.transactionHash)||transaction.chainId!==undefined&&transaction.chainId!==network)throw new Error('Transaction confirmation does not match its hash or network.');
      if(sameAddress(receipt.transactionHash,hash)){
        record=bindSubmittedWalletRequest(record,transaction,hash);savePending(record,account,network);
      }
      const kind=sameAddress(receipt.transactionHash,hash)?'intent':pendingTransactionKind(record,transaction);
      if(receipt.blockNumber<BigInt(record.createdBlock!)||(await publicClient.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw new Error('Transaction confirmation changed. Check again.');
      if(kind==='intent'&&receipt.status==='success'&&request.functionName==='approve'){
        const spender=request.args[0] as Address,required=BigInt(request.args[1]);
        const available=await publicClient.readContract({address:request.address,abi:ERC20_ABI,functionName:'allowance',args:[account,spender],blockNumber:receipt.blockNumber});
        if(required===0n?available!==0n:available<required)throw Object.assign(new Error('The confirmed approval did not set the required allowance. Check this request before retrying.'),{stopQueue:true});
      }
      // Confirmation removes the pending gate; no timeout or RPC error does.
      savePending(null,account,network);
      if(kind==='replacement')throw new Error('The wallet transaction was replaced or cancelled. Re-scan and review before continuing.');
      if(receipt.status!=='success')throw Object.assign(new Error(`${label} reverted. Review the token before retrying.`),{confirmedRevert:true});
      checkScope(captured);
      return receipt;
    };
    const result=(q:QuotePreviewItem,status:'success'|'failed'|'skipped'|'pending',message?:string,actual?:bigint):SwapResultDetail=>({symbol:q.token.symbol,tokenIn:q.token.address,amountIn:q.token.amountToSwap,decimalsIn:q.token.decimals,inputValueUsd:q.inputValueUsd,quotedOutputUsd:q.quotedOutputUsd,estimatedInputValueUsd:q.estimatedInputValueUsd,estimatedInputUsdc:q.estimatedInputUsdc,actualOutputUsd:actual===undefined?undefined:Number(formatUnits(actual,preview.outputDecimals))*preview.outputPrice,executionSlippage:0,totalCostPercent:q.lossPercent,independentValuationAvailable:q.quality.independentLossPercent!==null,status,error:message});
    try {
      await assertWallet();
      const output=outputAddress(preview.outputToken);
      const readExecutionPrices=createExecutionPriceReader({chainId:network,read:inputs=>fetchMarketPrices(inputs.map(input=>({...input,address:input.address as Address})),network,output)});
      const executionValuations=async(rows:readonly QuotePreviewItem[])=>{
        const observations=await readExecutionPrices([
          ...rows.map(q=>q.token),
          {address:output,decimals:preview.outputDecimals,balance:0n,symbol:preview.outputToken,priceObservation:preview.outputPriceObservation},
        ]);
        checkScope(captured);
        return {
          outputPrice:observations.get(output.toLowerCase()),
          token:(q:QuotePreviewItem)=>{
            const observation=observations.get(q.token.address.toLowerCase());
            return {...q.token,priceObservation:observation,price:observation?.price??0,priceSource:observation?.source??'unknown' as const};
          },
        };
      };
      const swapperCode=await publicClient.getCode({address:config.swapper});
      if(chosen.some(q=>!q.quote.native)&&!swapperCode?.includes('810fdc5a'))throw new Error('The required output protection is unavailable on this network.');
      // Route-homogeneous batches preserve exact input caps and independent output floors.
      const nativeRows=chosen.filter(q=>!!q.quote.native),aggregatorRows=chosen.filter(q=>!q.quote.native);
      if(aggregatorRows.length && !await aggregatorOutputAllowed(preview.outputToken))throw new Error('This output is no longer enabled. Review new routes.');
      const groups=[...Array.from({length:Math.ceil(nativeRows.length/10)},(_,i)=>nativeRows.slice(i*10,i*10+10)),...Array.from({length:Math.ceil(aggregatorRows.length/10)},(_,i)=>aggregatorRows.slice(i*10,i*10+10))];
      for(let groupIndex=0;groupIndex<groups.length;groupIndex++){
        const original=groups[groupIndex];
        let submitting=false,swapConfirmed=false;
        const groupSend=async(request:any,label:string)=>{submitting=true;const receipt=await send(request,label);submitting=false;return receipt;};
        try {
        setProgressStep(`Preparing batch ${groupIndex+1} of ${groups.length}…`);
        await assertWallet();
        let nativePromise:ReturnType<typeof loadNative>|undefined;
        const native=()=>nativePromise??=loadNative();
        const refresh=async()=>{
          const candidates=original.filter(q=>!results.some(r=>sameAddress(r.tokenIn,q.token.address)));
          const valuations=await executionValuations(candidates);
          const values=await mapBounded(candidates,4,async(q):Promise<QuotePreviewItem|null>=>{
            checkScope(captured);
            try{
              const token=valuations.token(q);
              const fresh=await quoteToken(token,preview.outputToken,valuations.outputPrice?.price??0,native,q.quote.native?'native':'0x');
              checkScope(captured);
              // Preserve the approved absolute floor, not a newly shifted slippage band.
              preserveMinimum(q.quote.minimum,fresh.buyAmount);
              const quality=quoteValueQuality(token,fresh,preview.outputToken,preview.outputDecimals,valuations.outputPrice,q.quote.minimum);
              assertRefreshedQuoteValue(q.quality,quality,q.riskConsent);
              // Keep the ORIGINAL assessment and consent as the review anchor.
              // Renewed evidence must never replace its accepted risk ceiling.
              return {...q,token,quote:{...fresh,minimum:q.quote.minimum},inputValueUsd:quality.inputUsd??0,quotedOutputUsd:quality.outputUsd??0,lossPercent:quality.independentLossPercent??fresh.priceImpact};
            }catch(e){
              checkScope(captured);
              if(isOperationBlocker(e))throw e;
              const reason=`${q.token.symbol}: ${failureText(e)}`;
              if(!results.some(r=>sameAddress(r.tokenIn,q.token.address)))results.push(result(q,'skipped',reason));
              return null;
            }
          });
          return values.filter((q):q is QuotePreviewItem=>q!==null);
        };
        let rows=await refresh();
        if(!rows.length)continue;
        await assertWallet();
        let engine:Awaited<ReturnType<typeof loadNative>>['engine']|undefined;
        if(rows[0].quote.native){
          engine=(await native()).engine;
          const batch=engine.buildBaseNativeBatch(rows.map(q=>q.quote.native!),{account,deadline:BigInt(Math.floor(Date.now()/1000)+240),minimums:rows.map(q=>q.quote.minimum)});
          await engine.simulateBaseNativeBatch(publicClient as unknown as BaseNativeClient,batch,{account,withApprovals:true});
        }
        let approved=false;
        for(const q of rows){
          await assertWallet();
          const spender=q.quote.native?engine!.BASE_NATIVE.router:config.swapper;
          const [balance,allowance]=await Promise.all([
            publicClient.readContract({address:q.token.address,abi:ERC20_ABI,functionName:'balanceOf',args:[account]}),
            publicClient.readContract({address:q.token.address,abi:ERC20_ABI,functionName:'allowance',args:[account,spender]})
          ]);
          if(balance<q.token.amountToSwap)throw new Error(`${q.token.symbol}: balance changed. Re-scan and review.`);
          if(allowance<q.token.amountToSwap){
            setProgressStep(`Approve ${q.token.symbol} in your wallet…`);
            // Some ERC20s require zero before changing a nonzero allowance.
            if(allowance>0n)await groupSend({address:q.token.address,abi:ERC20_ABI,functionName:'approve',args:[spender,0n]},`Reset ${q.token.symbol} approval`);
            await groupSend({address:q.token.address,abi:ERC20_ABI,functionName:'approve',args:[spender,q.token.amountToSwap]},`Approve ${q.token.symbol}`);
            approved=true;
          }
        }
        if(approved||rows.some(q=>Date.now()-q.quote.quotedAt>30_000)){
          nativePromise=undefined;rows=await refresh();
          if(!rows.length)continue;
        }
        await assertWallet();
        if(rows.some(q=>Date.now()-q.quote.quotedAt>QUOTE_TTL_MS))throw new Error('Quotes expired. Review fresh quotes.');
        let request:any,batch:any;
        if(engine){
          batch=engine.buildBaseNativeBatch(rows.map(q=>q.quote.native!),{account,deadline:BigInt(Math.floor(Date.now()/1000)+240),minimums:rows.map(q=>q.quote.minimum)});
          await engine.simulateBaseNativeBatch(publicClient as unknown as BaseNativeClient,batch,{account,withApprovals:false});
          request={address:batch.address,abi:batch.abi,functionName:batch.functionName,args:batch.args};
        }else{
          const plan:SwapStep[]=rows.map(q=>({kind:RouterKind.AGGREGATOR,tokenIn:q.token.address,outToken:output,useAll:false,amountIn:q.token.amountToSwap,quotedIn:q.token.amountToSwap,quotedOut:q.quote.minimum,slippageBps:0,data:encodeAbiParameters([{type:'address'},{type:'bytes'}],[q.quote.transactionTo,q.quote.transactionData]),viaPermit2:false,permitSig:'0x',permitAmount:0n,permitDeadline:0n,permitNonce:0n}));
          request={address:config.swapper,abi:SWAPPER_ABI,functionName:'executePlanFromCallerAdvanced',args:[plan,account,{minTotalOut:rows.reduce((n,q)=>n+q.quote.minimum,0n),allowPartial:false}]};
          const simulation=await publicClient.simulateContract({...request,account});
          if(BigInt(simulation.result as bigint)<rows.reduce((n,q)=>n+q.quote.minimum,0n))throw new Error('The simulated output is below the reviewed minimum.');
        }
        await assertWallet();
        const estimated=await publicClient.estimateContractGas({...request,account});
        const gas=estimated*120n/100n;
        if(network===8453&&gas>16_000_000n)throw new Error('This batch is too large. Select fewer tokens and review again.');
        request.gas=gas;
        if(engine)await engine.recheckBaseNativeBatch(publicClient as unknown as BaseNativeClient,batch,account);
        const finalValuations=await executionValuations(rows);
        for(const q of rows)assertRefreshedQuoteValue(q.quality,quoteValueQuality(finalValuations.token(q),q.quote,preview.outputToken,preview.outputDecimals,finalValuations.outputPrice,q.quote.minimum),q.riskConsent);
        if(rows.some(q=>Date.now()-q.quote.quotedAt>QUOTE_TTL_MS))throw new Error('Quotes expired. Review fresh quotes.');
        setProgressStep(`Confirm batch ${groupIndex+1} of ${groups.length} in your wallet…`);
        awaitingSwap=rows;
        const receipt=await groupSend(request,`Sweep batch ${groupIndex+1}`);
        swapConfirmed=true;awaitingSwap=[];
        // From here the batch has executed. A receipt parsing error never replays it.
        success+=rows.length;
        rows.forEach(q=>results.push(result(q,'success')));
        totalRaw+=walletReceiptOutput(receipt.logs,output,account);
        received=Number(formatUnits(totalRaw,preview.outputDecimals))*preview.outputPrice;
        if(engine){
          const actual=engine.baseNativeReceipt(receipt.logs,batch);
          rows.forEach((q,i)=>{const idx=results.findIndex(r=>sameAddress(r.tokenIn,q.token.address));results[idx]=result(q,'success',undefined,actual.rows[i].netOutput);});
        }
        }catch(e){
          checkScope(captured);
          if(submitting||swapConfirmed)throw e;
          const reason=failureText(e);
          if(isOperationBlocker(e))throw e;
          const remaining=original.filter(q=>!results.some(r=>sameAddress(r.tokenIn,q.token.address)));
          if(remaining.length>1){
            const middle=Math.ceil(remaining.length/2);
            groups.splice(groupIndex+1,0,remaining.slice(0,middle),remaining.slice(middle));
          }else for(const q of remaining)results.push(result(q,'skipped',`${q.token.symbol}: ${reason}`));
        }
      }
    }catch(e:any){
      if(e?.confirmedRevert&&awaitingSwap.length){for(const q of awaitingSwap)results.push(result(q,'failed',failureText(e)));awaitingSwap=[];}
      stopReason=failureText(e);
      if(contextRef.current.key===captured.key&&contextRef.current.epoch===captured.epoch)setError(stopReason);
    }finally{
      let pendingRecord:PendingSweep|null=null;
      try{const raw=localStorage.getItem(pendingKey(account,network));if(raw)pendingRecord=validatePending(JSON.parse(raw),account,network);}catch{/* Existing journal gate remains held. */}
      for(const q of chosen)if(!results.some(r=>sameAddress(r.tokenIn,q.token.address))){
        const unresolved=!!pendingRecord&&awaitingSwap.some(row=>sameAddress(row.token.address,q.token.address));
        results.push(result(q,unresolved?'pending':'skipped',unresolved?'Awaiting transaction confirmation. Check this request before any retry.':stopReason||'No transaction was sent for this token.'));
      }
      const skippedCount=results.filter(r=>r.status==='skipped').length;
      const pendingCount=results.filter(r=>r.status==='pending').length;
      const problem=stopReason||((skippedCount||pendingCount)?results.find(r=>r.error)?.error:undefined);
      if(contextRef.current.key===captured.key&&contextRef.current.epoch===captured.epoch){
        setDetailedResults(results);setSwapResults({success,failed:results.filter(r=>r.status==='failed').length,skipped:skippedCount,pending:pendingCount,problem,walletRequest:pendingRecord?{label:pendingRecord.label,hash:pendingRecord.hash}:undefined,totalValue:received,totalOutput:formatUnits(totalRaw,preview.outputDecimals),outputToken:preview.outputToken,valuationAvailable:preview.outputPrice>0});setShowResultsModal(true);setIsProcessing(false);setProgressStep('');setQuotePreviewData(null);
      }
      sendLock.current=false;
      if(contextRef.current.key===captured.key&&contextRef.current.epoch===captured.epoch&&success>0&&!localStorage.getItem(pendingKey(account,network)))void scanWalletTokens(true);
    }
  },[address,publicClient,walletClient,quotePreviewData,pending,journalError,chainId,config,writeContractAsync,scanWalletTokens]);

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
      taker,
      slippageBps:String(SLIPPAGE_BPS),
      ...(address ? {txOrigin:address} : {})
    });
    
    const res = await fetch(`/api/0x/quote?${params}`, {signal:AbortSignal.timeout(10_000)});
    if (!res.ok) {
      const err = await res.json();
      const errorMsg = err.error || err.reason || err.message || 'Quote failed';

      throw new Error(errorMsg);
    }
    
    return res.json();
  }

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  const displayTokens = useMemo(() => {
    const outputTokenAddr = outputAddress(outputToken);
    return tokens.filter((t: TokenInfo) => t.address.toLowerCase() !== outputTokenAddr.toLowerCase());
  }, [tokens, outputToken, config]);

  const knownPriceTokens = useMemo(() => displayTokens.filter(inventoryHasDisplayPrice), [displayTokens]);
  const inventory = useMemo(() => sweepInventory(displayTokens,{chainId,query:inventoryQuery,limit:visibleCount}), [displayTokens,chainId,inventoryQuery,visibleCount]);
  const selectedDisplay = useMemo(() => {
    let value=0,estimated=false;
    for(const token of displayTokens.filter(t=>selectedTokens.has(t.address))){
      try{
        const amount=exactAmount(customAmounts[token.address],token.balance,token.decimals,token.unitsVerified);
        if(inventoryHasDisplayPrice(token))value+=Number(formatUnits(amount,token.decimals))*token.price;
        else{
          const display=stockValueFor(token,amount);
          if(display?.valueUsd===undefined||display.valueUsd===null)return {value:null,estimated:true};
          value+=display.valueUsd;estimated=true;
        }
      }catch{return {value:null,estimated:true};}
    }
    return {value:Number.isFinite(value)?value:null,estimated};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[displayTokens,selectedTokens,customAmounts,chainId,address,stockPriceCycle]);

  const selectedCount = useMemo(() => {
    const outputTokenAddr = outputAddress(outputToken);
    return [...selectedTokens].filter(addr => addr.toLowerCase() !== outputTokenAddr.toLowerCase()).length;
  }, [selectedTokens, outputToken, config]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="sweeper-shell min-h-screen">
      
      {/* Quote Preview Modal */}
      {showQuotePreview && quotePreviewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl"
          >
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
              
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Input value</p>
                  <p className={`text-lg font-bold ${quotePreviewData.quotes.some(q=>q.selected&&q.quality.inputUsd===null)?'text-amber-300':'text-white'}`}>
                    {(()=>{const rows=quotePreviewData.quotes.filter(q=>q.selected),values=rows.map(q=>q.quality.inputUsd??q.estimatedInputValueUsd);return values.some(v=>v===undefined)?'Unavailable':`${rows.some(q=>q.quality.inputUsd===null)?'Est. ':''}${formatUSD(values.reduce<number>((sum,v)=>sum+(v??0),0))}`;})()}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">You'll Receive</p>
                  <p className="text-lg font-bold text-white">
                    {quotePreviewData.quotes.some(q=>q.selected&&q.quality.outputUsd===null)?'USD unavailable':formatUSD(quotePreviewData.quotes.filter(q=>q.selected).reduce((sum,q)=>sum+q.quotedOutputUsd,0))}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Independent Value Loss</p>
                  {(() => {
                    const selectedQuotes = quotePreviewData.quotes.filter((q: QuotePreviewItem) => q.selected);
                    const totalInput = selectedQuotes.reduce((sum: number, q: QuotePreviewItem) => sum + q.inputValueUsd, 0);
                    if(!selectedQuotes.length||selectedQuotes.some(q=>q.quality.independentLossPercent===null)||totalInput<=0)return <p className="text-lg font-bold text-amber-300">Unavailable</p>;
                    const weightedImpact = Math.max(0,(1-selectedQuotes.reduce((sum,q)=>sum+q.quotedOutputUsd,0)/totalInput)*100);
                    const fair=selectedQuotes.every(q=>q.quality.defaultSelected);
                    return (
                      <p className={`text-lg font-bold ${fair?'text-emerald-400':'text-red-400'}`}>
                        {weightedImpact > 0.01 ? `-${weightedImpact.toFixed(2)}%` : '~0%'}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>
            
            <div className="overflow-y-auto max-h-[400px] p-4">
              <table className="w-full">
                <thead className="text-xs text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="text-left pb-3 pl-2">Include</th>
                    <th className="text-left pb-3">Token</th>
                    <th className="text-right pb-3">Input Value</th>
                    <th className="text-right pb-3">You Receive</th>
                    <th className="text-right pb-3 pr-2">Cost / Value Review</th>
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
                          aria-label={`Include ${quoteData.token.symbol} in sweep`}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {(quoteData.quality.independentLossPercent!==null&&quoteData.quality.independentLossPercent>5)||quoteData.quote.priceImpact>5 ? (
                            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          ) : !quoteData.quality.defaultSelected ? (
                            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          )}
                          <div><span className="font-medium text-white">{quoteData.token.symbol}</span><p className="text-xs text-slate-400">{formatUnits(quoteData.token.amountToSwap,quoteData.token.decimals)} · {quoteData.quote.native?'Aerodrome':'0x'}</p></div>
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        <span className={quoteData.quality.inputUsd===null?'text-amber-300':'text-slate-300'}>{quoteData.inputValueUsd>0?formatUSD(quoteData.inputValueUsd):quoteData.estimatedInputValueUsd!==undefined?`Est. ${formatUSD(quoteData.estimatedInputValueUsd)}`:quoteData.estimatedInputUsdc?`Est. ${formatNumber(Number(quoteData.estimatedInputUsdc),4)} USDC`:'—'}</span>
                        {quoteData.quality.inputUsd===null&&(quoteData.estimatedInputValueUsd!==undefined||quoteData.estimatedInputUsdc)&&<p className="text-[10px] text-amber-400/80">Pool estimate</p>}
                      </td>
                      <td className="py-3 text-right">
                        <span className={`${quoteData.quality.defaultSelected?'text-emerald-400':'text-slate-200'} font-medium`}>{formatNumber(Number(quoteData.quote.buyAmountFormatted),6)} {quotePreviewData.outputToken}</span><p className="text-xs text-slate-400">Minimum share {formatUnits(quoteData.quote.minimum,quotePreviewData.outputDecimals)}</p>
                      </td>
                      <td className="py-3 text-right pr-2">
                        <div className="text-xs text-slate-300">{quoteData.quote.native?'Pool cost':'Quote cost'}: {quoteData.quote.priceImpact.toFixed(2)}%</div>
                        <div className={`text-sm font-medium ${quoteData.quality.independentLossPercent===null?'text-amber-300':quoteData.quality.independentLossPercent>5?'text-red-400':quoteData.quality.defaultSelected?'text-emerald-400':'text-amber-300'}`}>
                          {quoteData.quality.independentLossPercent===null?'Independent value unavailable':`Independent loss: ${quoteData.quality.independentLossPercent.toFixed(2)}%`}
                        </div>
                        {quoteData.quote.priceImpact>5 ? <p className="text-xs text-red-400">Route cost exceeds the 5% limit. Held.</p> : (
                          !quoteData.quality.defaultSelected && quoteData.selected && (
                            <button
                              onClick={() => toggleValueRiskConsent(quoteData.token.address)}
                              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                quoteData.riskConsent
                                  ? 'bg-orange-500/30 text-orange-300 border border-orange-500/50'
                                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-300'
                              }`}
                              aria-pressed={!!quoteData.riskConsent}
                            >
                              {quoteData.riskConsent?'Accepted: ': 'Accept: '}{quoteData.quality.independentLossPercent===null?'trade without independent valuation':`up to ${(Math.ceil(quoteData.quality.maximumLossAtMinimumPercent!*100)/100).toFixed(2)}% independent value loss`}
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                  
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
            
            {quotePreviewData.quotes.some(q=>q.selected&&!q.quality.defaultSelected) && (
              <div className="mx-4 mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-center gap-2 text-amber-300">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    Selected tokens with high independent loss or unavailable valuation require their own explicit acceptance. Route cost above 5% stays held.
                  </span>
                </div>
              </div>
            )}
            
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
                disabled={!quotePreviewData.quotes.some(q=>q.selected&&quoteValueExecutable(q.quality,q.riskConsent))}
                className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200"
              >
                {(() => {
                  const executable = quotePreviewData.quotes.filter(q=>q.selected&&quoteValueExecutable(q.quality,q.riskConsent)).length;
                  const skipped = quotePreviewData.quotes.filter(q=>q.selected&&!quoteValueExecutable(q.quality,q.riskConsent)).length;
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
            className="flex flex-col bg-slate-800 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl"
          >
            <div className="p-6 shrink-0 border-b border-slate-700 bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                    {swapResults?.success&&!swapResults?.pending?<CheckCircle className="w-7 h-7 text-white" />:<AlertTriangle className="w-7 h-7 text-white" />}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">{swapResults?.pending?'Sweep awaiting confirmation':!swapResults?.success?(swapResults?.failed?'Sweep failed':'Sweep not sent'):swapResults.skipped||swapResults.failed?'Sweep partially completed':'Sweep Complete'}</h3>
                    <p className="text-sm text-slate-400">
                      {swapResults?.success || 0} swapped · {swapResults?.skipped || 0} not sent{swapResults?.pending?` · ${swapResults.pending} awaiting confirmation`:''}{swapResults?.failed?` · ${swapResults.failed} failed`:''}
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
              
              {swapResults?.problem && <div role="alert" className="mt-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-sm text-yellow-200">{swapResults.problem}</div>}
              {swapResults?.walletRequest && <div className="mt-3 p-3 rounded-lg border border-amber-500/30 text-sm text-amber-200" aria-label="Wallet request to verify">
                <p>{swapResults.walletRequest.label} needs checking. No further transaction will be requested until it is resolved.</p>
                {swapResults.walletRequest.hash && <a className="block mt-2 break-all text-blue-400" href={`${config.explorerUrl}/tx/${swapResults.walletRequest.hash}`} target="_blank" rel="noopener noreferrer">View request: {swapResults.walletRequest.hash}</a>}
              </div>}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Total Input Value</p>
                  <p className={`text-lg font-bold ${detailedResults.some(r=>r.status==='success'&&!r.independentValuationAvailable)?'text-amber-300':'text-white'}`}>
                    {(()=>{const rows=detailedResults.filter(r=>r.status==='success'),values=rows.map(r=>r.independentValuationAvailable?r.inputValueUsd:r.estimatedInputValueUsd);return values.some(v=>v===undefined)?'Unavailable':`${rows.some(r=>!r.independentValuationAvailable)?'Est. ':''}${formatUSD(values.reduce<number>((sum,v)=>sum+(v??0),0))}`;})()}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Actual Received</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {swapResults?.valuationAvailable?formatUSD(swapResults.totalValue):`${swapResults?.totalOutput??'0'} ${swapResults?.outputToken??''}`}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Price Impact</p>
                  {(() => {
                    if(!swapResults?.valuationAvailable)return <p className="text-lg text-slate-400">—</p>;
                    const successfulResults = detailedResults.filter((r: SwapResultDetail) => r.status === 'success');
                    if(!successfulResults.length||successfulResults.some(r=>!r.independentValuationAvailable))return <p className="text-lg text-amber-300">Unavailable</p>;
                    const totalInput = successfulResults.reduce((sum: number, r: SwapResultDetail) => sum + r.inputValueUsd, 0);
                    const totalReceived = swapResults?.totalValue || 0;
                    const impactPercent = totalInput > 0 ? ((totalReceived - totalInput) / totalInput) * 100 : 0;
                    
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
            
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
                          <span className={result.independentValuationAvailable?'text-slate-400':'text-amber-300'}>{result.independentValuationAvailable?formatUSD(result.inputValueUsd):result.estimatedInputValueUsd!==undefined?`Est. ${formatUSD(result.estimatedInputValueUsd)}`:result.estimatedInputUsdc?`Est. ${formatNumber(Number(result.estimatedInputUsdc),4)} USDC`:'Unavailable'}</span>
                        </td>
                        <td className="py-3 text-right">
                          {result.status === 'success' && result.independentValuationAvailable ? (
                            <span className="text-emerald-400">{formatUSD(result.quotedOutputUsd)}</span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right pr-2">
                          {result.status === 'success' && !result.independentValuationAvailable ? <span className="text-amber-300">Unavailable</span> : result.status === 'success' ? (
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
            
            <div className="p-4 shrink-0 border-t border-slate-700 bg-slate-900/50">
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

      <BrandHeader chain="evm" wallet={<ConnectButton/>}/>

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="sweeper-main relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8">
        
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="sweeper-hero text-center mb-8"
        >
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            More from every token.
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto">
            Convert rewards and wallet tokens into USDC, WETH or AERO.
            Choose what to keep, review your routes, and sweep the rest.
          </p>
        </motion.div>

        {pending && <section className="mb-6 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10" aria-label="Pending wallet request">
          <h2 className="font-semibold text-white">Check your previous wallet request</h2>
          <p className="text-sm text-slate-300 mt-2">{pending.label}: confirm its status before sending another transaction. A slow receipt check does not mean the transaction failed.</p>
          {pending.hash && <a className="text-sm text-blue-400 break-all" href={`${config.explorerUrl}/tx/${pending.hash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}
          <input aria-label="Transaction hash from wallet" placeholder={pending.hash?'Replacement hash, if sped up or cancelled':'Paste transaction hash from your wallet'} className="w-full min-w-0 mt-3 p-3 rounded-lg bg-slate-800 text-white" value={recoveryHash} onChange={e=>setRecoveryHash(e.target.value)}/>
          <button disabled={isProcessing||isReconciling} className="mt-3 block py-2 px-4 rounded-lg bg-blue-600 text-white disabled:opacity-50" onClick={reconcilePending}>{isReconciling?'Checking transaction…':'Check transaction'}</button>
        </section>}
        {discoveryNotice && <p role="status" className="mb-4 p-4 rounded-xl bg-yellow-500/10 text-yellow-400 text-sm">{discoveryNotice}</p>}
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
          className="sweeper-panel bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden"
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

                  <button
                    onClick={() => scanWalletTokens(true)}
                    disabled={isScanning || isProcessing}
                    className="flex items-center gap-2 px-3 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition"
                    title="Force re-scan blockchain (clears cache)"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Re-scan
                  </button>

                  {tokens.length > 0 && (
                    <button
                      onClick={() => {
                        clearUserHiddenTokens(chainId);
                        scanWalletTokens(true);
                      }}
                      disabled={isScanning || isProcessing}
                      className="flex items-center gap-2 px-3 py-2.5 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition"
                      title="Show all hidden tokens"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Unhide All
                    </button>
                  )}

                  <div className="flex items-center gap-2 bg-slate-900/50 rounded-xl p-1">
                    <button
                      disabled={isProcessing}
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
                      disabled={isProcessing}
                      onClick={() => setOutputToken('WETH')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                        outputToken === 'WETH'
                          ? 'bg-purple-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      → WETH
                    </button>
                    {chainId===8453 && <button disabled={isProcessing} onClick={()=>setOutputToken('AERO')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${outputToken==='AERO'?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>→ AERO</button>}
                  </div>

                  <div className="ml-auto flex items-center gap-3">
                    {tokens.length > 0 && (
                      <div className="text-xs text-slate-500" title="External spam list + user hidden">
                        🚫 {(() => {
                          const stats = getCacheStats(chainId, address);
                          return `${stats.externalSpam} spam, ${stats.userHidden} hidden`;
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
                      className="flex-1 bg-slate-800/50 text-sm text-white outline-none placeholder:text-slate-500 px-3 py-2 rounded-lg border border-slate-600/50 focus:border-emerald-500/50"
                    />
                    <button
                      onClick={async () => {
                        if (manualTokenInput.match(/^0x[a-fA-F0-9]{40}$/) && publicClient && address) {
                          const captured = scope();
                          const addr = manualTokenInput.toLowerCase() as Address;
                          const newManual = new Set(manualTokens);
                          newManual.add(addr);
                          setManualTokens(newManual);
                          saveManualTokens(newManual);
                          setManualTokenInput('');
                          console.log(`📌 Added manual token: ${addr}`);
                          
                          setIsAddingToken(true);
                          try {
                            const infos = await fetchTokenInfos([addr], address, publicClient);
                            if (infos.length > 0 && infos[0].balance > 0n) {
                              const newToken = infos[0];
                              const balanceNum = newToken.unitsVerified ? Number(formatUnits(newToken.balance, newToken.decimals)) : 0;
                              newToken.balanceFormatted = newToken.unitsVerified ? formatNumber(balanceNum, 4) : 'Units unavailable';
                              const prices = await fetchMarketPrices([newToken], chainId, config.usdc as Address);
                              const priceData = prices[addr.toLowerCase()];
                              newToken.price = priceData?.price || 0;
                              newToken.priceSource = priceData?.source as TokenInfo['priceSource'] || 'unknown';
                              newToken.priceObservation = priceData?.observation;
                              newToken.valueUsd = balanceNum * newToken.price;
                              
                              checkScope(captured);
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

                {isScanning && tokens.length === 0 && (
                  <div className="py-12 text-center">
                    <Loader2 className="w-10 h-10 text-emerald-400 mx-auto mb-4 animate-spin" />
                    <p className="text-slate-300">{progressStep || 'Scanning...'}</p>
                  </div>
                )}

                {isScanning && tokens.length>0 && <p role="status" className="text-sm text-slate-400 mb-3">Balances ready. Updating display prices…</p>}
                {tokens.length > 0 && (
                  <>
                    <label className="block mb-3 text-sm text-slate-400">
                      Search all holdings
                      <input type="search" aria-label="Search all holdings" maxLength={128} value={inventoryQuery} onChange={event=>{setInventoryQuery(event.target.value);setVisibleCount(50);}} placeholder="Token, name or address" className="mt-1 w-full min-w-0 px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white" />
                    </label>
                    <p className="mb-3 text-xs text-slate-400" role="status">Showing {inventory.rows.length} of {inventory.matchingCount} holdings{inventoryQuery?' matching your search':''} · {inventory.unpricedCount} unpriced. Unpriced balances remain available for review.</p>
                    {/* Select All / None - FIXED: removed extra closing div */}
                    <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => setSelectedTokens(new Set(displayTokens.filter(t=>t.unitsVerified).map((t: TokenInfo) => t.address)))}
                        className="text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        Select All
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        onClick={() => setSelectedTokens(new Set(knownPriceTokens.filter(t=>t.unitsVerified).map((t: TokenInfo) => t.address)))}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Priced Only
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        onClick={() => setSelectedTokens(new Set())}
                        className="text-xs text-slate-400 hover:text-slate-300"
                      >
                        Clear
                      </button>
                    </div>

                    {/* Positive holdings remain visible independently of valuation. */}
                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                      {inventory.rows.map((token: TokenInfo) => {
                        const isSelected = selectedTokens.has(token.address);
                        const priced = inventoryHasDisplayPrice(token);
                        const estimate = priced?undefined:stockValueFor(token);
                        const customAmount = customAmounts[token.address] || '';
                        
                        return (
                          <motion.div
                            key={token.address}
                            className={`p-3 rounded-xl border transition ${
                              isSelected 
                                ? priced?'bg-slate-800 border-emerald-500/50':'bg-slate-800 border-amber-500/50'
                                : 'bg-slate-800/30 border-transparent opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <button
                                disabled={!token.unitsVerified || isProcessing}
                                aria-label={`Select ${token.symbol}`}
                                onClick={() => {
                                  if(!token.unitsVerified)return;
                                  const next = new Set(selectedTokens);
                                  if (next.has(token.address)) {
                                    next.delete(token.address);
                                  } else {
                                    next.add(token.address);
                                  }
                                  setSelectedTokens(next);
                                }}
                                className={`w-5 h-5 shrink-0 rounded flex items-center justify-center border transition ${
                                  isSelected 
                                    ? priced?'bg-emerald-500 border-emerald-500':'bg-amber-500 border-amber-500'
                                    : 'border-slate-600 hover:border-slate-500'
                                }`}
                              >
                                {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                              </button>

                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-white break-all">{token.symbol}</span>
                                  {getTokenLabel(chainId, token.address) && (
                                    <span className="text-xs text-slate-400">{getTokenLabel(chainId, token.address)}</span>
                                  )}
                                  <span className="text-xs text-slate-500">{shortenAddress(token.address)}</span>
                                </div>
                                <div className="text-sm text-slate-400 break-all">
                                  Balance: {token.unitsVerified?formatUnits(token.balance,token.decimals):`${token.balance} raw units · units unavailable`}
                                </div>
                              </div>

                              <div className="shrink-0 max-w-[8rem] break-words text-right">
                                {priced?<><div className="text-emerald-400 font-medium">{formatUSD(token.valueUsd)}</div><div className="text-xs text-slate-500">@ ${formatNumber(token.price,4)}</div></>:estimate?<div className="text-amber-300" aria-label={`${token.symbol} pool estimate`} title="Indicative sale value from a native USDC quote. Trading still requires a fresh review."><div className="font-medium">Est. {estimate.valueUsd!==null?formatUSD(estimate.valueUsd):`${formatNumber(Number(formatUnits(estimate.usdcUnits,6)),4)} USDC`}</div><div className="text-[10px] text-amber-400/80">{estimate.priceUsd!==null?`≈ $${formatNumber(estimate.priceUsd,2)} each`:'Pool quote in USDC'}</div></div>:<span className="text-amber-400 text-sm font-medium" title="USD estimate unavailable. You can still review an exact amount.">Unpriced</span>}
                              </div>
                              
                              <button
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  hideToken(chainId, token.address);
                                  setTokens((prev: TokenInfo[]) => prev.filter((t: TokenInfo) => t.address !== token.address));
                                  setSelectedTokens((prev: Set<string>) => {
                                    const next = new Set(prev);
                                    next.delete(token.address);
                                    return next;
                                  });
                                  console.log(`🚫 Hid ${token.symbol}`);
                                }}
                                className="shrink-0 ml-2 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition"
                                title="Hide this token"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>

                            {isSelected && (
                              <div className="mt-3 flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2 border border-slate-700">
                                <input
                                  type="text"
                                  aria-label={`Amount of ${token.symbol}`}
                                  disabled={!token.unitsVerified||isProcessing}
                                  placeholder={token.unitsVerified?formatUnits(token.balance,token.decimals):'Units unavailable'}
                                  value={customAmount}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    setCustomAmounts((prev: Record<string, string>) => ({
                                      ...prev,
                                      [token.address]: e.target.value
                                    }));
                                  }}
                                  className="flex-1 min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
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

                    {inventory.matchingCount>visibleCount && <button type="button" onClick={()=>setVisibleCount(n=>n+50)} className="mt-3 px-4 py-2 text-sm text-blue-400">Show 50 more tokens</button>}
                    {inventory.matchingCount===0&&<p className="py-6 text-center text-slate-400">No holdings match this search.</p>}
                  </>
                )}
              </div>

              {/* Action Footer */}
              {tokens.length > 0 && (
                <div className="p-4 border-t border-slate-700/50 bg-slate-900/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm text-slate-400">Selected USD estimate:</span>
                      <span className={`text-xl font-bold ${selectedDisplay.estimated?'text-amber-300':'text-white'}`}>
                        {selectedDisplay.value===null?'Unavailable':`${selectedDisplay.estimated?'Est. ':''}${formatUSD(selectedDisplay.value)}`}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400">
                      {selectedCount} token{selectedCount !== 1 ? 's' : ''} → {outputToken}
                    </div>
                  </div>

                  <button
                    onClick={fetchQuotesAndShowPreview}
                    disabled={isProcessing || isScanning || selectedCount === 0 || !!pending || journalError}
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
              role="alert"
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
          {swapResults && swapResults.success > 0 && (
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
                    Received: {swapResults.totalOutput} {swapResults.outputToken}{swapResults.valuationAvailable?` · ${formatUSD(swapResults.totalValue)}`:''}
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
              Group compatible swaps into batches that fit network gas limits
            </p>
          </div>
          <div className="p-4 bg-slate-800/30 backdrop-blur border border-slate-700/50 rounded-xl">
            <Zap className="w-6 h-6 text-blue-400 mb-2" />
            <h3 className="font-medium text-white mb-1">Best Rates</h3>
            <p className="text-sm text-slate-400">
              0x aggregation and verified native Aero routes on Base
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
      <BrandFooter/>
    </div>
  );
}
