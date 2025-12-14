// ============================================================================
// HELIUS TOKEN DISCOVERY
// ============================================================================
// Uses Helius DAS API to discover all SPL tokens in a wallet
// Much easier than EVM - returns balances AND prices in one call!

import { HELIUS_API, SOLANA_TOKENS, SOLANA_BATCH_CONFIG, type SolanaTokenInfo } from './config';

// Get Helius API key from environment or use public endpoint
function getHeliusApiKey(): string {
  if (typeof window !== 'undefined') {
    // Client-side: use API route
    return '';
  }
  return process.env.HELIUS_API_KEY || '';
}

// Helius balance response type
interface HeliusTokenBalance {
  mint: string;
  amount: number;
  decimals: number;
  tokenAccount: string;
  // From DAS metadata
  name?: string;
  symbol?: string;
  logoURI?: string;
  // Price info (if available)
  price?: number;
  priceUsd?: number;
}

interface HeliusBalanceResponse {
  nativeBalance: number;
  tokens: HeliusTokenBalance[];
}

/**
 * Fetch all token balances for a wallet using Helius
 */
export async function fetchSolanaTokens(
  walletAddress: string,
  heliusApiKey?: string
): Promise<SolanaTokenInfo[]> {
  const apiKey = heliusApiKey || getHeliusApiKey();
  
  console.log('🔍 Fetching Solana tokens via Helius...');
  
  try {
    // Use the balances endpoint which includes token metadata
    const url = apiKey 
      ? `${HELIUS_API.BASE_URL}/addresses/${walletAddress}/balances?api-key=${apiKey}`
      : `/api/helius/balances?wallet=${walletAddress}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status}`);
    }
    
    const data: HeliusBalanceResponse = await response.json();
    
    console.log(`  📦 Found ${data.tokens?.length || 0} SPL tokens`);
    
    // Convert to our token format
    const tokens: SolanaTokenInfo[] = [];
    
    // Add native SOL if balance > 0
    if (data.nativeBalance > 0) {
      const solBalance = BigInt(Math.floor(data.nativeBalance));
      const solBalanceNum = data.nativeBalance / 1e9;
      
      // We'll fetch SOL price separately or use Jupiter
      tokens.push({
        mint: SOLANA_TOKENS.SOL,
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        balance: solBalance,
        balanceFormatted: solBalanceNum.toFixed(4),
        price: 0, // Will be filled in by price fetching
        valueUsd: 0,
        logoUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      });
    }
    
    // Add SPL tokens
    for (const token of data.tokens || []) {
      if (token.amount <= 0) continue;
      
      const balance = BigInt(Math.floor(token.amount * (10 ** token.decimals)));
      const balanceNum = token.amount;
      
      tokens.push({
        mint: token.mint,
        symbol: token.symbol || 'Unknown',
        name: token.name || 'Unknown Token',
        decimals: token.decimals,
        balance,
        balanceFormatted: formatBalance(balanceNum),
        price: token.price || token.priceUsd || 0,
        valueUsd: balanceNum * (token.price || token.priceUsd || 0),
        logoUrl: token.logoURI,
      });
    }
    
    console.log(`  ✅ Processed ${tokens.length} tokens with balance`);
    
    return tokens;
    
  } catch (error: any) {
    console.error('Helius token fetch error:', error);
    throw error;
  }
}

/**
 * Alternative: Fetch using Helius getAssetsByOwner (DAS API)
 * More detailed metadata but slightly more complex
 */
