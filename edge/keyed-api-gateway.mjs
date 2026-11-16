import {admitProviderUsage} from './provider-budget.mjs';
import {createDiscoveryGateway} from './discovery-gateway.mjs';

const PATHS = Object.freeze({
  '/api/tokens/discover':'discovery', '/api/0x/quote':'quote',
  '/api/coingecko/prices':'prices',
});
const CHAINS = new Set(['1','8453','42161','10','137','56','43114','534352','59144']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value)
  && !/^0x(?:0{40}|e{40})$/i.test(value);

function response(status,data,state,extra={}) {
  return Response.json(data,{status,headers:{'cache-control':'no-store',
    'x-content-type-options':'nosniff','x-provider-budget':'d1-v1',
    'x-provider-budget-state':state,...extra}});
}
function failure(status,code,error,headers={}) {
  return response(status,{code,error},'invalid',headers);
}
function unavailable() {
  return response(503,{code:'PROVIDER_BUDGET_UNAVAILABLE',
    error:'Read service is temporarily unavailable. Retry shortly.'},'unavailable',{'retry-after':'60'});
}
function discoveryParams(params) {
  const keys=[...params.keys()];
  return keys.length===2 && new Set(keys).size===2
    && keys.every(key=>key==='chainId'||key==='wallet')
    && CHAINS.has(params.get('chainId')) && address(params.get('wallet'));
}

// Actual body bytes and elapsed time are bounded, regardless of Content-Length.
// This is validation only; no provider binding is inspected before admission.
async function priceBody(request) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'')) {
    return {error:failure(415,'INVALID_PRICE_CONTENT_TYPE','Price requests require application/json.')};
  }
  const declared=request.headers.get('content-length');
  if(declared!==null && (!/^\d{1,10}$/.test(declared)||Number(declared)>8192)) {
    return {error:failure(413,'PRICE_BODY_TOO_LARGE','Price requests are limited to 8192 bytes.')};
  }
  const reader=request.body?.getReader();
  if(!reader)return {error:failure(400,'INVALID_PRICE_REQUEST','A JSON price request is required.')};
  let timer,cancel,size=0,finished=false;
  try {
    const stopped=new Promise((_,reject)=>{
      cancel=()=>reject(new Error('Body deadline or cancellation'));
      timer=setTimeout(cancel,1000);
      request.signal?.addEventListener('abort',cancel,{once:true});
      if(request.signal?.aborted)cancel();
    });
    const operation=(async()=>{
      const chunks=[];
      for(;;) {
        const {value,done}=await reader.read();
        if(done){finished=true;break;}
        size+=value.byteLength;
        if(size>8192)throw new RangeError('Body byte limit');
        chunks.push(value);
      }
      const bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    })();
    return {body:await Promise.race([operation,stopped])};
  } catch(error) {
    return {error:error instanceof RangeError
      ?failure(413,'PRICE_BODY_TOO_LARGE','Price requests are limited to 8192 bytes.')
      :failure(400,'INVALID_PRICE_REQUEST','A valid bounded JSON price request is required.')};
  } finally {
    clearTimeout(timer);request.signal?.removeEventListener('abort',cancel);
    // Cancellation need not complete before the fixed deadline returns. The
    // reader promise has a rejection handler through the raced operation.
    if(!finished)void reader.cancel().catch(()=>{});
  }
}

function lazyBindings(env,names) {
  const projected=Object.create(null);
  for(const name of names)Object.defineProperty(projected,name,{enumerable:true,get(){
    const value=env?.[name];
    if(value!==undefined && typeof value!=='string')throw new Error('Invalid provider binding');
    return value;
  }});
  return projected;
}

export function createKeyedApiGateway({discoverTokens,handleQuoteRequest,parsePriceRequest,handlePriceRequest}) {
  if([discoverTokens,handleQuoteRequest,parsePriceRequest,handlePriceRequest].some(fn=>typeof fn!=='function')) {
    throw new TypeError('All bounded provider helpers are required');
  }
  const discovery=createDiscoveryGateway(discoverTokens);
  return async function keyedApiGateway(request,env,ctx) {
    const url=new URL(request.url),route=PATHS[url.pathname];
    if(!route)return null;
    const method=route==='prices'?'POST':'GET';
    if(request.method!==method)return failure(405,'INVALID_READ_METHOD','Unsupported read method.',{allow:method});
    if(url.search.length>2048)return failure(400,'INVALID_READ_REQUEST','Read parameters exceed the supported limit.');
    let parsed,units=route==='discovery'?12:1;
    if(route==='discovery'&&!discoveryParams(url.searchParams)) {
      return failure(400,'INVALID_DISCOVERY_REQUEST','Invalid supported chain or wallet address.');
    }
    if(route==='prices') {
      if(url.search)return failure(400,'INVALID_PRICE_REQUEST','Price request parameters belong in the JSON body.');
      const loaded=await priceBody(request);if(loaded.error)return loaded.error;
      try {parsed=parsePriceRequest(loaded.body);}catch{return failure(400,'INVALID_PRICE_REQUEST','Invalid chain or token address list (maximum 100).');}
      if(!object(parsed)||!Array.isArray(parsed.addresses)||parsed.addresses.length<1||parsed.addresses.length>100
        ||parsed.cost!==Math.ceil(parsed.addresses.length/50))return unavailable();
      units=parsed.cost;
    }
    try {
      const denied=await admitProviderUsage(request,env,ctx,{route,units});
      if(denied)return denied;
      if(request.signal?.aborted)return unavailable();
      if(route==='discovery') {
        const result=await discovery(request,env,ctx);
        if(!result)return unavailable();
        const headers=new Headers(result.headers);
        headers.set('x-provider-budget','d1-v1');headers.set('x-provider-budget-state','admitted');
        return new Response(result.body,{status:result.status,headers});
      }
      const reply=route==='quote'
        ?await handleQuoteRequest(url.searchParams,lazyBindings(env,['ZERO_EX_API_KEY','SWAP_FEE_BPS','SWAP_FEE_RECIPIENT']),{signal:request.signal})
        :await handlePriceRequest(parsed,lazyBindings(env,['COINGECKO_API_KEY']),{signal:request.signal});
      if(!object(reply)||!Number.isInteger(reply.status)||reply.status<200||reply.status>599||!object(reply.data))return unavailable();
      const retry=reply.headers?.['retry-after'];
      return response(reply.status,reply.data,'admitted',typeof retry==='string'&&/^\d{1,5}$/.test(retry)?{'retry-after':retry}:{});
    } catch {return unavailable();}
  };
}
