// ============================================================================
// SOLANA BATCH SWAP IMPLEMENTATION
// ============================================================================
// Uses Jupiter's swap-instructions endpoint to bundle multiple swaps per tx.
// No custom program needed - pure client-side instruction bundling.
// ============================================================================

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  TransactionInstruction,
  ComputeBudgetProgram,
} from '@solana/web3.js';

// ============================================================================
// TYPES
// ============================================================================

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
  // Spam filtering fields
  tradeable?: boolean;      // Jupiter can quote it
  tradeError?: string;      // Why it can't be traded (if untradeable)
  priceSource?: 'jupiter' | 'unknown';
  // Quote info (populated during swap)
  priceImpactPct?: number;  // Price impact from Jupiter quote
  quotedOutputUsd?: number; // Expected output value
}

// ============================================================================
// SPAM FILTERING
// ============================================================================

// Known good tokens that should never be filtered
const KNOWN_GOOD_TOKENS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112',   // Wrapped SOL
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // JitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  // bSOL
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // wETH (Portal)
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // wBTC (Portal)
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  // RENDER
  'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',  // WEN
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',  // ORCA
  'RaijNvQiMeZBXqFGLRQRwihLmcMwvWXqeqLhGwjFr5j',  // RAYDIUM
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'AFbX8oGjGpmVFywbVouvhQSRmiW2aR1mohfahi4Y2AdB', // GST
].map(m => m.toLowerCase()));

// Common spam symbol patterns
const SPAM_SYMBOL_PATTERNS = [
  'airdrop',
  'claim',
  'free',
  'reward',
  '.com',
  '.io',
  '.xyz',
  '.org',
  'visit',
  'bonus',
  'gift',
  'win',
];

/**
 * Check if a token symbol looks like spam based on patterns
 */
export function isSpamBySymbol(symbol: string): boolean {
  if (!symbol) return false;
  const lower = symbol.toLowerCase();
  return SPAM_SYMBOL_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Check if a token is known good (whitelisted)
 */
export function isKnownGoodToken(mint: string): boolean {
  return KNOWN_GOOD_TOKENS.has(mint.toLowerCase());
}

// ============================================================================
// USER HIDDEN TOKENS (localStorage)
// ============================================================================

const HIDDEN_TOKENS_KEY = 'solana_sweeper_hidden_tokens';

/**
 * Get user-hidden token mints from localStorage
 */
export function getUserHiddenTokens(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(HIDDEN_TOKENS_KEY);
    if (stored) {
      return new Set(JSON.parse(stored).map((m: string) => m.toLowerCase()));
    }
  } catch (e) {
    console.warn('Failed to read hidden tokens:', e);
  }
  return new Set();
}

/**
 * Add a token to user-hidden list
 */
export function hideToken(mint: string): void {
  if (typeof window === 'undefined') return;
  try {
    const hidden = getUserHiddenTokens();
    hidden.add(mint.toLowerCase());
    localStorage.setItem(HIDDEN_TOKENS_KEY, JSON.stringify([...hidden]));
    console.log(`🚫 User hid token: ${mint.slice(0, 10)}...`);
  } catch (e) {
    console.warn('Failed to hide token:', e);
  }
}

/**
 * Remove a token from user-hidden list
 */
export function unhideToken(mint: string): void {
  if (typeof window === 'undefined') return;
  try {
    const hidden = getUserHiddenTokens();
    hidden.delete(mint.toLowerCase());
    localStorage.setItem(HIDDEN_TOKENS_KEY, JSON.stringify([...hidden]));
    console.log(`✅ User unhid token: ${mint.slice(0, 10)}...`);
  } catch (e) {
    console.warn('Failed to unhide token:', e);
  }
}

/**
 * Clear all user-hidden tokens
 */
export function clearUserHiddenTokens(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HIDDEN_TOKENS_KEY);
    console.log('🗑️ Cleared all user-hidden tokens');
  } catch (e) {
    console.warn('Failed to clear hidden tokens:', e);
  }
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
}

export interface JupiterSwapInstructions {
  tokenLedgerInstruction?: any;
  computeBudgetInstructions: any[];
  setupInstructions: any[];
  swapInstruction: any;
  cleanupInstruction?: any;
  addressLookupTableAddresses: string[];
}

export interface SwapResult {
  mint: string;
  symbol: string;
  status: 'success' | 'failed' | 'skipped';
  signature?: string;
  error?: string;
  inputAmount: bigint;
  outputAmount?: bigint;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Popular output tokens on Solana
export const SOLANA_TOKENS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  SOL: 'So11111111111111111111111111111111111111112', // Wrapped SOL
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
} as const;

