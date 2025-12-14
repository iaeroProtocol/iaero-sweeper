// ============================================================================
// API ROUTE: /api/helius/balances
// ============================================================================
// Proxies Helius API calls to keep API key server-side
// 
// Place this file at: app/api/helius/balances/route.ts (Next.js App Router)
// Or: pages/api/helius/balances.ts (Pages Router)

import { NextRequest, NextResponse } from 'next/server';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_BASE_URL = 'https://api.helius.xyz/v0';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  
  if (!wallet) {
    return NextResponse.json(
      { error: 'Wallet address required' },
      { status: 400 }
    );
  }
  
  if (!HELIUS_API_KEY) {
    return NextResponse.json(
      { error: 'Helius API key not configured' },
      { status: 500 }
    );
  }
  
  try {
    const response = await fetch(
      `${HELIUS_BASE_URL}/addresses/${wallet}/balances?api-key=${HELIUS_API_KEY}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        // Cache for 30 seconds
        next: { revalidate: 30 },
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Helius API error:', response.status, error);
      return NextResponse.json(
        { error: `Helius API error: ${response.status}` },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error: any) {
    console.error('Helius proxy error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch balances' },
      { status: 500 }
    );
  }
}

// ============================================================================
// ALTERNATIVE: DAS API endpoint
// ============================================================================
// Place at: app/api/helius/assets/route.ts

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { wallet } = body;
  
  if (!wallet) {
    return NextResponse.json(
      { error: 'Wallet address required' },
      { status: 400 }
    );
  }
  
  if (!HELIUS_API_KEY) {
    return NextResponse.json(
      { error: 'Helius API key not configured' },
      { status: 500 }
    );
  }
  
  try {
    const response = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'token-sweep',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: wallet,
            page: 1,
            limit: 1000,
            displayOptions: {
              showFungible: true,
              showNativeBalance: true,
            },
          },
        }),
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Helius DAS API error:', response.status, error);
      return NextResponse.json(
        { error: `Helius API error: ${response.status}` },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error: any) {
    console.error('Helius DAS proxy error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch assets' },
      { status: 500 }
    );
  }
}
