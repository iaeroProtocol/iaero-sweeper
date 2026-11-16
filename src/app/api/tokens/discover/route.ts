import {NextResponse} from 'next/server';

export const runtime = 'edge';

// Discovery is served directly by the guarded native Pages Worker. This route
// deliberately has no provider imports or credential access: a missing wrapper,
// alternate Next deployment or path normalization must never bypass admission.
export async function GET() {
  return NextResponse.json({
    tokens: [], count: 0, partial: true, complete: false, providers: [], logs: [],
    code: 'DISCOVERY_GUARD_UNAVAILABLE',
    error: 'Token discovery is temporarily unavailable. Retry shortly or enter tokens manually.',
  }, {status: 503, headers: {'cache-control': 'no-store', 'retry-after': '60',
    'x-discovery-guard': 'required', 'x-discovery-budget': 'unavailable'}});
}
