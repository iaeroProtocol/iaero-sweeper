// app/layout.tsx or pages/_app.tsx
import { SolanaProvider } from '@/solana-sweeper';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <SolanaProvider rpcEndpoint="https://mainnet.helius-rpc.com/?api-key=9c65365a-e97f-495f-9953-fd5d4e3dcfc3">
          {children}
        </SolanaProvider>
      </body>
    </html>
  );
}