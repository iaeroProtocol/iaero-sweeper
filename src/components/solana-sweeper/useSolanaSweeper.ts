// ============================================================================
// SOLANA SWEEPER REACT HOOK
// ============================================================================
// Custom hook that handles all Solana sweeper logic

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { 
  fetchSolanaTokens, 
  enrichTokensWithPrices 
} from './helius';
import { 
  executeSolanaBatchSwap,
  getJupiterQuote,
} from './jupiter';
import { 
  SOLANA_TOKENS, 
  SOLANA_BATCH_CONFIG,
  type SolanaTokenInfo,
  type SolanaSwapResult,
} from './config';

export interface UseSolanaSweeperReturn {
  // State
  tokens: SolanaTokenInfo[];
  selectedTokens: Set<string>;
  isScanning: boolean;
  isProcessing: boolean;
  progressStep: string;
  error: string | null;
  swapResults: SolanaSwapResult[] | null;
  outputToken: 'USDC' | 'SOL';
  
  // Computed
  totalSelectedValue: number;
  selectedCount: number;
  
  // Actions
  scanWallet: (forceRefresh?: boolean) => Promise<void>;
  toggleToken: (mint: string) => void;
  selectAll: () => void;
  selectNone: () => void;
  setOutputToken: (token: 'USDC' | 'SOL') => void;
  executeSwap: () => Promise<void>;
  clearError: () => void;
  clearResults: () => void;
}

export function useSolanaSweeper(): UseSolanaSweeperReturn {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  
  // Token state
  const [tokens, setTokens] = useState<SolanaTokenInfo[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  
  // UI state
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [swapResults, setSwapResults] = useState<SolanaSwapResult[] | null>(null);
  
  // Output token
  const [outputToken, setOutputToken] = useState<'USDC' | 'SOL'>('USDC');
  
  // Clear state when wallet disconnects
  useEffect(() => {
    if (!connected) {
      setTokens([]);
      setSelectedTokens(new Set());
      setError(null);
      setSwapResults(null);
    }
  }, [connected]);
  
  // Scan wallet for tokens
  const scanWallet = useCallback(async (forceRefresh = false) => {
    if (!publicKey || !connected) {
      setError('Wallet not connected');
      return;
    }
    
    // Capture publicKey at start to handle disconnects during scan
    const scanPublicKey = publicKey.toString();
    
    setIsScanning(true);
    setError(null);
    setTokens([]);
    setSelectedTokens(new Set());
    
    try {
      setProgressStep('Fetching token balances...');
      
      // Fetch tokens from Helius
      let tokenList = await fetchSolanaTokens(scanPublicKey);
      
      // Check if wallet changed during fetch
      if (publicKey?.toString() !== scanPublicKey) {
        console.log('⚠️ Wallet changed during scan, aborting');
        return;
      }
      
      setProgressStep('Fetching prices...');
      
      // Enrich with prices and filter dust
      tokenList = await enrichTokensWithPrices(
        tokenList,
        SOLANA_BATCH_CONFIG.MIN_VALUE_USD
      );
      
      // Check again
      if (publicKey?.toString() !== scanPublicKey) {
        console.log('⚠️ Wallet changed during scan, aborting');
        return;
      }
      
      console.log(`✅ Found ${tokenList.length} tokens with value >= $${SOLANA_BATCH_CONFIG.MIN_VALUE_USD}`);
      
      // Update state
      setTokens(tokenList);
      setSelectedTokens(new Set(tokenList.map(t => t.mint)));
      
    } catch (err: any) {
      console.error('Scan error:', err);
      setError(err.message || 'Failed to scan wallet');
    } finally {
      setIsScanning(false);
      setProgressStep('');
    }
  }, [publicKey, connected]);
  
  // Token selection
  const toggleToken = useCallback((mint: string) => {
    setSelectedTokens(prev => {
      const next = new Set(prev);
      if (next.has(mint)) {
        next.delete(mint);
      } else {
        next.add(mint);
      }
      return next;
    });
  }, []);
  
  const selectAll = useCallback(() => {
    const outputMint = outputToken === 'USDC' ? SOLANA_TOKENS.USDC : SOLANA_TOKENS.SOL;
    setSelectedTokens(new Set(
      tokens
        .filter(t => t.mint !== outputMint)
        .map(t => t.mint)
    ));
  }, [tokens, outputToken]);
  
  const selectNone = useCallback(() => {
    setSelectedTokens(new Set());
  }, []);
  
  // Execute swap
  const executeSwap = useCallback(async () => {
    if (!publicKey || !signTransaction || !connected) {
      setError('Wallet not connected');
      return;
    }
    
    if (selectedTokens.size === 0) {
      setError('No tokens selected');
      return;
    }
    
    const outputMint = outputToken === 'USDC' ? SOLANA_TOKENS.USDC : SOLANA_TOKENS.SOL;
    
    // Get selected tokens (excluding output token)
    const tokensToSwap = tokens.filter(
      t => selectedTokens.has(t.mint) && t.mint !== outputMint
    );
    
    if (tokensToSwap.length === 0) {
      setError('No tokens to swap');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    setSwapResults(null);
    
    try {
      const results = await executeSolanaBatchSwap({
        connection,
        userPublicKey: publicKey,
        tokens: tokensToSwap,
        outputMint,
        slippageBps: SOLANA_BATCH_CONFIG.DEFAULT_SLIPPAGE_BPS,
        onProgress: setProgressStep,
        signTransaction,
      });
      
      setSwapResults(results);
      
      // Refresh token list after swap
      await scanWallet(true);
      
    } catch (err: any) {
      console.error('Swap error:', err);
      setError(err.message || 'Swap failed');
    } finally {
      setIsProcessing(false);
      setProgressStep('');
    }
  }, [publicKey, signTransaction, connected, selectedTokens, tokens, outputToken, connection, scanWallet]);
  
  // Computed values
  const outputMint = outputToken === 'USDC' ? SOLANA_TOKENS.USDC : SOLANA_TOKENS.SOL;
  
  const totalSelectedValue = useMemo(() => {
    return tokens
      .filter(t => selectedTokens.has(t.mint) && t.mint !== outputMint)
      .reduce((sum, t) => sum + t.valueUsd, 0);
  }, [tokens, selectedTokens, outputMint]);
  
  const selectedCount = useMemo(() => {
    return tokens.filter(t => selectedTokens.has(t.mint) && t.mint !== outputMint).length;
  }, [tokens, selectedTokens, outputMint]);
  
  // Filter display tokens (exclude output token)
  const displayTokens = useMemo(() => {
    return tokens.filter(t => t.mint !== outputMint);
  }, [tokens, outputMint]);
  
  return {
    // State
    tokens: displayTokens,
    selectedTokens,
    isScanning,
    isProcessing,
    progressStep,
    error,
    swapResults,
    outputToken,
    
    // Computed
    totalSelectedValue,
    selectedCount,
    
    // Actions
    scanWallet,
    toggleToken,
    selectAll,
    selectNone,
    setOutputToken,
    executeSwap,
    clearError: () => setError(null),
    clearResults: () => setSwapResults(null),
  };
}
