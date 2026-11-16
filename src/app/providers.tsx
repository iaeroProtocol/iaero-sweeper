'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, scroll, linea } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import { BrandThemeProvider, useBrandTheme } from '@/components/brand';

const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;

const config = getDefaultConfig({
  appName: 'iAERO Token Sweeper',
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
    <BrandThemeProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <BrandedWalletTheme>{children}</BrandedWalletTheme>
        </QueryClientProvider>
      </WagmiProvider>
    </BrandThemeProvider>
  );
}

function BrandedWalletTheme({children}: {children: React.ReactNode}) {
  const {theme} = useBrandTheme();
  const walletTheme = (theme === 'dark' ? darkTheme : lightTheme)({
    accentColor: '#2464df', accentColorForeground: 'white', borderRadius: 'large', fontStack: 'system', overlayBlur: 'none',
  });
  walletTheme.fonts.body = 'Manrope, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  return <RainbowKitProvider theme={walletTheme} modalSize="compact">{children}</RainbowKitProvider>;
}
