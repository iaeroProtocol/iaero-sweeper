import {NextResponse} from 'next/server';
export const runtime = 'edge';

// Served directly by the mandatory native Pages budget gateway. Keeping this
// fallback inert prevents alternate/normalized Next paths bypassing admission.
export async function GET() {
  return NextResponse.json({code:'PROVIDER_BUDGET_UNAVAILABLE',
    error:'Quote service is temporarily unavailable. Retry shortly.'},
  {status:503,headers:{'cache-control':'no-store','retry-after':'60',
    'x-provider-budget':'required','x-provider-budget-state':'unavailable'}});
}
