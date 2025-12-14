// ============================================================================
// SOLANA TOKEN SWEEPER - REACT COMPONENT
// ============================================================================
// 
// This component integrates with the Solana wallet adapter and uses
// Jupiter for batch swapping tokens to USDC or SOL.
//
// Features:
// - Token discovery via Helius DAS API
// - Jupiter aggregator for best swap routes
// - Quote preview with price impact analysis
// - Dynamic slippage based on price impact
// - Force mode for high-impact tokens
// - Spam/untradeable token filtering
// - Post-trade results summary
//
// Required packages:
//   npm install @solana/web3.js @solana/wallet-adapter-react 
//   npm install @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets
//
// ============================================================================

'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  Wallet,
  RefreshCw,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Coins,
  ArrowRight,
  Search,
  ExternalLink,
  Zap,
  X,
  XCircle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff
} from 'lucide-react';

// Import our Solana swap implementation
import {
  SolanaTokenInfo,
  JupiterQuote,
  SOLANA_TOKENS,
  discoverSolanaTokens,
  executeBatchSwap,
  getJupiterQuotesBatched,
  getUserHiddenTokens,
  hideToken,
  unhideToken,
  clearUserHiddenTokens,
  calculateDynamicSlippage,
} from './solana-swap';

// ============================================================================
// WALLET ADAPTER CSS FIX
// ============================================================================

const walletAdapterStyles = `
  .wallet-adapter-dropdown {
    z-index: 1000 !important;
  }
  .wallet-adapter-dropdown-list {
    z-index: 1000 !important;
  }
  .wallet-adapter-modal-wrapper {
    z-index: 1000 !important;
  }
  .wallet-adapter-modal {
    z-index: 1000 !important;
  }
`;

// ============================================================================
// TYPES
// ============================================================================

interface QuotePreviewItem {
  token: SolanaTokenInfo;
  quote: JupiterQuote;
  inputValueUsd: number;
  quotedOutputUsd: number;
  priceImpactPct: number;
  slippageBps: number;
  selected: boolean;
  forceHighSlippage: boolean;
  percentage: number; // 0-100, default 100
}

interface FailedQuoteItem {
  token: SolanaTokenInfo;
  error: string;
}

interface QuotePreviewData {
  quotes: QuotePreviewItem[];
  failedQuotes: FailedQuoteItem[];
  outputToken: 'USDC' | 'SOL';
  outputPrice: number;
  outputDecimals: number;
}

