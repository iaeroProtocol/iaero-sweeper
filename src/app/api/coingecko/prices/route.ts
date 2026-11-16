import {NextResponse} from 'next/server';
export const runtime = 'edge';

// The native Pages gateway owns bounded body validation, shared admission and
// provider execution. This fallback never reads credentials or calls providers.
export async function POST() {
  return NextResponse.json({prices:{},found:0,requested:0,
    code:'PROVIDER_BUDGET_UNAVAILABLE',
    error:'Price service is temporarily unavailable. Retry shortly.'},
  {status:503,headers:{'cache-control':'no-store','retry-after':'60',
    'x-provider-budget':'required','x-provider-budget-state':'unavailable'}});
}
