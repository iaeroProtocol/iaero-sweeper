import {admitProviderUsage} from './provider-budget.mjs';

const OPERATIONS = new Set(['status','discover','quote','construct','reconcile']);
const respond = (status,data,headers={}) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
async function readBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')) return null;
  const reader=request.body?.getReader();if(!reader)return null;let size=0;const chunks=[];let timer;
  try {
    const read=async()=>{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>32_768)throw new Error('size');chunks.push(r.value);}const bytes=new Uint8Array(size);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));};
    return await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new Error('deadline'));},1_000);})]);
  }catch{return null;}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
export function createSolanaApiGateway(helpers) {
  return async(request,env,ctx)=>{
    const url=new URL(request.url);if(!url.pathname.startsWith('/api/solana/'))return null;
    const operation=url.pathname.slice('/api/solana/'.length);
    if(!OPERATIONS.has(operation))return respond(404,{code:'SOLANA_ROUTE_UNKNOWN',error:'Unknown Solana operation.'});
    if(url.search||request.method!==(operation==='status'?'GET':'POST'))return respond(400,{code:'SOLANA_INVALID_REQUEST',error:'Invalid Solana request.'});
    if(typeof helpers?.parseSolanaRequest!=='function'||typeof helpers?.handleSolanaRequest!=='function')return respond(503,{code:'SOLANA_GUARD_UNAVAILABLE',error:'Solana read service is unavailable.'});
    const body=operation==='status'?{}:await readBody(request);const parsed=helpers.parseSolanaRequest(operation,body);
    if(!parsed)return respond(400,{code:'SOLANA_INVALID_REQUEST',error:'Invalid Solana request.'});
    // Same global/client D1 ledger as EVM. Structural failures never debit it.
    // Construct makes one Jupiter call and one bounded JSON-RPC batch: weight2.
    const usage=operation==='discover'?{route:'discovery',units:12}:operation==='construct'?{route:'prices',units:2}:{route:'quote',units:1};
    const denied=await admitProviderUsage(request,env,ctx,usage);if(denied)return denied;
    const lazy={};for(const key of ['HELIUS_API_KEY','SOLANA_PLATFORM_FEE_WALLET','NEXT_PUBLIC_PLATFORM_FEE_WALLET'])Object.defineProperty(lazy,key,{get:()=>env[key],enumerable:true});
    try{const result=await helpers.handleSolanaRequest(operation,parsed,lazy,{signal:request.signal});
      if(!result||!Number.isInteger(result.status)||result.status<200||result.status>599||!result.data||typeof result.data!=='object')throw new Error('invalid');
      return respond(result.status,result.data,{'x-provider-budget':'d1-v1','x-provider-budget-state':'admitted',...(result.status===429?{'retry-after':'60'}:{})});
    }catch{return respond(503,{code:'SOLANA_READ_UNAVAILABLE',error:'Solana read service is temporarily unavailable.'});}
  };
}