// ============================================================================
// PLATFORM FEE CONFIGURATION
// ============================================================================
// Fee in basis points (5 = 0.05%)
const PLATFORM_FEE_BPS = 5;

// Your platform's fee wallet address
// Set NEXT_PUBLIC_PLATFORM_FEE_WALLET in your .env.local or Cloudflare env vars
const PLATFORM_FEE_WALLET = process.env.NEXT_PUBLIC_PLATFORM_FEE_WALLET || '';

/**
 * Derive the Associated Token Account (ATA) for a given wallet and mint
 * This is where fees will be deposited
 */
function deriveFeeAccount(walletAddress: string, tokenMint: string): string | null {
  if (!walletAddress || walletAddress.includes('YOUR_')) return null;
  
  try {
    const { PublicKey } = require('@solana/web3.js');
    const wallet = new PublicKey(walletAddress);
    const mint = new PublicKey(tokenMint);
    
    // Derive ATA address (same algorithm as getAssociatedTokenAddress)
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    
    const [ata] = PublicKey.findProgramAddressSync(
      [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    return ata.toString();
  } catch (err) {
    console.warn('Failed to derive fee account:', err);
    return null;
  }
}

// Jupiter API endpoints (Dec 2025)
// lite-api.jup.ag - no platform fee (being deprecated Dec 31, 2025)
// After Dec 31, 2025, switch to public.jupiterapi.com (0.2% fee)
const JUPITER_QUOTE_API = 'https://lite-api.jup.ag/swap/v1/quote';
const JUPITER_SWAP_INSTRUCTIONS_API = 'https://lite-api.jup.ag/swap/v1/swap-instructions';

// Helius API
const HELIUS_API_BASE = 'https://api.helius.xyz/v0';

// Batch sizing - Jupiter swaps are too complex to batch
// Solana is fast (~400ms/tx) so individual swaps are fine
const SWAPS_PER_BATCH = 1; // One swap per transaction
const QUOTE_BATCH_SIZE = 5;
const QUOTE_BATCH_DELAY_MS = 500;

// ============================================================================
// HELIUS API KEY
// ============================================================================

/**
 * Get Helius API key from environment variable
 * Set NEXT_PUBLIC_HELIUS_API_KEY in your .env.local
 */
function getHeliusApiKey(): string {
  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (!key) {
    throw new Error(
      'NEXT_PUBLIC_HELIUS_API_KEY is not set. ' +
      'Get a free API key at https://dev.helius.xyz and add it to your .env.local'
    );
  }
  return key;
}

// ============================================================================
// TOKEN DISCOVERY (Helius DAS API + Jupiter Prices)
// ============================================================================

/**
 * Fetch prices from Jupiter Price API
 * Using the public endpoint that doesn't require auth
 */
async function fetchJupiterPrices(mints: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (mints.length === 0) return prices;
  
  try {
    // Jupiter Price API - use vsToken=USDC for USD prices
    // Batch in groups of 100 to avoid URL length limits
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < mints.length; i += BATCH_SIZE) {
      const batch = mints.slice(i, i + BATCH_SIZE);
      const ids = batch.join(',');
      
      // Use the price API with vsToken for USD equivalent
      const res = await fetch(
        `https://api.jup.ag/price/v2?ids=${ids}`
      );
      
      if (!res.ok) {
        console.warn('Jupiter price API error:', res.status);
        continue;
      }
      
      const data = await res.json();
      
      for (const [mint, priceData] of Object.entries(data.data || {})) {
        const price = (priceData as any)?.price;
        if (price && typeof price === 'number') {
          prices.set(mint, price);
        }
      }
    }
    
    console.log(`💰 Got ${prices.size}/${mints.length} prices from Jupiter`);
    
  } catch (err) {
    console.warn('Failed to fetch Jupiter prices:', err);
  }
  
  return prices;
}

/**
 * Fetch all fungible token balances using Helius DAS API
 * This returns full metadata including symbol, name, and logo
 * 
 * Requires NEXT_PUBLIC_HELIUS_API_KEY environment variable
 */
export async function discoverSolanaTokens(
  wallet: string,
  minValueUsd: number = 0.10
): Promise<SolanaTokenInfo[]> {
  const heliusApiKey = getHeliusApiKey();
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  
  console.log(`🔍 Discovering Solana tokens for ${wallet.slice(0, 8)}...`);
  
  try {
    const tokens: SolanaTokenInfo[] = [];
    
    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: Get native SOL balance
    // ─────────────────────────────────────────────────────────────────────
    const solBalanceRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'sol-balance',
        method: 'getBalance',
        params: [wallet]
      })
    });
    
    const solBalanceData = await solBalanceRes.json();
    const solLamports = solBalanceData.result?.value || 0;
    
    if (solLamports > 0) {
      const solBalance = BigInt(solLamports);
      const solBalanceNum = Number(solBalance) / 1e9;
      const solPrice = await fetchSolPrice();
      const solValue = solBalanceNum * solPrice;
      
      if (solValue >= minValueUsd) {
        tokens.push({
          mint: SOLANA_TOKENS.SOL,
          symbol: 'SOL',
          name: 'Solana',
          decimals: 9,
          balance: solBalance,
          balanceFormatted: solBalanceNum.toFixed(4),
          price: solPrice,
          valueUsd: solValue,
          logoUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
        });
        console.log(`  ✅ SOL: $${solValue.toFixed(2)} (${solBalanceNum.toFixed(4)} @ $${solPrice.toFixed(2)})`);
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: Get all fungible tokens via DAS API
    // ─────────────────────────────────────────────────────────────────────
    console.log(`📦 Fetching fungible tokens via DAS API...`);
    
    const dasRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-assets',
        method: 'searchAssets',
        params: {
          ownerAddress: wallet,
          tokenType: 'fungible',
          displayOptions: {
            showNativeBalance: false,
            showGrandTotal: false,
          }
        }
      })
    });
    
    const dasData = await dasRes.json();
    
    if (dasData.error) {
      console.error('DAS API error:', dasData.error);
      throw new Error(dasData.error.message || 'DAS API failed');
    }
    
    const assets = dasData.result?.items || [];
    console.log(`📦 DAS API returned ${assets.length} fungible tokens`);
    
    // ─────────────────────────────────────────────────────────────────────
    // STEP 3: Get prices from Jupiter for all mints
    // ─────────────────────────────────────────────────────────────────────
    const mints = assets.map((a: any) => a.id).filter(Boolean);
    const prices = await fetchJupiterPrices(mints);
    
    // ─────────────────────────────────────────────────────────────────────
    // STEP 4: Pre-filter obvious spam by symbol patterns
    // ─────────────────────────────────────────────────────────────────────
    let spamFiltered = 0;
    const userHidden = getUserHiddenTokens();
    
    // ─────────────────────────────────────────────────────────────────────
    // STEP 5: Process tokens
    // ─────────────────────────────────────────────────────────────────────
    const tokensToCheck: SolanaTokenInfo[] = [];
    
    for (const asset of assets) {
      try {
        const mint = asset.id;
        if (!mint) continue;
        
        // Get token info from asset
        const tokenInfo = asset.token_info || {};
        const metadata = asset.content?.metadata || {};
        
        const decimals = tokenInfo.decimals ?? 0;
        if (decimals === 0) continue; // Skip NFTs
        
        const rawBalance = tokenInfo.balance || 0;
        if (!rawBalance || rawBalance === '0' || rawBalance === 0) continue;
        
        const balance = BigInt(rawBalance);
        const balanceNum = Number(balance) / (10 ** decimals);
        
        // Get price from Jupiter
        const price = prices.get(mint) || tokenInfo.price_info?.price_per_token || 0;
        const valueUsd = balanceNum * price;
        
        // Get symbol/name from metadata
        const symbol = tokenInfo.symbol || metadata.symbol || mint.slice(0, 6);
        const name = metadata.name || tokenInfo.symbol || 'Unknown Token';
        
        // Get logo
        const logoUrl = asset.content?.links?.image || 
                       asset.content?.files?.[0]?.uri ||
                       tokenInfo.image_uri ||
                       undefined;
        
        // Check for obvious spam by symbol pattern
        if (isSpamBySymbol(symbol) && !isKnownGoodToken(mint)) {
          console.log(`  🚫 ${symbol}: Spam pattern detected`);
          spamFiltered++;
          continue;
        }
        
        // Include if has value OR if price unknown (let user decide)
        const hasUnknownPrice = price === 0;
        const meetsValueThreshold = valueUsd >= minValueUsd;
        
        if (!meetsValueThreshold && !hasUnknownPrice) continue;
        
        const priceSource = price > 0 ? 'jupiter' : 'unknown';
        
        if (hasUnknownPrice) {
          console.log(`  ⚠️ ${symbol}: Price unknown, balance: ${balanceNum.toFixed(4)}`);
        } else {
          console.log(`  ✅ ${symbol}: $${valueUsd.toFixed(2)} (${balanceNum.toFixed(4)} @ $${price.toFixed(6)})`);
        }
        
        tokensToCheck.push({
          mint,
          symbol,
          name,
          decimals,
          balance,
          balanceFormatted: balanceNum.toFixed(4),
          price,
          valueUsd,
          logoUrl,
          priceSource,
          tradeable: undefined, // Will be checked next
          tradeError: undefined
        });
        
      } catch (err) {
        console.warn(`  ❌ Error processing asset:`, err);
      }
    }
    
    if (spamFiltered > 0) {
      console.log(`🧹 Pre-filtered ${spamFiltered} spam tokens by symbol pattern`);
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // STEP 6: Check tradability with Jupiter quotes (batch)
    // ─────────────────────────────────────────────────────────────────────
    console.log(`🔍 Checking tradability for ${tokensToCheck.length} tokens...`);
    
    // Check tradability in batches
    const TRADABILITY_BATCH_SIZE = 10;
    const TRADABILITY_BATCH_DELAY = 500;
    
    for (let i = 0; i < tokensToCheck.length; i += TRADABILITY_BATCH_SIZE) {
      const batch = tokensToCheck.slice(i, i + TRADABILITY_BATCH_SIZE);
      const batchNum = Math.floor(i / TRADABILITY_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(tokensToCheck.length / TRADABILITY_BATCH_SIZE);
      
      console.log(`  📊 Tradability check batch ${batchNum}/${totalBatches}...`);
      
      const checkPromises = batch.map(async (token) => {
        // Known good tokens are always tradeable
        if (isKnownGoodToken(token.mint)) {
          token.tradeable = true;
          return;
        }
        
        // Try to get a Jupiter quote
        try {
          const quote = await getJupiterQuote(
            token.mint,
            SOLANA_TOKENS.USDC,
            token.balance,
            100 // 1% slippage
          );
          
          if (quote && quote.outAmount && BigInt(quote.outAmount) > 0n) {
            token.tradeable = true;
          } else {
            token.tradeable = false;
            token.tradeError = 'No liquidity';
          }
        } catch (err: any) {
          token.tradeable = false;
          token.tradeError = err.message || 'Quote failed';
        }
      });
      
      await Promise.all(checkPromises);
      
      // Rate limit between batches
      if (i + TRADABILITY_BATCH_SIZE < tokensToCheck.length) {
        await new Promise(r => setTimeout(r, TRADABILITY_BATCH_DELAY));
      }
    }
    
    // Add SOL to tokens (it's always tradeable)
    const solToken = tokens.find(t => t.mint === SOLANA_TOKENS.SOL);
    if (solToken) {
      solToken.tradeable = true;
      solToken.priceSource = 'jupiter';
    }
    
    // Combine SOL + discovered tokens
    const allTokens = [...tokens, ...tokensToCheck];
    
    // Stats
    const tradeableCount = allTokens.filter(t => t.tradeable === true).length;
    const untradeableCount = allTokens.filter(t => t.tradeable === false).length;
    const hiddenCount = allTokens.filter(t => userHidden.has(t.mint.toLowerCase())).length;
    
    console.log(`📊 Tradability: ${tradeableCount} tradeable, ${untradeableCount} untradeable, ${hiddenCount} user-hidden`);
    
    // Sort: tradeable first (by value), then untradeable
    allTokens.sort((a, b) => {
      // User hidden last
      const aHidden = userHidden.has(a.mint.toLowerCase());
      const bHidden = userHidden.has(b.mint.toLowerCase());
      if (aHidden && !bHidden) return 1;
      if (!aHidden && bHidden) return -1;
      
      // Tradeable before untradeable
      if (a.tradeable && !b.tradeable) return -1;
      if (!a.tradeable && b.tradeable) return 1;
      
      // Then by value
      if (a.price > 0 && b.price > 0) return b.valueUsd - a.valueUsd;
      if (a.price > 0) return -1;
      if (b.price > 0) return 1;
      return 0;
    });
    
    console.log(`✅ Found ${allTokens.length} tokens (${tradeableCount} tradeable)`);
    return allTokens;
    
  } catch (err: any) {
    console.error('Token discovery failed:', err);
    throw err;
  }
}

