import {type NextRequest,NextResponse} from 'next/server';
import {handleQuoteRequest} from '../../../../lib/sweeper-read-api';
export const runtime='edge';
export async function GET(request:NextRequest){
 const reply=await handleQuoteRequest(request.nextUrl.searchParams,{ZERO_EX_API_KEY:process.env.ZERO_EX_API_KEY,SWAP_FEE_BPS:process.env.SWAP_FEE_BPS,SWAP_FEE_RECIPIENT:process.env.SWAP_FEE_RECIPIENT},{signal:request.signal});
 return NextResponse.json(reply.data,{status:reply.status,headers:reply.headers});
}
