import { NextRequest, NextResponse } from 'next/server';

// Unified token discovery API - tries multiple providers server-side
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get('chainId');
  const wallet = searchParams.get('wallet');

  if (!chainId || !wallet) {
    return NextResponse.json(
      { error: 'Missing chainId or wallet parameter' },
      { status: 400 }
    );
  }

  const chainIdNum = parseInt(chainId);
  const tokens: Set<string> = new Set();
  const logs: string[] = [];

  // 1. Try Alchemy first (for supported chains)
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  if (alchemyKey) {
    const alchemyChainMap: Record<number, string> = {
      1: 'eth-mainnet',
      8453: 'base-mainnet',
      42161: 'arb-mainnet',
      10: 'opt-mainnet',
      137: 'polygon-mainnet',
      534352: 'scroll-mainnet',
      59144: 'linea-mainnet',
    };
    const chainName = alchemyChainMap[chainIdNum];

    if (chainName) {
      try {
        logs.push(`Trying Alchemy (${chainName})...`);
        const res = await fetch(
          `https://${chainName}.g.alchemy.com/v2/${alchemyKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'alchemy_getTokenBalances',
              params: [wallet, 'erc20'],
              id: 1
            })
          }
        );

        if (res.ok) {
          const data = await res.json();
          if (data.result?.tokenBalances) {
            for (const tb of data.result.tokenBalances) {
              const balance = tb.tokenBalance;
              if (balance && balance !== '0x0' && balance !== '0x' && 
                  balance !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
                tokens.add(tb.contractAddress.toLowerCase());
              }
            }
            logs.push(`Alchemy found ${tokens.size} tokens`);
          }
        } else {
          logs.push(`Alchemy returned ${res.status}`);
        }
      } catch (e) {
        logs.push(`Alchemy error: ${e}`);
      }
    }
  }

  // 2. Try 1inch (if no tokens found)
  if (tokens.size === 0) {
    try {
      logs.push('Trying 1inch...');
      const res = await fetch(
        `https://balances.1inch.io/v1.2/${chainId}/balances/${wallet}`,
        {
          headers: { 'Accept': 'application/json' },
        }
      );

      if (res.ok) {
        const balances = await res.json();
        for (const [address, balance] of Object.entries(balances)) {
          if (balance && balance !== '0' && address.startsWith('0x') && address.length === 42) {
            tokens.add(address.toLowerCase());
          }
        }
        logs.push(`1inch found ${tokens.size} tokens`);
      } else {
        logs.push(`1inch returned ${res.status}`);
      }
    } catch (e) {
      logs.push(`1inch error: ${e}`);
    }
  }

  // 3. Try Ankr (if no tokens found)
  if (tokens.size === 0) {
    const ankrChainMap: Record<number, string> = {
      1: 'eth',
      56: 'bsc',
      137: 'polygon',
      43114: 'avalanche',
      42161: 'arbitrum',
      10: 'optimism',
      8453: 'base',
      534352: 'scroll',
      59144: 'linea',
    };
    const ankrChain = ankrChainMap[chainIdNum];

    if (ankrChain) {
      try {
        logs.push(`Trying Ankr (${ankrChain})...`);
        const res = await fetch(
          'https://rpc.ankr.com/multichain',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'ankr_getAccountBalance',
              params: {
                blockchain: [ankrChain],
                walletAddress: wallet,
                onlyWhitelisted: false,
              },
              id: 1
            })
          }
        );

        if (res.ok) {
          const data = await res.json();
          if (data.result?.assets) {
            for (const asset of data.result.assets) {
              if (asset.contractAddress && asset.balance !== '0') {
                tokens.add(asset.contractAddress.toLowerCase());
              }
            }
            logs.push(`Ankr found ${tokens.size} tokens`);
          }
        } else {
          logs.push(`Ankr returned ${res.status}`);
        }
      } catch (e) {
        logs.push(`Ankr error: ${e}`);
      }
    }
  }

  // 4. Try block explorer API (if no tokens found)
  if (tokens.size === 0) {
    const explorerMap: Record<number, string> = {
      56: 'https://api.bscscan.com/api',
      43114: 'https://api.snowtrace.io/api',
      137: 'https://api.polygonscan.com/api',
      534352: 'https://api.scrollscan.com/api',
      59144: 'https://api.lineascan.build/api',
      1: 'https://api.etherscan.io/api',
      42161: 'https://api.arbiscan.io/api',
      10: 'https://api-optimistic.etherscan.io/api',
      8453: 'https://api.basescan.org/api',
    };
    const explorerUrl = explorerMap[chainIdNum];

    if (explorerUrl) {
      try {
        logs.push('Trying block explorer...');
        const res = await fetch(
          `${explorerUrl}?module=account&action=tokentx&address=${wallet}&page=1&offset=1000&sort=desc`
        );

        if (res.ok) {
          const data = await res.json();
          if (data.status === '1' && data.result) {
            for (const tx of data.result) {
              if (tx.contractAddress) {
                tokens.add(tx.contractAddress.toLowerCase());
              }
            }
            logs.push(`Explorer found ${tokens.size} tokens from tx history`);
          } else {
            logs.push(`Explorer returned status ${data.status}: ${data.message || 'no result'}`);
          }
        } else {
          logs.push(`Explorer returned ${res.status}`);
        }
      } catch (e) {
        logs.push(`Explorer error: ${e}`);
      }
    }
  }

  // 5. Final fallback: Moralis (if available)
  if (tokens.size === 0) {
    const moralisKey = process.env.MORALIS_API_KEY;
    if (moralisKey) {
      const moralisChainMap: Record<number, string> = {
        1: 'eth',
        56: 'bsc',
        137: 'polygon',
        43114: 'avalanche',
        42161: 'arbitrum',
        10: 'optimism',
        8453: 'base',
        59144: 'linea',
      };
      const moralisChain = moralisChainMap[chainIdNum];

      if (moralisChain) {
        try {
          logs.push(`Trying Moralis (${moralisChain})...`);
          const res = await fetch(
            `https://deep-index.moralis.io/api/v2.2/${wallet}/erc20?chain=${moralisChain}`,
            {
              headers: {
                'Accept': 'application/json',
                'X-API-Key': moralisKey,
              },
            }
          );

          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              for (const token of data) {
                if (token.token_address) {
                  tokens.add(token.token_address.toLowerCase());
                }
              }
              logs.push(`Moralis found ${tokens.size} tokens`);
            }
          } else {
            logs.push(`Moralis returned ${res.status}`);
          }
        } catch (e) {
          logs.push(`Moralis error: ${e}`);
        }
      }
    }
  }

  return NextResponse.json({
    tokens: Array.from(tokens),
    logs,
    count: tokens.size,
  });
}