/**
 * Fetch SOL price from CoinGecko (fallback)
 */
async function fetchSolPrice(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );
    const data = await res.json();
    return data.solana?.usd || 150; // Fallback price
  } catch {
    return 150; // Fallback
  }
}

// ============================================================================
// JUPITER QUOTES
// ============================================================================

/**
 * Fetch a Jupiter quote for a single token swap
 */
export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint,
  slippageBps: number = 100 // 1% default
): Promise<JupiterQuote | null> {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
      // Use ExactIn mode (we specify input amount)
      swapMode: 'ExactIn',
      // Platform fee (5 bps = 0.05%)
      platformFeeBps: PLATFORM_FEE_BPS.toString(),
      // Only direct routes for reliability (can remove for better prices)
      // onlyDirectRoutes: 'true',
    });
    
    const res = await fetch(`${JUPITER_QUOTE_API}?${params}`);
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn(`Jupiter quote failed for ${inputMint.slice(0, 8)}:`, err);
      return null;
    }
    
    return await res.json();
    
  } catch (err: any) {
    console.warn(`Jupiter quote error for ${inputMint.slice(0, 8)}:`, err.message);
    return null;
  }
}

/**
 * Fetch quotes for multiple tokens in batches
 */
export async function getJupiterQuotesBatched(
  tokens: SolanaTokenInfo[],
  outputMint: string,
  slippageBps: number = 100,
  onProgress?: (msg: string) => void
): Promise<Map<string, JupiterQuote>> {
  const quotes = new Map<string, JupiterQuote>();
  const totalBatches = Math.ceil(tokens.length / QUOTE_BATCH_SIZE);
  
  console.log(`📊 Fetching ${tokens.length} Jupiter quotes in ${totalBatches} batches...`);
  
  for (let i = 0; i < tokens.length; i += QUOTE_BATCH_SIZE) {
    const batch = tokens.slice(i, i + QUOTE_BATCH_SIZE);
    const batchNum = Math.floor(i / QUOTE_BATCH_SIZE) + 1;
    
    onProgress?.(`Fetching quotes (${batchNum}/${totalBatches})...`);
    
    // Fetch batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (token) => {
        // Skip if same as output (e.g., sweeping to USDC and token is USDC)
        if (token.mint === outputMint) {
          return { mint: token.mint, quote: null, skip: true };
        }
        
        const quote = await getJupiterQuote(
          token.mint,
          outputMint,
          token.balance,
          slippageBps
        );
        
        return { mint: token.mint, quote, skip: false };
      })
    );
    
    // Collect results
    for (const { mint, quote, skip } of batchResults) {
      if (!skip && quote) {
        quotes.set(mint, quote);
        console.log(`  ✅ ${mint.slice(0, 8)}: ${quote.outAmount} output`);
      } else if (!skip) {
        console.log(`  ❌ ${mint.slice(0, 8)}: No quote`);
      }
    }
    
    // Delay between batches
    if (i + QUOTE_BATCH_SIZE < tokens.length) {
      await new Promise(r => setTimeout(r, QUOTE_BATCH_DELAY_MS));
    }
  }
  
  console.log(`✅ Got ${quotes.size}/${tokens.length} quotes`);
  return quotes;
}

