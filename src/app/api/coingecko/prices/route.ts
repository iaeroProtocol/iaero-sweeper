import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// CoinGecko chain ID mapping
const COINGECKO_PLATFORM_IDS: Record<number, string> = {
  1: 'ethereum',
  8453: 'base',
  42161: 'arbitrum-one',
  10: 'optimistic-ethereum',
  137: 'polygon-pos',
  56: 'binance-smart-chain',
  43114: 'avalanche',
  534352: 'scroll',
  59144: 'linea',
};

// Batch price lookup from CoinGecko
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chainId, addresses } = body;

    if (!chainId || !addresses || !Array.isArray(addresses)) {
      return NextResponse.json(
        { error: 'Missing chainId or addresses array' },
        { status: 400 }
      );
    }

    const platformId = COINGECKO_PLATFORM_IDS[chainId];
    if (!platformId) {
      return NextResponse.json(
        { error: `Unsupported chain: ${chainId}` },
        { status: 400 }
      );
    }

    const apiKey = process.env.COINGECKO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'CoinGecko API key not configured' },
        { status: 500 }
      );
    }

    // CoinGecko allows up to 100 addresses per request (Pro plan)
    // Free plan is more limited, so we'll batch in chunks of 50
    const BATCH_SIZE = 50;
    const prices: Record<string, number> = {};
    const logs: string[] = [];

    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(addresses.length / BATCH_SIZE);

      // Join addresses with commas (lowercase)
      const addressList = batch.map((a: string) => a.toLowerCase()).join(',');

      try {
        // Use the Pro API endpoint if you have a paid key
        // For demo key, use: https://api.coingecko.com/api/v3/simple/token_price/${platformId}
        const url = `https://pro-api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${addressList}&vs_currencies=usd`;
        
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'x-cg-pro-api-key': apiKey,
          },
        });

        if (!res.ok) {
          // Check if it's rate limiting
          if (res.status === 429) {
            logs.push(`Batch ${batchNum}/${totalBatches}: Rate limited, waiting...`);
            await new Promise(r => setTimeout(r, 2000));
            // Retry once
            const retryRes = await fetch(url, {
              headers: {
                'Accept': 'application/json',
                'x-cg-pro-api-key': apiKey,
              },
            });
            if (retryRes.ok) {
              const data = await retryRes.json();
              for (const [addr, priceData] of Object.entries<any>(data)) {
                if (priceData?.usd) {
                  prices[addr.toLowerCase()] = priceData.usd;
                }
              }
              logs.push(`Batch ${batchNum}/${totalBatches}: Retry succeeded, found ${Object.keys(data).length} prices`);
            } else {
              logs.push(`Batch ${batchNum}/${totalBatches}: Retry failed with ${retryRes.status}`);
            }
            continue;
          }
          
          logs.push(`Batch ${batchNum}/${totalBatches}: Failed with status ${res.status}`);
          continue;
        }

        const data = await res.json();
        
        let foundCount = 0;
        for (const [addr, priceData] of Object.entries<any>(data)) {
          if (priceData?.usd) {
            prices[addr.toLowerCase()] = priceData.usd;
            foundCount++;
          }
        }
        
        logs.push(`Batch ${batchNum}/${totalBatches}: Found ${foundCount}/${batch.length} prices`);

      } catch (e) {
        logs.push(`Batch ${batchNum}/${totalBatches}: Error - ${e}`);
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < addresses.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    logs.push(`=== CoinGecko total: ${Object.keys(prices).length}/${addresses.length} prices found ===`);

    return NextResponse.json({
      prices,
      logs,
      found: Object.keys(prices).length,
      requested: addresses.length,
    });

  } catch (e) {
    console.error('CoinGecko API error:', e);
    return NextResponse.json(
      { error: 'Internal server error', details: String(e) },
      { status: 500 }
    );
  }
}