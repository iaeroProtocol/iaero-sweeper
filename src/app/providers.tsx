'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, scroll, linea } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit';

const config = getDefaultConfig({
  appName: 'Token Sweeper',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
  chains: [base, mainnet, arbitrum, optimism, polygon, bsc, avalanche, scroll, linea],
  transports: {
    [base.id]: http(
      process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'
    ),
    [mainnet.id]: http(
      process.env.NEXT_PUBLIC_ETH_RPC_URL || 'https://eth.llamarpc.com'
    ),
    [arbitrum.id]: http(
      process.env.NEXT_PUBLIC_ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc'
    ),
    [optimism.id]: http(
      process.env.NEXT_PUBLIC_OP_RPC_URL || 'https://mainnet.optimism.io'
    ),
    [polygon.id]: http(
      process.env.NEXT_PUBLIC_POLYGON_RPC_URL || 'https://polygon-rpc.com'
    ),
    [bsc.id]: http(
      process.env.NEXT_PUBLIC_BSC_RPC_URL || 'https://bsc-dataseed.binance.org'
    ),
    [avalanche.id]: http(
      process.env.NEXT_PUBLIC_AVAX_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'
    ),
    [scroll.id]: http(
      process.env.NEXT_PUBLIC_SCROLL_RPC_URL || 'https://rpc.scroll.io'
    ),
    [linea.id]: http(
      process.env.NEXT_PUBLIC_LINEA_RPC_URL || 'https://rpc.linea.build'
    ),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#10b981', // emerald-500
            accentColorForeground: 'white',
            borderRadius: 'large',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}