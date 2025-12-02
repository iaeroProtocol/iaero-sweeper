import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import '@rainbow-me/rainbowkit/styles.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Token Sweeper | Batch Swap to USDC or WETH",
  description: "Efficiently swap multiple tokens to USDC or WETH in a single transaction using 0x aggregator",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1.0,
  maximumScale: 1.0,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} dark min-h-screen bg-slate-900`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
