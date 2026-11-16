import type { Metadata, Viewport } from "next";
import "./globals.css";
import '@rainbow-me/rainbowkit/styles.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: "iAERO Token Sweeper | Review and swap wallet tokens",
  description: "Select wallet tokens, review swap quotes, and sweep across supported EVM networks and Solana with iAERO.",
  metadataBase: new URL('https://sweeper.iaero.finance'),
  icons: { icon: '/mark.svg' },
  openGraph: {
    title: 'iAERO Token Sweeper',
    description: 'Your tokens. Your choice. Review and swap across supported EVM networks and Solana.',
    siteName: 'iAERO',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1.0,
  viewportFit: 'cover',
  themeColor: '#f6f7f9',
};

const themeBootstrap = "try{var t=localStorage.getItem('iaero.sweeper.theme')==='dark'?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.classList.toggle('dark',t==='dark');document.querySelector('meta[name=\"theme-color\"]')?.setAttribute('content',t==='dark'?'#0a1220':'#f6f7f9')}catch{}";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/>
        <script id="iaero-theme" dangerouslySetInnerHTML={{__html: themeBootstrap}}/>
      </head>
      <body className="iaero-sweeper">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
