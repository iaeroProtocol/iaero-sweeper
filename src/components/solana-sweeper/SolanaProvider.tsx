// ============================================================================
// SOLANA WALLET PROVIDER SETUP
// ============================================================================
// Wrap your app with this provider to enable Solana wallet connections

'use client';

import React, { useMemo } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  CoinbaseWalletAdapter,
  LedgerWalletAdapter,
  TorusWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

interface SolanaProviderProps {
  children: React.ReactNode;
  // Optional custom RPC endpoint (e.g., Helius)
  rpcEndpoint?: string;
}

export function SolanaProvider({ children, rpcEndpoint }: SolanaProviderProps) {
  // Use provided RPC or default to mainnet
  const endpoint = useMemo(
    () => rpcEndpoint || clusterApiUrl('mainnet-beta'),
    [rpcEndpoint]
  );

  // Initialize wallet adapters
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new LedgerWalletAdapter(),
      new TorusWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

// ============================================================================
// COMBINED EVM + SOLANA PROVIDER
// ============================================================================
// If you want to support both EVM and Solana in the same app

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
// Import your wagmi config
// import { wagmiConfig } from './wagmi-config';

interface CombinedProviderProps {
  children: React.ReactNode;
  wagmiConfig: any; // Your wagmi config
  solanaRpcEndpoint?: string;
}

const queryClient = new QueryClient();

export function CombinedWeb3Provider({
  children,
  wagmiConfig,
  solanaRpcEndpoint,
}: CombinedProviderProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()}>
          <SolanaProvider rpcEndpoint={solanaRpcEndpoint}>
            {children}
          </SolanaProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