// ============================================================================
// JUPITER SWAP INSTRUCTIONS
// ============================================================================

/**
 * Get swap instructions (not a full transaction) from Jupiter
 * This allows us to bundle multiple swaps into one transaction
 */
export async function getJupiterSwapInstructions(
  quote: JupiterQuote,
  userPublicKey: string
): Promise<JupiterSwapInstructions | null> {
  try {
    const res = await fetch(JUPITER_SWAP_INSTRUCTIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        // Wrap/unwrap SOL automatically
        wrapAndUnwrapSol: true,
        // Use shared accounts to reduce tx size
        useSharedAccounts: true,
        // Don't use token ledger (simpler)
        useTokenLedger: false,
        // Dynamic compute unit limit
        dynamicComputeUnitLimit: true,
        // Skip user accounts preflight (we'll handle errors)
        skipUserAccountsRpcCalls: false,
      })
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Jupiter swap-instructions failed:', err);
      return null;
    }
    
    return await res.json();
    
  } catch (err: any) {
    console.warn('Jupiter swap-instructions error:', err.message);
    return null;
  }
}

/**
 * Calculate dynamic slippage based on price impact
 * Mirrors the EVM sweeper's logic
 */
export function calculateDynamicSlippage(priceImpactPct: number, forceHighSlippage: boolean = false): number {
  const priceImpactBps = Math.ceil(priceImpactPct * 100);
  
  if (forceHighSlippage) {
    // Force mode: allow very high slippage for stubborn tokens
    return Math.min(5000, Math.max(500, priceImpactBps + 500)); // 5% to 50%
  }
  
  // Normal mode: scale slippage with price impact
  // Low impact (<0.5%): 50-100 bps
  // Medium impact (0.5-2%): 100-300 bps  
  // High impact (2-5%): 300-500 bps
  if (priceImpactBps < 50) {
    return Math.max(50, 50 + priceImpactBps);
  } else if (priceImpactBps < 200) {
    return Math.max(100, 100 + Math.ceil(priceImpactBps * 1.5));
  } else {
    return Math.min(500, 200 + priceImpactBps);
  }
}