interface SwapResultDetail {
  symbol: string;
  mint: string;
  inputValueUsd: number;
  quotedOutputUsd: number;
  priceImpactPct: number;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  signature?: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const EXPLORER_URL = 'https://solscan.io';

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
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SolanaSweeperPage() {
  // Wallet state
  const { publicKey, connected, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();

  // Hydration fix
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // UI state
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Token state
  const [tokens, setTokens] = useState<SolanaTokenInfo[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  
  // Output token
  const [outputToken, setOutputToken] = useState<'USDC' | 'SOL'>('USDC');
  
  // Quote preview state
  const [showQuotePreview, setShowQuotePreview] = useState(false);
  const [quotePreviewData, setQuotePreviewData] = useState<QuotePreviewData | null>(null);
  
  // Results modal state
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [swapResults, setSwapResults] = useState<{
    successful: number;
    failed: number;
    totalValue: number;
    signatures: string[];
  } | null>(null);
  const [detailedResults, setDetailedResults] = useState<SwapResultDetail[]>([]);
  
  // Hidden tokens UI state
  const [showHiddenTokens, setShowHiddenTokens] = useState(false);
  const [userHidden, setUserHidden] = useState<Set<string>>(new Set());
  
  // Custom amounts state - tracks percentage (0-100) per token mint
  const [tokenAmounts, setTokenAmounts] = useState<Map<string, number>>(new Map());

  // Output token config
  const outputConfig = useMemo(() => {
    return outputToken === 'USDC' 
      ? { mint: SOLANA_TOKENS.USDC, decimals: 6, symbol: 'USDC' }
      : { mint: SOLANA_TOKENS.SOL, decimals: 9, symbol: 'SOL' };
  }, [outputToken]);

  // ============================================================================
  // TOKEN SCANNING
  // ============================================================================

  const scanWalletTokens = useCallback(async () => {
    if (!publicKey) return;
    
    setIsScanning(true);
    setError(null);
    setTokens([]);
    
    try {
      setProgressStep('Discovering tokens...');
      
      // Refresh user hidden tokens from localStorage
      const hiddenFromStorage = getUserHiddenTokens();
      console.log('👁 User hidden tokens from localStorage:', hiddenFromStorage.size, [...hiddenFromStorage]);
      setUserHidden(hiddenFromStorage);
      
      const discoveredTokens = await discoverSolanaTokens(
        publicKey.toString(),
        0.10 // Min $0.10 value
      );
      
      setTokens(discoveredTokens);
      
      // Select only tradeable tokens by default (except output token)
      const selectableTokens = discoveredTokens
        .filter(t => t.mint !== outputConfig.mint)
        .filter(t => t.tradeable === true)
        .filter(t => !getUserHiddenTokens().has(t.mint.toLowerCase()))
        .map(t => t.mint);
      setSelectedTokens(new Set(selectableTokens));
      
      setProgressStep('');
      
    } catch (err: any) {
      console.error('Scan error:', err);
      setError(err.message || 'Failed to scan wallet');
    } finally {
      setIsScanning(false);
    }
  }, [publicKey, outputConfig.mint]);

  // Track previous wallet to detect changes
  const [prevWallet, setPrevWallet] = useState<string | null>(null);

  // Auto-scan when wallet connects OR changes
  useEffect(() => {
    if (connected && publicKey) {
      const currentWallet = publicKey.toString();
      
      if (prevWallet !== currentWallet) {
        console.log(`🔄 Wallet changed: ${prevWallet?.slice(0, 8) || 'none'} → ${currentWallet.slice(0, 8)}`);
        setPrevWallet(currentWallet);
        
        setTokens([]);
        setSelectedTokens(new Set());
        setTokenAmounts(new Map()); // Reset custom amounts
        setSwapResults(null);
        setDetailedResults([]);
        setError(null);
        
        scanWalletTokens();
      }
    } else if (!connected) {
      setPrevWallet(null);
      setTokens([]);
      setSelectedTokens(new Set());
      setTokenAmounts(new Map()); // Reset custom amounts
      setSwapResults(null);
      setDetailedResults([]);
    }
  }, [connected, publicKey, scanWalletTokens, prevWallet]);

  // Remove output token from selection when it changes
  useEffect(() => {
    setSelectedTokens(prev => {
      const next = new Set(prev);
      next.delete(outputConfig.mint);
      return next;
    });
  }, [outputConfig.mint]);

  // ============================================================================
  // QUOTE FETCHING & PREVIEW
  // ============================================================================

  const fetchQuotesAndShowPreview = useCallback(async () => {
    if (!publicKey || selectedTokens.size === 0) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      const tokensToSwap = tokens.filter(t => selectedTokens.has(t.mint));
      
      if (tokensToSwap.length === 0) {
        setError('No tokens selected');
        setIsProcessing(false);
        return;
      }

      setProgressStep('Fetching quotes...');
      
      // Apply custom amounts (percentages) to tokens
      const tokensWithCustomAmounts = tokensToSwap.map(token => {
        const percentage = tokenAmounts.get(token.mint) ?? 100;
        if (percentage === 100) return token;
        
        // Calculate adjusted balance
        const adjustedBalance = (token.balance * BigInt(Math.floor(percentage * 100))) / BigInt(10000);
        const adjustedBalanceFormatted = (Number(adjustedBalance) / (10 ** token.decimals)).toFixed(token.decimals > 4 ? 4 : token.decimals);
        const adjustedValueUsd = token.valueUsd * (percentage / 100);
        
        return {
          ...token,
          balance: adjustedBalance,
          balanceFormatted: adjustedBalanceFormatted,
          valueUsd: adjustedValueUsd,
          _originalBalance: token.balance,
          _originalValueUsd: token.valueUsd,
          _percentage: percentage,
        };
      });
      
      // Fetch quotes for all selected tokens with adjusted amounts
      const quotes = await getJupiterQuotesBatched(
        tokensWithCustomAmounts,
        outputConfig.mint,
        100, // Base slippage (dynamic will be applied at execution)
        setProgressStep
      );
      
      // Get output token price (for SOL)
      let outputPrice = 1;
      if (outputToken === 'SOL') {
        try {
          const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
          const data = await res.json();
          outputPrice = data.solana?.usd || 150;
        } catch {
          outputPrice = 150;
        }
      }
      
      const successfulQuotes: QuotePreviewItem[] = [];
      const failedQuotes: FailedQuoteItem[] = [];
      
      for (const token of tokensWithCustomAmounts) {
        const quote = quotes.get(token.mint);
        const percentage = tokenAmounts.get(token.mint) ?? 100;
        
        if (quote) {
          const priceImpactPct = parseFloat(quote.priceImpactPct || '0');
          const outputAmount = Number(quote.outAmount) / (10 ** outputConfig.decimals);
          const quotedOutputUsd = outputAmount * outputPrice;
          const slippageBps = calculateDynamicSlippage(priceImpactPct, false);
          
          successfulQuotes.push({
            token,
            quote,
            inputValueUsd: token.valueUsd,
            quotedOutputUsd,
            priceImpactPct,
            slippageBps,
            selected: priceImpactPct < 10, // Auto-deselect >10% impact
            forceHighSlippage: false,
            percentage,
          });
        } else {
          failedQuotes.push({
            token,
            error: 'No quote available'
          });
        }
      }
      
      // Sort by value (highest first)
      successfulQuotes.sort((a, b) => b.inputValueUsd - a.inputValueUsd);
      
      setQuotePreviewData({
        quotes: successfulQuotes,
        failedQuotes,
        outputToken,
        outputPrice,
        outputDecimals: outputConfig.decimals
      });
      setShowQuotePreview(true);
      
    } catch (err: any) {
      console.error('Quote fetch error:', err);
      setError(err.message || 'Failed to fetch quotes');
    } finally {
      setIsProcessing(false);
      setProgressStep('');
    }
  }, [publicKey, selectedTokens, tokens, outputConfig, outputToken, tokenAmounts]);

  // Toggle quote selection
  const toggleQuoteSelection = useCallback((mint: string) => {
    if (!quotePreviewData) return;
    
    setQuotePreviewData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        quotes: prev.quotes.map(q => 
          q.token.mint === mint 
            ? { ...q, selected: !q.selected }
            : q
        )
      };
    });
  }, [quotePreviewData]);

  // Toggle force high slippage
  const toggleForceSlippage = useCallback((mint: string) => {
    if (!quotePreviewData) return;
    
    setQuotePreviewData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        quotes: prev.quotes.map(q => 
          q.token.mint === mint 
            ? { 
                ...q, 
                forceHighSlippage: !q.forceHighSlippage,
                slippageBps: calculateDynamicSlippage(q.priceImpactPct, !q.forceHighSlippage)
              }
            : q
        )
      };
    });
  }, [quotePreviewData]);

  // ============================================================================
  // SWAP EXECUTION
  // ============================================================================

  const executeConfirmedSwaps = useCallback(async () => {
    if (!publicKey || !signTransaction || !quotePreviewData) return;
    
    const selectedQuotes = quotePreviewData.quotes.filter(q => q.selected);
    
    // Filter: only execute if impact ≤5% OR force is enabled
    const executableQuotes = selectedQuotes.filter(q => 
      q.priceImpactPct <= 5 || q.forceHighSlippage
    );
    const skippedHighImpact = selectedQuotes.filter(q => 
      q.priceImpactPct > 5 && !q.forceHighSlippage
    );
    
    if (executableQuotes.length === 0) {
      setError('All selected tokens have >5% impact and require "Force" to be enabled');
      return;
    }
    
    setShowQuotePreview(false);
    setIsProcessing(true);
    setError(null);
    setSwapResults(null);
    setDetailedResults([]);
    
    const results: SwapResultDetail[] = [];
    
    // Add skipped tokens to results
    for (const sq of skippedHighImpact) {
      results.push({
        symbol: sq.token.symbol,
        mint: sq.token.mint,
        inputValueUsd: sq.inputValueUsd,
        quotedOutputUsd: sq.quotedOutputUsd,
        priceImpactPct: sq.priceImpactPct,
        status: 'skipped',
        error: `${sq.priceImpactPct.toFixed(1)}% impact requires "Force" to swap`
      });
    }
    
    try {
      // Get tokens to swap
      const tokensToSwap = executableQuotes.map(q => q.token);
      
      setProgressStep(`Executing ${tokensToSwap.length} swaps...`);
      
      // Execute batch swap
      const result = await executeBatchSwap(
        tokensToSwap,
        outputConfig.mint,
        outputConfig.decimals,
        publicKey,
        connection,
        signTransaction as (tx: VersionedTransaction) => Promise<VersionedTransaction>,
        100, // Base slippage (dynamic is applied internally)
        setProgressStep,
        signAllTransactions as ((txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>) | undefined
      );
      
      // Calculate total output value
      const { outputPrice } = quotePreviewData;
      const totalOutputNum = Number(result.totalOutputAmount) / (10 ** outputConfig.decimals);
      const totalValueUsd = totalOutputNum * outputPrice;
      
      // Build detailed results
      for (const sq of executableQuotes) {
        const successResult = result.successful.find(r => r.mint === sq.token.mint);
        const failResult = result.failed.find(r => r.mint === sq.token.mint);
        
        if (successResult) {
          results.push({
            symbol: sq.token.symbol,
            mint: sq.token.mint,
            inputValueUsd: sq.inputValueUsd,
            quotedOutputUsd: sq.quotedOutputUsd,
            priceImpactPct: sq.priceImpactPct,
            status: 'success',
            signature: successResult.signature
          });
        } else if (failResult) {
          results.push({
            symbol: sq.token.symbol,
            mint: sq.token.mint,
            inputValueUsd: sq.inputValueUsd,
            quotedOutputUsd: sq.quotedOutputUsd,
            priceImpactPct: sq.priceImpactPct,
            status: 'failed',
            error: failResult.error || 'Unknown error'
          });
        }
      }
      
      // Add failed quotes to results
      for (const fq of quotePreviewData.failedQuotes) {
        results.push({
          symbol: fq.token.symbol,
          mint: fq.token.mint,
          inputValueUsd: fq.token.valueUsd,
          quotedOutputUsd: 0,
          priceImpactPct: 0,
          status: 'skipped',
          error: fq.error
        });
      }
      
      setDetailedResults(results);
      setSwapResults({
        successful: result.successful.length,
        failed: result.failed.length,
        totalValue: totalValueUsd,
        signatures: [...new Set(result.successful.map(r => r.signature).filter(Boolean) as string[])]
      });
      setShowResultsModal(true);
      
      // Refresh token list
      await scanWalletTokens();
      
    } catch (err: any) {
      console.error('Swap error:', err);
      setError(err.message || 'Swap failed');
    } finally {
      setIsProcessing(false);
      setProgressStep('');
      setQuotePreviewData(null);
    }
  }, [publicKey, signTransaction, signAllTransactions, quotePreviewData, outputConfig, connection, scanWalletTokens]);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  const { tradeableTokens, hiddenTokens } = useMemo(() => {
    const outputMint = outputConfig.mint;
    
    const tradeable: SolanaTokenInfo[] = [];
    const hiddenList: SolanaTokenInfo[] = [];
    
    for (const token of tokens) {
      if (token.mint === outputMint) continue;
      
      // Use userHidden state (not getUserHiddenTokens()) so React tracks changes
      const isHidden = userHidden.has(token.mint.toLowerCase());
      const isUntradeable = token.tradeable === false;
      
      if (isHidden || isUntradeable) {
        hiddenList.push(token);
      } else {
        tradeable.push(token);
      }
    }
    
    return { tradeableTokens: tradeable, hiddenTokens: hiddenList };
  }, [tokens, outputConfig.mint, userHidden]);

  const displayTokens = useMemo(() => tradeableTokens, [tradeableTokens]);

  const totalSelectedValue = useMemo(() => {
    return tokens
      .filter(t => selectedTokens.has(t.mint))
      .reduce((sum, t) => {
        const percentage = tokenAmounts.get(t.mint) ?? 100;
        return sum + (t.valueUsd * percentage / 100);
      }, 0);
  }, [tokens, selectedTokens, tokenAmounts]);

  const selectedCount = useMemo(() => {
    return [...selectedTokens].filter(mint => mint !== outputConfig.mint).length;
  }, [selectedTokens, outputConfig.mint]);

  // Check if any tokens have custom amounts
  const hasCustomAmounts = useMemo(() => {
    return [...selectedTokens].some(mint => {
      const pct = tokenAmounts.get(mint);
      return pct !== undefined && pct < 100;
    });
  }, [selectedTokens, tokenAmounts]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-purple-950">
      <style dangerouslySetInnerHTML={{ __html: walletAdapterStyles }} />
      
      {/* ================================================================== */}
      {/* QUOTE PREVIEW MODAL */}
      {/* ================================================================== */}
      {showQuotePreview && quotePreviewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl"
          >
            {/* Header */}
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
              
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Input Value</p>
                  <p className="text-lg font-bold text-white">
                    {formatUSD(quotePreviewData.quotes
                      .filter(q => q.selected)
                      .reduce((sum, q) => sum + q.inputValueUsd, 0))}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">You'll Receive</p>
                  <p className="text-lg font-bold text-purple-400">
                    {formatUSD(quotePreviewData.quotes
                      .filter(q => q.selected)
                      .reduce((sum, q) => sum + q.quotedOutputUsd, 0))}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Avg Price Impact</p>
                  {(() => {
                    const selectedQuotes = quotePreviewData.quotes.filter(q => q.selected);
                    const totalInput = selectedQuotes.reduce((sum, q) => sum + q.inputValueUsd, 0);
                    const weightedImpact = totalInput > 0 
                      ? selectedQuotes.reduce((sum, q) => sum + (q.priceImpactPct * q.inputValueUsd), 0) / totalInput
                      : 0;
                    return (
                      <p className={`text-lg font-bold ${
                        weightedImpact > 5 ? 'text-red-400' : 
                        weightedImpact > 2 ? 'text-yellow-400' : 
                        'text-green-400'
                      }`}>
                        {weightedImpact > 0.01 ? `-${weightedImpact.toFixed(2)}%` : '~0%'}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>
            
            {/* Quote List */}
            <div className="overflow-y-auto max-h-[400px] p-4">
              <table className="w-full">
                <thead className="text-xs text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="text-left pb-3 pl-2">Include</th>
                    <th className="text-left pb-3">Token</th>
                    <th className="text-right pb-3">Input</th>
                    <th className="text-right pb-3">Output</th>
                    <th className="text-right pb-3 pr-2">Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {quotePreviewData.quotes.map((q, idx) => (
                    <tr 
                      key={idx} 
                      className={`hover:bg-slate-700/30 transition-colors ${!q.selected ? 'opacity-50' : ''}`}
                    >
                      <td className="py-3 pl-2">
                        <input
                          type="checkbox"
                          checked={q.selected}
                          onChange={() => toggleQuoteSelection(q.token.mint)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-purple-500 focus:ring-purple-500"
                        />
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {q.priceImpactPct > 5 ? (
                            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          ) : q.priceImpactPct > 2 ? (
                            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                          )}
                          <span className="font-medium text-white">{q.token.symbol}</span>
                          {q.percentage < 100 && (
                            <span className="text-xs text-purple-400 bg-purple-500/20 px-1.5 py-0.5 rounded">
                              {q.percentage}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-slate-300">{formatUSD(q.inputValueUsd)}</span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-purple-400 font-medium">{formatUSD(q.quotedOutputUsd)}</span>
                      </td>
                      <td className="py-3 text-right pr-2">
                        <div className="flex items-center justify-end gap-2">
                          <span className={`font-medium ${
                            q.priceImpactPct > 5 ? 'text-red-400' : 
                            q.priceImpactPct > 2 ? 'text-yellow-400' : 
                            'text-green-400'
                          }`}>
                            {q.priceImpactPct > 0.01 ? `-${q.priceImpactPct.toFixed(2)}%` : '~0%'}
                          </span>
                          {q.priceImpactPct > 5 && q.selected && (
                            <button
                              onClick={() => toggleForceSlippage(q.token.mint)}
                              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                q.forceHighSlippage
                                  ? 'bg-orange-500/30 text-orange-300 border border-orange-500/50'
                                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-300'
                              }`}
                              title={q.forceHighSlippage 
                                ? `Slippage: ${q.slippageBps}bps` 
                                : 'Click to allow higher slippage'}
                            >
                              {q.forceHighSlippage ? '⚠️ Forced' : 'Force'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  
                  {/* Failed Quotes */}
                  {quotePreviewData.failedQuotes.map((fq, idx) => (
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
            </div>
            
            {/* Warning for high impact tokens */}
            {quotePreviewData.quotes.some(q => q.selected && q.priceImpactPct > 5) && (
              <div className="mx-4 mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {quotePreviewData.quotes.some(q => q.selected && q.priceImpactPct > 5 && !q.forceHighSlippage) 
                      ? <>High-impact tokens ({quotePreviewData.quotes.filter(q => q.selected && q.priceImpactPct > 5 && !q.forceHighSlippage).length}) require "Force" to swap.</>
                      : <>Some tokens have &gt;5% price impact.</>
                    }
                  </span>
                </div>
                {quotePreviewData.quotes.some(q => q.selected && q.forceHighSlippage) && (
                  <div className="mt-2 text-xs text-orange-400">
                    ⚠️ Force enabled for {quotePreviewData.quotes.filter(q => q.selected && q.forceHighSlippage).length} token(s) - higher slippage will be used
                  </div>
                )}
              </div>
            )}
            
            {/* Actions */}
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
                disabled={!quotePreviewData.quotes.some(q => q.selected && (q.priceImpactPct <= 5 || q.forceHighSlippage))}
                className="flex-1 py-3 px-4 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200"
              >
                {(() => {
                  const executable = quotePreviewData.quotes.filter(q => q.selected && (q.priceImpactPct <= 5 || q.forceHighSlippage)).length;
                  const skipped = quotePreviewData.quotes.filter(q => q.selected && q.priceImpactPct > 5 && !q.forceHighSlippage).length;
                  return skipped > 0 
                    ? `Confirm Sweep (${executable} tokens, ${skipped} skipped)`
                    : `Confirm Sweep (${executable} tokens)`;
                })()}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      
      {/* ================================================================== */}
      {/* RESULTS MODAL */}
      {/* ================================================================== */}
      {showResultsModal && swapResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="p-6 border-b border-slate-700 bg-gradient-to-r from-purple-500/10 to-pink-500/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
                    <CheckCircle className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Sweep Complete</h3>
                    <p className="text-sm text-slate-400">
                      {swapResults.successful} successful, {swapResults.failed} failed
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
              
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Total Input</p>
                  <p className="text-lg font-bold text-white">
                    {formatUSD(detailedResults
                      .filter(r => r.status === 'success')
                      .reduce((sum, r) => sum + r.inputValueUsd, 0))}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Received</p>
                  <p className="text-lg font-bold text-purple-400">
                    {formatUSD(swapResults.totalValue)}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Success Rate</p>
                  <p className="text-lg font-bold text-green-400">
                    {swapResults.successful + swapResults.failed > 0 
                      ? `${Math.round((swapResults.successful / (swapResults.successful + swapResults.failed)) * 100)}%`
                      : '—'}
                  </p>
                </div>
              </div>
              
              {/* Transaction Links */}
              {swapResults.signatures.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {swapResults.signatures.slice(0, 5).map((sig, idx) => (
                    <a
                      key={idx}
                      href={`${EXPLORER_URL}/tx/${sig}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 px-2 py-1 rounded"
                    >
                      <ExternalLink className="w-3 h-3" />
                      TX {idx + 1}
                    </a>
                  ))}
                  {swapResults.signatures.length > 5 && (
                    <span className="text-xs text-slate-400">
                      +{swapResults.signatures.length - 5} more
                    </span>
                  )}
                </div>
              )}
            </div>
            
            {/* Results List */}
            <div className="overflow-y-auto max-h-[400px] p-4">
              <table className="w-full">
                <thead className="text-xs text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="text-left pb-3 pl-2">Token</th>
                    <th className="text-right pb-3">Input</th>
                    <th className="text-right pb-3">Output</th>
                    <th className="text-right pb-3 pr-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {detailedResults.map((result, idx) => (
                    <tr 
                      key={idx} 
                      className={`${result.status === 'failed' || result.status === 'skipped' ? 'opacity-60' : ''} hover:bg-slate-700/30 transition-colors`}
                    >
                      <td className="py-3 pl-2">
                        <div className="flex items-center gap-2">
                          {result.status === 'success' ? (
                            <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                          ) : result.status === 'failed' ? (
                            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          )}
                          <span className="font-medium text-white">{result.symbol}</span>
                        </div>
                        {result.error && (
                          <p className="text-xs text-red-400 mt-1 ml-6 truncate max-w-[200px]" title={result.error}>
                            {result.error}
                          </p>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-slate-400">{formatUSD(result.inputValueUsd)}</span>
                      </td>
                      <td className="py-3 text-right">
                        {result.status === 'success' ? (
                          <span className="text-purple-400 font-medium">{formatUSD(result.quotedOutputUsd)}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right pr-2">
                        <span className={`text-xs px-2 py-1 rounded ${
                          result.status === 'success' 
                            ? 'bg-green-500/20 text-green-400' 
                            : result.status === 'failed'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {result.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Close Button */}
            <div className="p-4 border-t border-slate-700 bg-slate-900/50">
              <button
                onClick={() => setShowResultsModal(false)}
                className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-semibold rounded-xl transition-all duration-200"
              >
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ================================================================== */}
      {/* BACKGROUND */}
      {/* ================================================================== */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}
      <header className="relative z-50 border-b border-slate-800/50 backdrop-blur-xl bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Solana Sweeper</h1>
                <p className="text-xs text-slate-400">Batch swap to USDC or SOL</p>
              </div>
            </div>
            
            <div className="relative z-50">
              {mounted ? (
                <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
              ) : (
                <button className="wallet-adapter-button !bg-purple-600 hover:!bg-purple-700" disabled>
                  Select Wallet
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ================================================================== */}
      {/* MAIN CONTENT */}
      {/* ================================================================== */}
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8">
        
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Sweep Solana Tokens
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Convert multiple SPL tokens to USDC or SOL using Jupiter aggregator.
            Preview quotes and manage slippage before executing.
          </p>
        </motion.div>

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl overflow-hidden"
        >
          {/* Not Connected State */}
          {!connected && (
            <div className="p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-700/50 flex items-center justify-center">
                <Wallet className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Connect Your Wallet</h3>
              <p className="text-slate-400 mb-6">Connect a Solana wallet to scan for tokens</p>
              {mounted && <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />}
            </div>
          )}

          {/* Connected State */}
          {connected && publicKey && (
            <>
              {/* Controls Bar */}
              <div className="p-4 border-b border-slate-700/50 bg-slate-900/30">
                <div className="flex flex-wrap items-center gap-4">
                  {/* Scan Button */}
                  <button
                    onClick={scanWalletTokens}
                    disabled={isScanning || isProcessing}
                    className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium transition"
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
                  
                  {/* Unhide All Button - only shows if there are user-hidden tokens */}
                  {userHidden && userHidden.size > 0 ? (
                    <button
                      onClick={() => {
                        console.log('🧹 Clearing user hidden tokens:', [...userHidden]);
                        clearUserHiddenTokens();
                        setUserHidden(new Set());
                      }}
                      disabled={isScanning || isProcessing}
                      className="flex items-center gap-2 px-3 py-2.5 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition"
                      title="Unhide all user-hidden tokens"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Unhide All ({userHidden.size})
                    </button>
                  ) : null}

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
                      onClick={() => setOutputToken('SOL')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                        outputToken === 'SOL'
                          ? 'bg-purple-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      → SOL
                    </button>
                  </div>

                  {/* Network Badge + Stats */}
                  <div className="ml-auto flex items-center gap-3">
                    {tokens.length > 0 && (
                      <div className="text-xs text-slate-500">
                        ✅ {tradeableTokens.length} tradeable
                        {hiddenTokens.length > 0 && (
                          <>
                            {' · '}
                            {hiddenTokens.filter(t => t.tradeable === false).length > 0 && (
                              <span className="text-red-400">
                                ⛔ {hiddenTokens.filter(t => t.tradeable === false).length} no liquidity
                              </span>
                            )}
                            {userHidden.size > 0 && hiddenTokens.filter(t => t.tradeable === false).length > 0 && ' · '}
                            {userHidden.size > 0 && (
                              <span className="text-orange-400">
                                👁 {userHidden.size} hidden
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/50 rounded-lg">
                      <div className="w-2 h-2 rounded-full bg-purple-400" />
                      <span className="text-sm text-slate-300">Solana</span>
                    </div>
                  </div>
                </div>
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
                    <Loader2 className="w-10 h-10 text-purple-400 mx-auto mb-4 animate-spin" />
                    <p className="text-slate-300">{progressStep || 'Scanning...'}</p>
                  </div>
                )}

                {tokens.length > 0 && (
                  <>
                    {/* Select All / None / Reset Amounts */}
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm text-slate-400">
                        {selectedCount} of {displayTokens.length} tradeable tokens selected
                        {hasCustomAmounts && (
                          <span className="text-purple-400 ml-2">(custom amounts)</span>
                        )}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSelectedTokens(new Set(displayTokens.map(t => t.mint)))}
                          className="text-xs text-purple-400 hover:text-purple-300"
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
                        {hasCustomAmounts && (
                          <>
                            <span className="text-slate-600">|</span>
                            <button
                              onClick={() => setTokenAmounts(new Map())}
                              className="text-xs text-orange-400 hover:text-orange-300"
                            >
                              Reset Amounts
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Token Grid - Tradeable */}
                    <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
                      {displayTokens.length === 0 ? (
                        <div className="py-8 text-center">
                          <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                          <p className="text-slate-400">No tradeable tokens found</p>
                          <p className="text-xs text-slate-500 mt-1">All tokens are either untradeable or hidden</p>
                        </div>
                      ) : (
                        displayTokens.map((token) => {
                          const isSelected = selectedTokens.has(token.mint);
                          const percentage = tokenAmounts.get(token.mint) ?? 100;
                          const adjustedValue = token.valueUsd * (percentage / 100);
                          
                          return (
                            <motion.div
                              key={token.mint}
                              layout
                              className={`p-3 rounded-xl border transition ${
                                isSelected 
                                  ? 'bg-slate-800 border-purple-500/50' 
                                  : 'bg-slate-800/30 border-transparent opacity-60'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => {
                                    const next = new Set(selectedTokens);
                                    if (next.has(token.mint)) {
                                      next.delete(token.mint);
                                    } else {
                                      next.add(token.mint);
                                    }
                                    setSelectedTokens(next);
                                  }}
                                  className={`w-5 h-5 rounded flex items-center justify-center border transition ${
                                    isSelected 
                                      ? 'bg-purple-500 border-purple-500' 
                                      : 'border-slate-600 hover:border-slate-500'
                                  }`}
                                >
                                  {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                </button>

                                {token.logoUrl && (
                                  <img 
                                    src={token.logoUrl} 
                                    alt={token.symbol}
                                    className="w-8 h-8 rounded-full"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                                )}

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-white">{token.symbol}</span>
                                    <span className="text-xs text-slate-500">{shortenAddress(token.mint)}</span>
                                    {percentage < 100 && (
                                      <span className="text-xs text-purple-400 bg-purple-500/20 px-1.5 py-0.5 rounded">
                                        {percentage}%
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-sm text-slate-400">
                                    Balance: {token.balanceFormatted}
                                    {percentage < 100 && (
                                      <span className="text-purple-400 ml-1">
                                        → {(parseFloat(token.balanceFormatted) * percentage / 100).toFixed(4)}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="text-right">
                                  <div className="text-purple-400 font-medium">
                                    {percentage < 100 ? (
                                      <>
                                        <span className="text-slate-500 line-through mr-1">{formatUSD(token.valueUsd)}</span>
                                        {formatUSD(adjustedValue)}
                                      </>
                                    ) : (
                                      formatUSD(token.valueUsd)
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    @ ${formatNumber(token.price, 4)}
                                  </div>
                                </div>
                                
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    hideToken(token.mint);
                                    setUserHidden(prev => {
                                      const next = new Set(prev);
                                      next.add(token.mint.toLowerCase());
                                      return next;
                                    });
                                    setSelectedTokens(prev => {
                                      const next = new Set(prev);
                                      next.delete(token.mint);
                                      return next;
                                    });
                                  }}
                                  className="ml-2 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition"
                                  title="Hide this token"
                                >
                                  <EyeOff className="w-4 h-4" />
                                </button>
                              </div>
                              
                              {/* Amount Controls - show when selected */}
                              {isSelected && (
                                <div className="mt-3 pt-3 border-t border-slate-700/30">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400 mr-1">Amount:</span>
                                    {[25, 50, 75, 100].map((pct) => (
                                      <button
                                        key={pct}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setTokenAmounts(prev => {
                                            const next = new Map(prev);
                                            if (pct === 100) {
                                              next.delete(token.mint);
                                            } else {
                                              next.set(token.mint, pct);
                                            }
                                            return next;
                                          });
                                        }}
                                        className={`px-2 py-1 text-xs rounded transition ${
                                          percentage === pct
                                            ? 'bg-purple-500 text-white'
                                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                        }`}
                                      >
                                        {pct === 100 ? 'Max' : `${pct}%`}
                                      </button>
                                    ))}
                                    <input
                                      type="number"
                                      min="1"
                                      max="100"
                                      value={percentage}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const val = Math.min(100, Math.max(1, parseInt(e.target.value) || 100));
                                        setTokenAmounts(prev => {
                                          const next = new Map(prev);
                                          if (val === 100) {
                                            next.delete(token.mint);
                                          } else {
                                            next.set(token.mint, val);
                                          }
                                          return next;
                                        });
                                      }}
                                      className="w-16 px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-white text-center focus:outline-none focus:border-purple-500"
                                    />
                                    <span className="text-xs text-slate-500">%</span>
                                  </div>
                                </div>
                              )}
                            </motion.div>
                          );
                        })
                      )}
                    </div>
                    
                    {/* Hidden Tokens Dropdown */}
                    {hiddenTokens.length > 0 && (
                      <div className="mt-4 border-t border-slate-700/50 pt-4">
                        <button
                          onClick={() => setShowHiddenTokens(!showHiddenTokens)}
                          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 mb-2"
                        >
                          {showHiddenTokens ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                          <EyeOff className="w-4 h-4" />
                          {hiddenTokens.length} hidden/untradeable token{hiddenTokens.length !== 1 ? 's' : ''}
                        </button>
                        
                        {showHiddenTokens && (
                          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
                            {hiddenTokens.map((token) => {
                              const isUserHidden = userHidden.has(token.mint.toLowerCase());
                              
                              return (
                                <div
                                  key={token.mint}
                                  className="p-3 rounded-xl bg-slate-800/20 border border-slate-700/30 opacity-60"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-5 h-5 flex items-center justify-center">
                                      {isUserHidden ? (
                                        <EyeOff className="w-4 h-4 text-orange-400" />
                                      ) : (
                                        <XCircle className="w-4 h-4 text-red-400" />
                                      )}
                                    </div>

                                    {token.logoUrl && (
                                      <img 
                                        src={token.logoUrl} 
                                        alt={token.symbol}
                                        className="w-8 h-8 rounded-full opacity-50"
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                      />
                                    )}

                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-white">{token.symbol}</span>
                                        <span className="text-xs text-slate-500">{shortenAddress(token.mint)}</span>
                                        {isUserHidden ? (
                                          <span className="text-xs text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded">
                                            User hidden
                                          </span>
                                        ) : (
                                          <span className="text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                                            {token.tradeError || 'No liquidity'}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-sm text-slate-500">
                                        Balance: {token.balanceFormatted}
                                      </div>
                                    </div>

                                    <div className="text-right">
                                      <div className="text-slate-500 font-medium">
                                        {token.price > 0 ? formatUSD(token.valueUsd) : '???'}
                                      </div>
                                    </div>
                                    
                                    {isUserHidden && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          unhideToken(token.mint);
                                          setUserHidden(prev => {
                                            const next = new Set(prev);
                                            next.delete(token.mint.toLowerCase());
                                            return next;
                                          });
                                        }}
                                        className="ml-2 p-1.5 text-slate-500 hover:text-green-400 hover:bg-green-400/10 rounded-lg transition"
                                        title="Unhide this token"
                                      >
                                        <Eye className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Action Footer */}
              {tokens.length > 0 && (
                <div className="p-4 border-t border-slate-700/50 bg-slate-900/30">
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

                  <button
                    onClick={fetchQuotesAndShowPreview}
                    disabled={isProcessing || selectedCount === 0}
                    className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-lg transition flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {progressStep || 'Processing...'}
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-5 h-5" />
                        Preview Quotes ({selectedCount} Token{selectedCount !== 1 ? 's' : ''})
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

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <div className="p-4 bg-slate-800/30 backdrop-blur border border-slate-700/50 rounded-xl">
            <Coins className="w-6 h-6 text-purple-400 mb-2" />
            <h3 className="font-medium text-white mb-1">Batch Swaps</h3>
            <p className="text-sm text-slate-400">
              Multiple swaps executed in parallel for speed
            </p>
          </div>
          <div className="p-4 bg-slate-800/30 backdrop-blur border border-slate-700/50 rounded-xl">
            <Zap className="w-6 h-6 text-blue-400 mb-2" />
            <h3 className="font-medium text-white mb-1">Jupiter Aggregator</h3>
            <p className="text-sm text-slate-400">
              Best routes across all Solana DEXs
            </p>
          </div>
          <div className="p-4 bg-slate-800/30 backdrop-blur border border-slate-700/50 rounded-xl">
            <RefreshCw className="w-6 h-6 text-pink-400 mb-2" />
            <h3 className="font-medium text-white mb-1">Dynamic Slippage</h3>
            <p className="text-sm text-slate-400">
              Slippage auto-adjusts based on price impact
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
