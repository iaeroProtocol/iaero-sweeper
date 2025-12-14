'use client';

import { SolanaWalletProvider } from '@/components/solana-sweeper/SolanaWalletProvider';
import SolanaSweeper from '@/components/solana-sweeper/SolanaSweeper';

export default function SolanaSweepPage() {
  return (
    <SolanaWalletProvider>
      <SolanaSweeper />
    </SolanaWalletProvider>
  );
}