/**
 * Get a complete swap transaction from Jupiter (simpler approach)
 * Returns a base64-encoded transaction ready to sign and send
 * Now supports dynamic slippage based on price impact
 */
export async function getJupiterSwapTransaction(
  quote: JupiterQuote,
  userPublicKey: string,
  forceHighSlippage: boolean = false
): Promise<string | null> {
  try {
    // Calculate dynamic slippage based on price impact
    const priceImpactPct = parseFloat(quote.priceImpactPct || '0');
    const dynamicSlippageBps = calculateDynamicSlippage(priceImpactPct, forceHighSlippage);
    
    // For the swap endpoint, we use dynamicSlippage.maxBps
    // This allows Jupiter to optimize while respecting our calculated limit
    const maxSlippageBps = forceHighSlippage 
      ? Math.min(5000, dynamicSlippageBps + 500) // Extra buffer for force mode
      : Math.min(1000, dynamicSlippageBps + 200); // Normal buffer
    
    console.log(`  📊 Price impact: ${priceImpactPct.toFixed(2)}% → slippage: ${dynamicSlippageBps}bps (max: ${maxSlippageBps}bps)`);
    
    // Use the /swap endpoint instead of /swap-instructions
    const swapUrl = JUPITER_SWAP_INSTRUCTIONS_API.replace('swap-instructions', 'swap');
    
    // Derive the fee account for the output token
    const outputMint = quote.outputMint;
    const feeAccount = deriveFeeAccount(PLATFORM_FEE_WALLET, outputMint);
    
    const swapBody: Record<string, any> = {
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      useSharedAccounts: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: { maxBps: maxSlippageBps },
      useLatestBlockhash: true,
      prioritizationFeeLamports: 'auto',
    };
    
    // Only add feeAccount if wallet is configured
    if (feeAccount) {
      swapBody.feeAccount = feeAccount;
      console.log(`  💰 Platform fee: ${PLATFORM_FEE_BPS}bps → ${feeAccount.slice(0, 8)}...`);
    } else {
      console.warn('⚠️ Platform fee wallet not configured - no fees will be collected');
    }
    
    const res = await fetch(swapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(swapBody)
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Jupiter swap failed:', err);
      return null;
    }
    
    const data = await res.json();
    return data.swapTransaction || null;
    
  } catch (err: any) {
    console.warn('Jupiter swap error:', err.message);
    return null;
  }
}

