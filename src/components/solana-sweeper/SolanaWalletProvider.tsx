// ============================================================================
// SOLANA WALLET PROVIDER SETUP
// ============================================================================
//
// Wrap your app with this provider to enable Solana wallet connections.
//
// Usage in your layout.tsx or _app.tsx:
//
//   import { SolanaWalletProvider } from './SolanaWalletProvider';
//   
//   export default function Layout({ children }) {
//     return (
//       <SolanaWalletProvider>
//         {children}
//       </SolanaWalletProvider>
//     );
//   }
//
// ============================================================================

'use client';

import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import type { Adapter } from '@solana/wallet-adapter-base';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
  LedgerWalletAdapter,
  CoinbaseWalletAdapter,
  WalletConnectWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { clusterApiUrl, type Cluster } from '@solana/web3.js';

// Default styles for wallet modal
import '@solana/wallet-adapter-react-ui/styles.css';

// ============================================================================
// CONFIGURATION
// ============================================================================

// RPC endpoint - use your own for production!
// Options:
// - Free: clusterApiUrl('mainnet-beta') - rate limited
// - Helius: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
// - QuickNode, Alchemy, etc.
const RPC_ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');

// WalletConnect Project ID - get yours free at https://cloud.walletconnect.com
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Network for WalletConnect
const NETWORK: Cluster = 'mainnet-beta';

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

interface SolanaWalletProviderProps {
  children: React.ReactNode;
}

export function SolanaWalletProvider({ children }: SolanaWalletProviderProps) {
  // Configure supported wallets
  const wallets = useMemo(() => {
    const walletList: Adapter[] = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new TorusWalletAdapter(),
      new LedgerWalletAdapter(),
    ];

    // Only add WalletConnect if project ID is configured
    if (WALLETCONNECT_PROJECT_ID) {
      walletList.push(
        new WalletConnectWalletAdapter({
          network: NETWORK,
          options: {
            projectId: WALLETCONNECT_PROJECT_ID,
            metadata: {
              name: 'Solana Token Sweeper',
              description: 'Sweep your Solana tokens to USDC or SOL',
              url: typeof window !== 'undefined' ? window.location.origin : 'https://localhost:3000',
              icons: ['https://avatars.githubusercontent.com/u/35608259?s=200'],
            },
          },
        })
      );
    }

    return walletList;
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

// ============================================================================
// CUSTOM HOOK FOR SIGNING VERSIONED TRANSACTIONS
// ============================================================================

import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';

/**
 * Hook to get a function that signs versioned transactions
 * Works with the batch swap implementation
 */
export function useSignVersionedTransaction() {
  const { signTransaction, publicKey } = useWallet();
  const { connection } = useConnection();

  const signVersionedTransaction = async (tx: VersionedTransaction): Promise<VersionedTransaction> => {
    if (!signTransaction || !publicKey) {
      throw new Error('Wallet not connected');
    }
    
    // The wallet adapter's signTransaction should handle VersionedTransaction
    return await signTransaction(tx) as VersionedTransaction;
  };

  return {
    signVersionedTransaction,
    publicKey,
    connection,
    connected: !!publicKey,
  };
}

// ============================================================================
// ALTERNATIVE: Combined EVM + Solana Provider
// ============================================================================
//
// If you want to support both EVM and Solana in the same app:
//
// import { WagmiConfig } from 'wagmi';
// import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
// import { SolanaWalletProvider } from './SolanaWalletProvider';
//
// export function MultiChainProvider({ children }) {
//   return (
//     <WagmiConfig config={wagmiConfig}>
//       <RainbowKitProvider>
//         <SolanaWalletProvider>
//           {children}
//         </SolanaWalletProvider>
//       </RainbowKitProvider>
//     </WagmiConfig>
//   );
// }
//
// Then in your UI, detect which chain type the user wants and show
// the appropriate wallet connection UI.
// ============================================================================
