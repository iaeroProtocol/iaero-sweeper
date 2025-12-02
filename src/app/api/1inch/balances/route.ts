import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// Proxy 1inch balance API to avoid CORS issues
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

  try {
    const response = await fetch(
      `https://balances.1inch.io/v1.2/${chainId}/balances/${wallet}`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      // Try alternative 1inch endpoint
      const altResponse = await fetch(
        `https://api.1inch.dev/balance/v1.2/${chainId}/balances/${wallet}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );
      
      if (!altResponse.ok) {
        return NextResponse.json(
          { error: `1inch API error: ${response.status}` },
          { status: response.status }
        );
      }
      
      const data = await altResponse.json();
      return NextResponse.json(data);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('1inch proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch balances' },
      { status: 500 }
    );
  }
}