// ============================================================================
// ADDRESS LOOKUP TABLES
// ============================================================================

/**
 * Fetch Address Lookup Table accounts for transaction compression
 */
export async function getAddressLookupTables(
  connection: Connection,
  addresses: string[]
): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];
  
  const uniqueAddresses = [...new Set(addresses)];
  const tables: AddressLookupTableAccount[] = [];
  
  // Fetch in batches to avoid RPC limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < uniqueAddresses.length; i += BATCH_SIZE) {
    const batch = uniqueAddresses.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.all(
      batch.map(async (addr) => {
        try {
          const pubkey = new PublicKey(addr);
          const result = await connection.getAddressLookupTable(pubkey);
          return result.value;
        } catch {
          return null;
        }
      })
    );
    
    for (const table of results) {
      if (table) tables.push(table);
    }
  }
  
  return tables;
}

// ============================================================================
// INSTRUCTION DESERIALIZATION
// ============================================================================

/**
 * Convert Jupiter's instruction format to Solana TransactionInstruction
 */
function deserializeInstruction(instruction: any): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((acc: any) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: Buffer.from(instruction.data, 'base64'),
  });
}

// ============================================================================
// BATCH EXECUTION
// ============================================================================

/**
 * Execute multiple swaps with parallel transaction execution
 * 
 * Flow:
 * 1. Get quotes for all tokens
 * 2. Get complete swap transactions from Jupiter
 * 3. Sign all transactions (batch if wallet supports it)
 * 4. Send all transactions in parallel
 * 5. Confirm all transactions in parallel
 */