export async function fetchSolanaTokensDAS(
  walletAddress: string,
  heliusApiKey?: string
): Promise<SolanaTokenInfo[]> {
  const apiKey = heliusApiKey || getHeliusApiKey();
  
  if (!apiKey) {
    throw new Error('Helius API key required for DAS API');
  }
  
  console.log('🔍 Fetching Solana tokens via Helius DAS API...');
  
  try {
    const response = await fetch(`${HELIUS_API.RPC_URL}/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'token-sweep',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: walletAddress,
          page: 1,
          limit: 1000,
          displayOptions: {
            showFungible: true,
            showNativeBalance: true,
          },
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Helius DAS API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'DAS API error');
    }
    
    const assets = data.result?.items || [];
    const nativeBalance = data.result?.nativeBalance?.lamports || 0;
    
    console.log(`  📦 Found ${assets.length} assets`);
    
    const tokens: SolanaTokenInfo[] = [];
    
    // Add native SOL
    if (nativeBalance > 0) {
      const solBalanceNum = nativeBalance / 1e9;
      tokens.push({
        mint: SOLANA_TOKENS.SOL,
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        balance: BigInt(nativeBalance),
        balanceFormatted: solBalanceNum.toFixed(4),
        price: 0,
        valueUsd: 0,
        logoUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      });
    }
    
    // Process fungible assets
    for (const asset of assets) {
      if (asset.interface !== 'FungibleToken' && asset.interface !== 'FungibleAsset') {
        continue;
      }
      
      const tokenInfo = asset.token_info;
      if (!tokenInfo || tokenInfo.balance <= 0) continue;
      
      const decimals = tokenInfo.decimals || 0;
      const balance = BigInt(tokenInfo.balance);
      const balanceNum = Number(balance) / (10 ** decimals);
      
      tokens.push({
        mint: asset.id,
        symbol: tokenInfo.symbol || asset.content?.metadata?.symbol || 'Unknown',
        name: asset.content?.metadata?.name || 'Unknown Token',
        decimals,
        balance,
        balanceFormatted: formatBalance(balanceNum),
        price: tokenInfo.price_info?.price_per_token || 0,
        valueUsd: tokenInfo.price_info?.total_price || (balanceNum * (tokenInfo.price_info?.price_per_token || 0)),
        logoUrl: asset.content?.links?.image || asset.content?.files?.[0]?.uri,
      });
    }
    
    console.log(`  ✅ Processed ${tokens.length} fungible tokens`);
    
    return tokens;
    
  } catch (error: any) {
    console.error('Helius DAS API error:', error);
    throw error;
  }
}

/**
 * Fetch prices for tokens that don't have them
 * Uses Jupiter price API
 */
export async function fetchSolanaPrices(
  mints: string[]
): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  
  console.log(`💰 Fetching prices for ${mints.length} Solana tokens...`);
  
  try {
    // Jupiter price API
    const ids = mints.join(',');
    const response = await fetch(`https://price.jup.ag/v6/price?ids=${ids}`);
    
    if (!response.ok) {
      console.warn('Jupiter price API error:', response.status);
      return {};
    }
    
    const data = await response.json();
    const prices: Record<string, number> = {};
    
    for (const [mint, priceData] of Object.entries<any>(data.data || {})) {
      if (priceData?.price) {
        prices[mint] = priceData.price;
      }
    }
    
    console.log(`  ✅ Got ${Object.keys(prices).length} prices`);
    
    return prices;
    
  } catch (error: any) {
    console.warn('Price fetch error:', error);
    return {};
  }
}

/**
 * Enrich tokens with prices and filter by minimum value
 */
export async function enrichTokensWithPrices(
  tokens: SolanaTokenInfo[],
  minValueUsd: number = SOLANA_BATCH_CONFIG.MIN_VALUE_USD
): Promise<SolanaTokenInfo[]> {
  // Find tokens missing prices
  const tokensNeedingPrices = tokens.filter(t => t.price === 0);
  
  if (tokensNeedingPrices.length > 0) {
    const mints = tokensNeedingPrices.map(t => t.mint);
    const prices = await fetchSolanaPrices(mints);
    
    // Update tokens with fetched prices
    for (const token of tokens) {
      if (token.price === 0 && prices[token.mint]) {
        token.price = prices[token.mint];
        const balanceNum = Number(token.balance) / (10 ** token.decimals);
        token.valueUsd = balanceNum * token.price;
      }
    }
  }
  
  // Filter by minimum value and sort by value descending
  return tokens
    .filter(t => t.valueUsd >= minValueUsd)
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

// Helper to format balance nicely
function formatBalance(num: number): string {
  if (num === 0) return '0';
  if (num < 0.0001) return '< 0.0001';
  if (num < 1) return num.toFixed(6);
  if (num < 1000) return num.toFixed(4);
  if (num < 1000000) return `${(num / 1000).toFixed(2)}K`;
  return `${(num / 1000000).toFixed(2)}M`;
}
