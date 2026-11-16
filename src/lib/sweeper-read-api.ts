// Fixed-origin read APIs. Credentials arrive only from the server route.
export type SweeperReadEnv={ZERO_EX_API_KEY?:string;SWAP_FEE_BPS?:string;SWAP_FEE_RECIPIENT?:string;ALCHEMY_API_KEY?:string;ALCHEMY_KEY?:string;NEXT_PUBLIC_ALCHEMY_KEY?:string;MORALIS_API_KEY?:string;ETHERSCAN_API_KEY?:string;BSCSCAN_API_KEY?:string;POLYGONSCAN_API_KEY?:string;SNOWTRACE_API_KEY?:string;ARBISCAN_API_KEY?:string;OPTIMISM_API_KEY?:string;BASESCAN_API_KEY?:string;SCROLLSCAN_API_KEY?:string;LINEASCAN_API_KEY?:string};
type ApiResult={status:number;data:any;headers?:Record<string,string>};
type Options={fetchImpl?:typeof fetch;budgetMs?:number;signal?:AbortSignal};
type Chain={swapper:string;alchemy?:string;ankr:string;moralis?:string;explorer:string;explorerKey:keyof SweeperReadEnv};
const COMMON='0x75f57faf06f0191a1422a665bfc297bcb6aa765a';
export const READ_API_CHAINS:Record<string,Chain>={
 '1':{swapper:COMMON,alchemy:'eth-mainnet',ankr:'eth',moralis:'eth',explorer:'https://api.etherscan.io/api',explorerKey:'ETHERSCAN_API_KEY'},
 '8453':{swapper:'0x25f11f947309df89bf4d36da5d9a9fb5f1e186c1',alchemy:'base-mainnet',ankr:'base',moralis:'base',explorer:'https://api.basescan.org/api',explorerKey:'BASESCAN_API_KEY'},
 '42161':{swapper:COMMON,alchemy:'arb-mainnet',ankr:'arbitrum',moralis:'arbitrum',explorer:'https://api.arbiscan.io/api',explorerKey:'ARBISCAN_API_KEY'},
 '10':{swapper:COMMON,alchemy:'opt-mainnet',ankr:'optimism',moralis:'optimism',explorer:'https://api-optimistic.etherscan.io/api',explorerKey:'OPTIMISM_API_KEY'},
 '137':{swapper:COMMON,alchemy:'polygon-mainnet',ankr:'polygon',moralis:'polygon',explorer:'https://api.polygonscan.com/api',explorerKey:'POLYGONSCAN_API_KEY'},
 '56':{swapper:COMMON,ankr:'bsc',moralis:'bsc',explorer:'https://api.bscscan.com/api',explorerKey:'BSCSCAN_API_KEY'},
 '43114':{swapper:COMMON,ankr:'avalanche',moralis:'avalanche',explorer:'https://api.snowtrace.io/api',explorerKey:'SNOWTRACE_API_KEY'},
 '534352':{swapper:COMMON,alchemy:'scroll-mainnet',ankr:'scroll',explorer:'https://api.scrollscan.com/api',explorerKey:'SCROLLSCAN_API_KEY'},
 '59144':{swapper:'0x679e6e600e480d99f8aed8555953ad2cf43bab96',alchemy:'linea-mainnet',ankr:'linea',moralis:'linea',explorer:'https://api.lineascan.build/api',explorerKey:'LINEASCAN_API_KEY'},
};
const TREASURY='0xe6e7d3c6379ad80de02f26ccc72605d0f70d5201',AH='0x0000000000001ff3684f28c67538d4d072c22734';
const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)&&!/^0x0{40}$/i.test(v)&&!/^0xe{40}$/i.test(v);
const amount=(v:unknown,positive=true):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<2n**256n&&(!positive||BigInt(v)>0n);
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const result=(status:number,data:any):ApiResult=>({status,data,headers:{'cache-control':'no-store'}});
class ReadFailure extends Error{reason:'HTTP'|'TRANSPORT'|'TIMEOUT'|'INVALID_RESPONSE'|'LIMIT';status?:number;constructor(reason:ReadFailure['reason'],status?:number){super(reason);this.reason=reason;this.status=status;}}
function allowedParams(params:URLSearchParams,allowed:string[]){const seen=new Set<string>();for(const key of params.keys()){if(!allowed.includes(key)||seen.has(key))throw Error('Invalid parameters');seen.add(key);}}
function budget(options:Options,maximum:number){
 const ms=Math.min(maximum,Math.max(1,options.budgetMs??maximum)),controller=new AbortController();let ended=false,resolveEnd!:()=>void;
 const end=new Promise<void>(r=>resolveEnd=r),finish=()=>{if(!ended){ended=true;controller.abort();resolveEnd();}},timer=setTimeout(finish,ms),external=()=>finish();options.signal?.addEventListener('abort',external,{once:true});if(options.signal?.aborted)finish();
 return{ms,signal:controller.signal,expired:()=>ended,run:async<T>(work:Promise<T>)=>{const done=work.then(value=>({value}));const value=await Promise.race([done,end.then(()=>{throw new ReadFailure('TIMEOUT');})]);return value.value;},close:()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',external);controller.abort();}};
}
async function readJson(fetcher:typeof fetch,url:string,signal:AbortSignal,init:RequestInit={},maxBytes=2_000_000){
 let response:Response;try{response=await fetcher(url,{...init,signal,redirect:'manual',cache:'no-store'});}catch{throw new ReadFailure(signal.aborted?'TIMEOUT':'TRANSPORT');}
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ReadFailure('HTTP',response.status);}
 const reader=response.body?.getReader();if(!reader)throw new ReadFailure('INVALID_RESPONSE');const decoder=new TextDecoder();let size=0,text='';
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();throw new ReadFailure('LIMIT');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}catch(error){if(error instanceof ReadFailure)throw error;throw new ReadFailure(signal.aborted?'TIMEOUT':'INVALID_RESPONSE');}finally{reader.releaseLock();}
 let data:any;try{data=JSON.parse(text);}catch{throw new ReadFailure('INVALID_RESPONSE');}return{status:response.status,ok:response.ok,data};
}
function quoteError(status:number,data:any):ApiResult{
 if(status===429)return result(429,{code:'RATE_LIMITED',error:'Quote service limit reached. Retry shortly.'});
 if(status===401)return result(503,{code:'QUOTE_AUTHENTICATION',error:'Quote service authentication is unavailable.'});
 if(status===403)return result(503,{code:'QUOTE_ACCESS_DENIED',error:'The quote service refused this request.'});
 if(status>=500)return result(503,{code:'QUOTE_SERVICE_UNAVAILABLE',error:'Quote service is temporarily unavailable.'});
 const code=String(data?.name??data?.code??'');
 if(['SELL_AMOUNT_TOO_SMALL','INSUFFICIENT_ASSET_LIQUIDITY','NO_ROUTE_FOR_AMOUNT'].includes(code)||data?.liquidityAvailable===false)return result(422,{code:'NO_ROUTE_FOR_AMOUNT',error:'No executable route is available for this exact amount.'});
 if(['TOKEN_NOT_SUPPORTED','SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE','BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE'].includes(code))return result(422,{code:'TOKEN_NOT_SUPPORTED',error:'This token is not supported by the quote service.'});
 return result(422,{code:'QUOTE_REQUEST_REJECTED',error:'The quote service rejected this token or amount.'});
}
/** Pure request validation, shared by the gateway BEFORE budget admission. */
export function parseQuoteRequest(params:URLSearchParams):{chainId:string;sellToken:string;buyToken:string;sellAmount:string;slippage:string;txOrigin:string|undefined;chain:Chain}{
 try{allowedParams(params,['chainId','sellToken','buyToken','sellAmount','taker','slippageBps','txOrigin']);const chainId=params.get('chainId')??'',chain=READ_API_CHAINS[chainId],sellToken=params.get('sellToken')??'',buyToken=params.get('buyToken')??'',sellAmount=params.get('sellAmount')??'',slippage=params.get('slippageBps')??'30',txOrigin=params.get('txOrigin')??undefined;if(!chain||!address(sellToken)||!address(buyToken)||sellToken.toLowerCase()===buyToken.toLowerCase()||!amount(sellAmount)||!address(params.get('taker'))||params.get('taker')!.toLowerCase()!==chain.swapper||!/^\d{2,3}$/.test(slippage)||Number(slippage)<10||Number(slippage)>500||txOrigin!==undefined&&!address(txOrigin))throw Error();return{chainId,chain,sellToken,buyToken,sellAmount,slippage,txOrigin};}catch{throw Error('Invalid quote request.');}
}
/** Server owns taker/recipient and existing5bps treasury fee. */
export async function handleQuoteRequest(params:URLSearchParams,env:SweeperReadEnv,options:Options={}):Promise<ApiResult>{
 let parsed:ReturnType<typeof parseQuoteRequest>;
 try{parsed=parseQuoteRequest(params);}catch{return result(400,{code:'INVALID_QUOTE_REQUEST',error:'Invalid chain, token, amount, taker, slippage or quote parameter.'});}
 const {chainId,chain,sellToken,buyToken,sellAmount,slippage,txOrigin}=parsed;
 if(!env.ZERO_EX_API_KEY)return result(503,{code:'QUOTE_AUTHENTICATION',error:'Quote service is unavailable.'});
 if((env.SWAP_FEE_BPS||'5')!=='5'||(env.SWAP_FEE_RECIPIENT||TREASURY).toLowerCase()!==TREASURY)return result(503,{code:'QUOTE_CONFIGURATION',error:'Quote fee configuration requires review.'});
 const upstream=new URL('https://api.0x.org/swap/allowance-holder/quote');upstream.search=new URLSearchParams({chainId,sellToken,buyToken,sellAmount,taker:chain.swapper,recipient:chain.swapper,slippageBps:String(Number(slippage)),swapFeeRecipient:TREASURY,swapFeeBps:'5',swapFeeToken:buyToken}).toString();if(txOrigin)upstream.searchParams.set('txOrigin',txOrigin);
 const life=budget(options,8000);
 try{const response=await life.run(readJson(options.fetchImpl??fetch,upstream.href,life.signal,{headers:{'0x-api-key':env.ZERO_EX_API_KEY,'0x-version':'v2'}},1_000_000)),d=response.data;if(!response.ok||d?.liquidityAvailable===false)return quoteError(response.status,d);
  if(!object(d)||!address(d.sellToken)||d.sellToken.toLowerCase()!==sellToken.toLowerCase()||!address(d.buyToken)||d.buyToken.toLowerCase()!==buyToken.toLowerCase()||d.sellAmount!==sellAmount||!amount(String(d.buyAmount))||!amount(d.minBuyAmount)||BigInt(d.minBuyAmount)>BigInt(d.buyAmount)||BigInt(d.minBuyAmount)<BigInt(d.buyAmount)*BigInt(10000-Number(slippage))/10000n||!object(d.transaction)||!address(d.transaction.to)||d.transaction.to.toLowerCase()!==AH||typeof d.transaction.data!=='string'||!/^0x(?:[0-9a-fA-F]{2}){4,250000}$/.test(d.transaction.data)||! /^(?:0|0x0+)$/i.test(String(d.transaction.value??'0'))||d.taker!==undefined&&String(d.taker).toLowerCase()!==chain.swapper||d.recipient!==undefined&&String(d.recipient).toLowerCase()!==chain.swapper)return result(422,{code:'INVALID_EXECUTABLE_QUOTE',error:'Quote does not match the requested token, amount, recipient or router.'});
  const transaction:any={to:d.transaction.to,data:d.transaction.data,value:'0'};for(const k of ['gas','gasPrice'])if(amount(String(d.transaction[k]),false))transaction[k]=String(d.transaction[k]);const safe:any={chainId:Number(chainId),sellToken,buyToken,sellAmount,buyAmount:String(d.buyAmount),minBuyAmount:d.minBuyAmount,taker:chain.swapper,recipient:chain.swapper,liquidityAvailable:true,transaction,quotedAt:Date.now()};if(typeof d.estimatedPriceImpact==='string'&&/^\d{1,3}(?:\.\d{1,18})?$/.test(d.estimatedPriceImpact))safe.estimatedPriceImpact=d.estimatedPriceImpact;
  return result(200,safe);
 }catch(error){return result(503,{code:error instanceof ReadFailure&&error.reason==='TIMEOUT'?'QUOTE_TIMEOUT':'QUOTE_SERVICE_UNAVAILABLE',error:'Quote service is temporarily unavailable. Retry shortly.'});}finally{life.close();}
}
type Provider='alchemy'|'1inch'|'ankr'|'explorer'|'moralis';
type ProviderResult={provider:Provider;status:'complete'|'partial'|'unavailable'|'not-configured';reason?:string;count:number;pages:number};
const positiveBalance=(v:unknown)=>typeof v==='number'?Number.isFinite(v)&&v>0:typeof v==='string'&&v.length<=160&&(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v)&&/[1-9]/.test(v)||/^0x[0-9a-fA-F]{1,64}$/.test(v)&&BigInt(v)>0n);
/** Five bounded concurrent providers; discovery amounts never become transaction amounts. */
export async function discoverTokens(params:URLSearchParams,env:SweeperReadEnv,options:Options={}):Promise<ApiResult>{
 let chainId:string,wallet:string,chain:Chain;try{allowedParams(params,['chainId','wallet']);chainId=params.get('chainId')??'';wallet=params.get('wallet')??'';chain=READ_API_CHAINS[chainId];if(!chain||!address(wallet))throw Error();wallet=wallet.toLowerCase();}catch{return result(400,{error:'Invalid supported chain or wallet address.',code:'INVALID_DISCOVERY_REQUEST'});}
 const life=budget(options,7800),fetcher=options.fetchImpl??fetch,tokens=new Set<string>(),cap=10000;let capped=false;
 const add=(value:unknown)=>{if(life.expired()||!address(value))return;if(tokens.size>=cap&&!tokens.has(value.toLowerCase())){capped=true;return;}tokens.add(value.toLowerCase());};
 async function request(url:string,init:RequestInit={}){if(life.expired())throw new ReadFailure('TIMEOUT');const r=await readJson(fetcher,url,life.signal,init);if(!r.ok)throw new ReadFailure('HTTP',r.status);return r.data;}
 async function provider(provider:Provider,configured:boolean,operation:(mark:(state:Partial<ProviderResult>)=>void)=>Promise<void>):Promise<ProviderResult>{const state:ProviderResult={provider,status:configured?'complete':'not-configured',count:0,pages:0};if(!configured)return state;try{await life.run(operation(p=>{if(!life.expired())Object.assign(state,p);}));}catch(error){state.status='partial';state.reason=error instanceof ReadFailure?error.reason:'INVALID_RESPONSE';}return state;}
 const alchemyKey=env.ALCHEMY_API_KEY||env.ALCHEMY_KEY||env.NEXT_PUBLIC_ALCHEMY_KEY;
 const jobs=[
  provider('alchemy',Boolean(alchemyKey&&chain.alchemy),async mark=>{let pageKey:string|undefined,pages=0,count=0;const seen=new Set<string>();for(;pages<10;){const args:any[]=[wallet,'erc20'];if(pageKey)args.push({pageKey});const d=await request('https://'+chain.alchemy+'.g.alchemy.com/v2/'+encodeURIComponent(alchemyKey!),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'alchemy_getTokenBalances',params:args,id:pages+1})});if(d?.error||!Array.isArray(d?.result?.tokenBalances))throw new ReadFailure('INVALID_RESPONSE');pages++;for(const t of d.result.tokenBalances)if(positiveBalance(t?.tokenBalance)&&address(t?.contractAddress)){add(t.contractAddress);count++;}mark({pages,count});const next=d.result.pageKey;if(next===undefined||next===null||next==='')return;if(typeof next!=='string'||next.length>2048||seen.has(next))throw new ReadFailure('INVALID_RESPONSE');seen.add(next);pageKey=next;}mark({status:'partial',reason:'PAGE_LIMIT',pages,count});}),
  provider('1inch',true,async mark=>{const d=await request('https://balances.1inch.io/v1.2/'+chainId+'/balances/'+wallet,{headers:{accept:'application/json'}});if(!object(d)||d.error||Object.keys(d).some(a=>!address(a)))throw new ReadFailure('INVALID_RESPONSE');let count=0;for(const[a,b]of Object.entries(d))if(address(a)&&positiveBalance(b)){add(a);count++;}mark({count,pages:1});}),
  provider('ankr',true,async mark=>{const d=await request('https://rpc.ankr.com/multichain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'ankr_getAccountBalance',params:{blockchain:[chain.ankr],walletAddress:wallet,onlyWhitelisted:false},id:1})});if(d?.error||!Array.isArray(d?.result?.assets))throw new ReadFailure('INVALID_RESPONSE');let count=0;for(const a of d.result.assets)if(address(a?.contractAddress)&&positiveBalance(a?.balance)){add(a.contractAddress);count++;}mark({count,pages:1,...(d.result.nextPageToken?{status:'partial',reason:'PAGE_LIMIT'}:{})});}),
  provider('explorer',true,async mark=>{const url=new URL(chain.explorer);url.search=new URLSearchParams({module:'account',action:'tokentx',address:wallet,page:'1',offset:'1000',sort:'desc'}).toString();const key=env[chain.explorerKey];if(key)url.searchParams.set('apikey',key);const d=await request(url.href);if(d?.status==='0'&&Array.isArray(d.result)&&!d.result.length){mark({pages:1});return;}if(d?.status!=='1'||!Array.isArray(d.result))throw new ReadFailure('INVALID_RESPONSE');let count=0;for(const t of d.result)if(address(t?.contractAddress)){add(t.contractAddress);count++;}mark({count,pages:1,...(d.result.length>=1000?{status:'partial',reason:'PAGE_LIMIT'}:{})});}),
  provider('moralis',Boolean(env.MORALIS_API_KEY&&chain.moralis),async mark=>{const url=new URL('https://deep-index.moralis.io/api/v2.2/'+wallet+'/erc20');url.searchParams.set('chain',chain.moralis!);const d=await request(url.href,{headers:{accept:'application/json','X-API-Key':env.MORALIS_API_KEY!}}),rows=Array.isArray(d)?d:d?.result;if(!Array.isArray(rows))throw new ReadFailure('INVALID_RESPONSE');let count=0;for(const t of rows)if(address(t?.token_address)&&(t.balance===undefined||positiveBalance(t.balance))){add(t.token_address);count++;}mark({count,pages:1,...(!Array.isArray(d)&&d.cursor?{status:'partial',reason:'PAGE_LIMIT'}:{})});}),
 ];
 try{const providers=await Promise.all(jobs),partial=capped||providers.some(p=>p.status==='partial'||p.status==='unavailable'),list=[...tokens].sort();return result(200,{tokens:list,count:list.length,partial,complete:!partial,providers,budgetMs:life.ms,logs:providers.map(p=>p.provider+': '+p.status+'; '+p.count+' token candidates'+(p.reason?' ('+p.reason+')':'')),limitations:['Discovery returns a bounded union of candidates, not proof that every wallet token was indexed or is tradeable.','Current balances, units and executable routes must be checked separately. Manual token entry remains available.']});}finally{life.close();}
}