export async function executeBatchSwap(
  tokens: SolanaTokenInfo[],
  outputMint: string,
  outputDecimals: number,
  wallet: PublicKey,
  connection: Connection,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  slippageBps: number = 100,
  onProgress?: (msg: string) => void,
  signAllTransactions?: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>
): Promise<{
  successful: SwapResult[];
  failed: SwapResult[];
  totalOutputAmount: bigint;
}> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚀 SOLANA PARALLEL SWAP`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Tokens: ${tokens.length}`);
  console.log(`Output: ${outputMint.slice(0, 8)}...`);
  console.log(`Slippage: ${slippageBps} bps`);
  console.log(`Batch signing: ${signAllTransactions ? 'Yes' : 'No (sequential)'}`);
  
  const successful: SwapResult[] = [];
  const failed: SwapResult[] = [];
  let totalOutputAmount = 0n;
  
  // Filter out output token from inputs
  const tokensToSwap = tokens.filter(t => t.mint !== outputMint);
  
  if (tokensToSwap.length === 0) {
    console.log('No tokens to swap');
    return { successful, failed, totalOutputAmount };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: GET QUOTES
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n📊 STEP 1: Fetching quotes...`);
  onProgress?.('Fetching quotes...');
  
  const quotes = await getJupiterQuotesBatched(
    tokensToSwap,
    outputMint,
    slippageBps,
    onProgress
  );
  
  // Track tokens without quotes as failed
  for (const token of tokensToSwap) {
    if (!quotes.has(token.mint)) {
      failed.push({
        mint: token.mint,
        symbol: token.symbol,
        status: 'failed',
        error: 'No quote available',
        inputAmount: token.balance,
      });
    }
  }
  
  const quotedTokens = tokensToSwap.filter(t => quotes.has(t.mint));
  
  if (quotedTokens.length === 0) {
    console.log('❌ No valid quotes');
    return { successful, failed, totalOutputAmount };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: BUILD ALL TRANSACTIONS (using /swap endpoint)
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n🔧 STEP 2: Building ${quotedTokens.length} swap transactions...`);
  onProgress?.('Building transactions...');
  
  const pendingSwaps: Array<{
    token: SolanaTokenInfo;
    quote: JupiterQuote;
    transaction: VersionedTransaction;
    priceImpactPct: number;
  }> = [];
  
  for (const token of quotedTokens) {
    const quote = quotes.get(token.mint)!;
    const priceImpactPct = parseFloat(quote.priceImpactPct || '0');
    
    try {
      // Get complete transaction from Jupiter's /swap endpoint
      // Dynamic slippage is calculated inside based on price impact
      const swapTxBase64 = await getJupiterSwapTransaction(quote, wallet.toString());
      
      if (!swapTxBase64) {
        console.log(`  ❌ ${token.symbol}: Failed to get transaction`);
        failed.push({
          mint: token.mint,
          symbol: token.symbol,
          status: 'failed',
          error: 'Failed to get swap transaction',
          inputAmount: token.balance,
        });
        continue;
      }
      
      // Deserialize the transaction
      const swapTxBuffer = Buffer.from(swapTxBase64, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTxBuffer);
      
      pendingSwaps.push({ token, quote, transaction, priceImpactPct });
      console.log(`  ✅ ${token.symbol}: Transaction ready (impact: ${priceImpactPct.toFixed(2)}%)`);
      
    } catch (err: any) {
      console.log(`  ❌ ${token.symbol}: ${err.message}`);
      failed.push({
        mint: token.mint,
        symbol: token.symbol,
        status: 'failed',
        error: err.message,
        inputAmount: token.balance,
      });
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  if (pendingSwaps.length === 0) {
    console.log('❌ No transactions to execute');
    return { successful, failed, totalOutputAmount };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: SIGN ALL TRANSACTIONS AT ONCE
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n✍️ STEP 3: Signing ${pendingSwaps.length} transactions...`);
  onProgress?.(`Requesting signature for ${pendingSwaps.length} swaps...`);
  
  let signedTransactions: VersionedTransaction[];
  try {
    const transactions = pendingSwaps.map(s => s.transaction);
    
    // Use signAllTransactions if provided (one approval for all txs)
    if (signAllTransactions) {
      console.log('  📦 Using batch signing (one approval)...');
      signedTransactions = await signAllTransactions(transactions);
    } else {
      // Sign one by one (more clicks but always works)
      console.log('  ⚠️ Signing individually (multiple approvals)...');
      signedTransactions = [];
      for (let i = 0; i < transactions.length; i++) {
        console.log(`    Signing ${i + 1}/${transactions.length}: ${pendingSwaps[i].token.symbol}`);
        signedTransactions.push(await signTransaction(transactions[i]));
      }
    }
    console.log(`  ✅ All ${signedTransactions.length} transactions signed`);
  } catch (err: any) {
    console.error('❌ Signing failed:', err.message);
    // Mark all as failed
    for (const { token } of pendingSwaps) {
      failed.push({
        mint: token.mint,
        symbol: token.symbol,
        status: 'failed',
        error: 'User rejected or signing failed',
        inputAmount: token.balance,
      });
    }
    return { successful, failed, totalOutputAmount };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: SEND ALL TRANSACTIONS IN PARALLEL
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n🚀 STEP 4: Sending ${signedTransactions.length} transactions in parallel...`);
  onProgress?.('Sending transactions...');
  
  const sendPromises = signedTransactions.map(async (signedTx, idx) => {
    const { token, quote } = pendingSwaps[idx];
    
    try {
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      
      console.log(`  📤 ${token.symbol}: Sent ${signature.slice(0, 16)}...`);
      
      return { token, quote, signature, error: null };
    } catch (err: any) {
      console.log(`  ❌ ${token.symbol}: Send failed - ${err.message.slice(0, 40)}`);
      return { token, quote, signature: null, error: err.message };
    }
  });
  
  const sendResults = await Promise.all(sendPromises);
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5: CONFIRM ALL TRANSACTIONS IN PARALLEL
  // ─────────────────────────────────────────────────────────────────────────
  const sentTxs = sendResults.filter(r => r.signature !== null);
  
  if (sentTxs.length > 0) {
    console.log(`\n⏳ STEP 5: Confirming ${sentTxs.length} transactions...`);
    onProgress?.('Confirming transactions...');
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    const confirmPromises = sentTxs.map(async ({ token, quote, signature }) => {
      try {
        const confirmation = await connection.confirmTransaction({
          signature: signature!,
          blockhash,
          lastValidBlockHeight,
        }, 'confirmed');
        
        if (confirmation.value.err) {
          return { token, quote, signature, success: false, error: JSON.stringify(confirmation.value.err) };
        }
        
        console.log(`  ✅ ${token.symbol}: Confirmed!`);
        return { token, quote, signature, success: true, error: null };
        
      } catch (err: any) {
        console.log(`  ❌ ${token.symbol}: Confirmation failed`);
        return { token, quote, signature, success: false, error: err.message };
      }
    });
    
    const confirmResults = await Promise.all(confirmPromises);
    
    // Process results
    for (const result of confirmResults) {
      if (result.success) {
        const outputAmount = BigInt(result.quote.outAmount);
        totalOutputAmount += outputAmount;
        successful.push({
          mint: result.token.mint,
          symbol: result.token.symbol,
          status: 'success',
          signature: result.signature!,
          inputAmount: result.token.balance,
          outputAmount,
        });
      } else {
        failed.push({
          mint: result.token.mint,
          symbol: result.token.symbol,
          status: 'failed',
          error: result.error || 'Transaction failed',
          inputAmount: result.token.balance,
        });
      }
    }
  }
  
  // Add send failures to failed list
  for (const result of sendResults.filter(r => r.signature === null)) {
    failed.push({
      mint: result.token.mint,
      symbol: result.token.symbol,
      status: 'failed',
      error: result.error || 'Send failed',
      inputAmount: result.token.balance,
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ BATCH SWAP COMPLETE`);
  console.log(`   Successful: ${successful.length}`);
  console.log(`   Failed: ${failed.length}`);
  console.log(`   Total output: ${Number(totalOutputAmount) / (10 ** outputDecimals)}`);
  console.log(`${'═'.repeat(60)}`);
  
  return { successful, failed, totalOutputAmount };
}

/**
 * Execute a single swap using Jupiter's /swap endpoint
 * This returns a complete transaction that we just sign and send
 */
async function executeIndividualSwap(
  token: SolanaTokenInfo,
  quote: JupiterQuote,
  _instructions: JupiterSwapInstructions, // Kept for API compatibility
  wallet: PublicKey,
  connection: Connection,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>
): Promise<SwapResult> {
  console.log(`    🔄 ${token.symbol}...`);
  
  try {
    // Get complete transaction from Jupiter's /swap endpoint
    const swapTxBase64 = await getJupiterSwapTransaction(quote, wallet.toString());
    
    if (!swapTxBase64) {
      throw new Error('Failed to get swap transaction from Jupiter');
    }
    
    // Deserialize the transaction
    const swapTxBuffer = Buffer.from(swapTxBase64, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTxBuffer);
    
    // Sign the transaction
    const signedTransaction = await signTransaction(transaction);
    
    // Send and confirm
    const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
    
    console.log(`    📤 Sent: ${signature.slice(0, 20)}...`);
    
    // Wait for confirmation
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    console.log(`    ✅ ${token.symbol} SUCCESS`);
    
    return {
      mint: token.mint,
      symbol: token.symbol,
      status: 'success',
      signature,
      inputAmount: token.balance,
      outputAmount: BigInt(quote.outAmount),
    };
    
  } catch (err: any) {
    console.log(`    ❌ ${token.symbol} FAILED: ${err.message.slice(0, 50)}`);
    
    return {
      mint: token.mint,
      symbol: token.symbol,
      status: 'failed',
      error: err.message,
      inputAmount: token.balance,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  SWAPS_PER_BATCH,
  QUOTE_BATCH_SIZE,
};
