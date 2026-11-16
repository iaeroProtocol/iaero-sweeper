// Keyed Solana reads exist only behind the native Pages shared D1 dispatcher.
// Next development/alternate hosting cannot bypass admission or read bindings.
const disabled = () => Response.json({code:'SOLANA_GUARD_UNAVAILABLE',error:'Solana read service requires the guarded Pages runtime.'},{status:503,headers:{'cache-control':'no-store'}});
export const GET = disabled;
export const POST = disabled;
export const runtime = 'edge';
