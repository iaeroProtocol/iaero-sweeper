import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// Unified token discovery API - tries multiple providers and COMBINES results
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

  // Helper to add tokens with validation
  const addToken = (address: string) => {
    if (address && address.startsWith('0x') && address.length === 42) {
      tokens.add(address.toLowerCase());
    }
  };

  // 1. Try Alchemy (for supported chains) - WITH PAGINATION
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
        let pageKey: string | undefined = undefined;
        let totalFound = 0;
        let pageCount = 0;
        const maxPages = 10; // Safety limit

        do {
          pageCount++;
          const params: any[] = [wallet, 'erc20'];
          if (pageKey) {
            params.push({ pageKey });
          }

          const res = await fetch(
            `https://${chainName}.g.alchemy.com/v2/${alchemyKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'alchemy_getTokenBalances',
                params,
                id: pageCount
              })
            }
          );

          if (!res.ok) {
            logs.push(`Alchemy page ${pageCount} returned ${res.status}`);
            break;
          }

          const data = await res.json();
          
          if (data.error) {
            logs.push(`Alchemy error: ${data.error.message || JSON.stringify(data.error)}`);
            break;
          }

          if (data.result?.tokenBalances) {
            for (const tb of data.result.tokenBalances) {
              const balance = tb.tokenBalance;
              // Check for non-zero balance (various formats)
              if (balance && 
                  balance !== '0x0' && 
                  balance !== '0x' && 
                  balance !== '0' &&
                  !balance.match(/^0x0+$/)) {
                addToken(tb.contractAddress);
                totalFound++;
              }
            }
          }

          // Check for next page
          pageKey = data.result?.pageKey;
          
          if (pageKey) {
            logs.push(`Alchemy page ${pageCount}: found ${data.result?.tokenBalances?.length || 0} tokens, more pages available...`);
          }

        } while (pageKey && pageCount < maxPages);

        logs.push(`Alchemy total: ${totalFound} tokens with balance (${pageCount} page(s))`);

      } catch (e) {
        logs.push(`Alchemy error: ${e}`);
      }
    }
  }

  // 2. ALSO try 1inch (combine results, don't just fall back)
  // 1inch often finds tokens that Alchemy misses
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
      const beforeCount = tokens.size;
      for (const [address, balance] of Object.entries(balances)) {
        if (balance && balance !== '0') {
          addToken(address);
        }
      }
      const newTokens = tokens.size - beforeCount;
      logs.push(`1inch found ${Object.keys(balances).length} total, ${newTokens} new tokens added`);
    } else {
      logs.push(`1inch returned ${res.status}`);
    }
  } catch (e) {
    logs.push(`1inch error: ${e}`);
  }

  // 3. Try Ankr (combine results)
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
          const beforeCount = tokens.size;
          for (const asset of data.result.assets) {
            if (asset.contractAddress && asset.balance !== '0') {
              addToken(asset.contractAddress);
            }
          }
          const newTokens = tokens.size - beforeCount;
          logs.push(`Ankr found ${data.result.assets.length} total, ${newTokens} new tokens added`);
        } else if (data.error) {
          logs.push(`Ankr error: ${data.error.message || JSON.stringify(data.error)}`);
        }
      } else {
        logs.push(`Ankr returned ${res.status}`);
      }
    } catch (e) {
      logs.push(`Ankr error: ${e}`);
    }
  }

  // 4. Try block explorer API (for token transfer history - catches tokens others miss)
  const explorerMap: Record<number, { url: string; key?: string }> = {
    1: { url: 'https://api.etherscan.io/api', key: process.env.ETHERSCAN_API_KEY },
    56: { url: 'https://api.bscscan.com/api', key: process.env.BSCSCAN_API_KEY },
    137: { url: 'https://api.polygonscan.com/api', key: process.env.POLYGONSCAN_API_KEY },
    43114: { url: 'https://api.snowtrace.io/api', key: process.env.SNOWTRACE_API_KEY },
    42161: { url: 'https://api.arbiscan.io/api', key: process.env.ARBISCAN_API_KEY },
    10: { url: 'https://api-optimistic.etherscan.io/api', key: process.env.OPTIMISM_API_KEY },
    8453: { url: 'https://api.basescan.org/api', key: process.env.BASESCAN_API_KEY },
    534352: { url: 'https://api.scrollscan.com/api', key: process.env.SCROLLSCAN_API_KEY },
    59144: { url: 'https://api.lineascan.build/api', key: process.env.LINEASCAN_API_KEY },
  };
  const explorer = explorerMap[chainIdNum];

  if (explorer) {
    try {
      logs.push('Trying block explorer (tx history)...');
      let url = `${explorer.url}?module=account&action=tokentx&address=${wallet}&page=1&offset=1000&sort=desc`;
      if (explorer.key) {
        url += `&apikey=${explorer.key}`;
      }

      const res = await fetch(url);

      if (res.ok) {
        const data = await res.json();
        if (data.status === '1' && data.result) {
          const beforeCount = tokens.size;
          for (const tx of data.result) {
            if (tx.contractAddress) {
              addToken(tx.contractAddress);
            }
          }
          const newTokens = tokens.size - beforeCount;
          logs.push(`Explorer found ${data.result.length} tx, ${newTokens} new tokens added`);
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

  // 5. Try Moralis (if available, combine results)
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
            const beforeCount = tokens.size;
            for (const token of data) {
              if (token.token_address) {
                addToken(token.token_address);
              }
            }
            const newTokens = tokens.size - beforeCount;
            logs.push(`Moralis found ${data.length} total, ${newTokens} new tokens added`);
          }
        } else {
          logs.push(`Moralis returned ${res.status}`);
        }
      } catch (e) {
        logs.push(`Moralis error: ${e}`);
      }
    }
  }

  // Final summary
  logs.push(`=== TOTAL: ${tokens.size} unique tokens discovered ===`);

  return NextResponse.json({
    tokens: Array.from(tokens),
    logs,
    count: tokens.size,
  });
}