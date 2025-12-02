import { type NextRequest, NextResponse } from "next/server";

export const runtime = 'edge';

// Fee configuration - 5 bps = 0.05%
const SWAP_FEE_BPS = process.env.SWAP_FEE_BPS || "5";
const SWAP_FEE_RECIPIENT = process.env.SWAP_FEE_RECIPIENT || "0xe6e7d3c6379ad80de02f26ccc72605d0f70d5201"; // Treasury

// Default slippage if not specified - 30 bps = 0.3%
const DEFAULT_SLIPPAGE_BPS = "30";

export async function GET(request: NextRequest) {
  const originalParams = request.nextUrl.searchParams;
  const ZERO_EX_API_KEY = process.env.ZERO_EX_API_KEY;

  if (!ZERO_EX_API_KEY) {
    return NextResponse.json({ error: "Missing API Key" }, { status: 500 });
  }

  // Create new params object (don't mutate original)
  const params = new URLSearchParams();
  
  // Copy original params
  originalParams.forEach((value: string, key: string) => {
    params.set(key, value);
  });
  
  // Enable price impact calculation - set to 0.99 (99%) to get estimatedPriceImpact without blocking quotes
  // This is how Matcha gets price impact data
  params.set("priceImpactProtectionPercentage", "0.99");
  
  // Set slippage - use provided value or default to 1%
  // This ensures the swap data's internal minimum matches what we expect
  if (!params.has("slippageBps")) {
    params.set("slippageBps", DEFAULT_SLIPPAGE_BPS);
  }
  
  // Add fee parameters (only if recipient is set and fees enabled)
  // swapFeeToken must be the actual token address, not "buyToken" string
  const buyToken = originalParams.get("buyToken");
  if (SWAP_FEE_RECIPIENT && SWAP_FEE_BPS && SWAP_FEE_BPS !== "0" && buyToken) {
    params.set("swapFeeRecipient", SWAP_FEE_RECIPIENT);
    params.set("swapFeeBps", SWAP_FEE_BPS);
    params.set("swapFeeToken", buyToken); // Use actual buyToken address
  }

  // Build 0x API URL
  const url = `https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`;
  
  console.log('0x API request:', url);

  try {
    const res = await fetch(url, {
      headers: {
        "0x-api-key": ZERO_EX_API_KEY,
        "0x-version": "v2",
      },
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('0x API error:', JSON.stringify(data));
      // Return the actual error from 0x for better debugging
      return NextResponse.json(
        { 
          error: data.reason || data.message || 'Quote failed',
          code: data.code,
          details: data.validationErrors || data.details
        }, 
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('0x fetch error:', error);
    return NextResponse.json({ error: "Failed to fetch quote" }, { status: 500 });
  }
}