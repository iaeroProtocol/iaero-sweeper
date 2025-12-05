'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, scroll, linea } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit';

const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;

const config = getDefaultConfig({
  appName: 'Token Sweeper',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
  chains: [base, mainnet, arbitrum, optimism, polygon, bsc, avalanche, scroll, linea],
  transports: {
    [base.id]: http(
      alchemyKey ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://mainnet.base.org'
    ),
    [mainnet.id]: http(
      alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://eth.llamarpc.com'
    ),
    [arbitrum.id]: http(
      alchemyKey ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://arb1.arbitrum.io/rpc'
    ),
    [optimism.id]: http(
      alchemyKey ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://mainnet.optimism.io'
    ),
    [polygon.id]: http(
      alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://polygon-rpc.com'
    ),
    // Alchemy doesn't support these well - use public RPCs
    [bsc.id]: http('https://bsc-dataseed.binance.org'),
    [avalanche.id]: http('https://api.avax.network/ext/bc/C/rpc'),
    [scroll.id]: http(
      alchemyKey ? `https://scroll-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://rpc.scroll.io'
    ),
    [linea.id]: http(
      alchemyKey ? `https://linea-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://rpc.linea.build'
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
            accentColor: '#10b981',
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