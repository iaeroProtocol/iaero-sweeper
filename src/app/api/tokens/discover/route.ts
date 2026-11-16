import {type NextRequest,NextResponse} from 'next/server';
import {discoverTokens} from '../../../../lib/sweeper-read-api';
export const runtime='edge';
export async function GET(request:NextRequest){
 const reply=await discoverTokens(request.nextUrl.searchParams,{
  ALCHEMY_API_KEY:process.env.ALCHEMY_API_KEY,ALCHEMY_KEY:process.env.ALCHEMY_KEY,NEXT_PUBLIC_ALCHEMY_KEY:process.env.NEXT_PUBLIC_ALCHEMY_KEY,
  MORALIS_API_KEY:process.env.MORALIS_API_KEY,ETHERSCAN_API_KEY:process.env.ETHERSCAN_API_KEY,BSCSCAN_API_KEY:process.env.BSCSCAN_API_KEY,POLYGONSCAN_API_KEY:process.env.POLYGONSCAN_API_KEY,SNOWTRACE_API_KEY:process.env.SNOWTRACE_API_KEY,ARBISCAN_API_KEY:process.env.ARBISCAN_API_KEY,OPTIMISM_API_KEY:process.env.OPTIMISM_API_KEY,BASESCAN_API_KEY:process.env.BASESCAN_API_KEY,SCROLLSCAN_API_KEY:process.env.SCROLLSCAN_API_KEY,LINEASCAN_API_KEY:process.env.LINEASCAN_API_KEY,
 },{signal:request.signal});
 return NextResponse.json(reply.data,{status:reply.status,headers:reply.headers});
}
