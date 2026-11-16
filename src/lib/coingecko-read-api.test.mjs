import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {parsePriceRequest,handlePriceRequest,PRICE_PLATFORMS} from './coingecko-read-api.ts';
const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const addresses=Array.from({length:100},(_,i)=>address(i+1));
const request=(rows=addresses.slice(0,1),chainId=8453)=>parsePriceRequest({chainId,addresses:rows});
const env={COINGECKO_API_KEY:'fixture-secret-never-output'};
const assertSafe=result=>{
  const json=JSON.stringify(result);
  assert.doesNotMatch(json,/fixture-secret|SECRET_PROVIDER|https?:|pro-api|x-cg-pro-api-key/i);
  assert.equal(result.headers['cache-control'],'no-store');
};
const failClosed=result=>{assertSafe(result);assert.deepEqual(result.data.prices,{});assert.equal(result.data.found,0);assert.notEqual(result.status,200);};

test('strict parser supports all nine platforms; freezes deduped cost and caps raw array before fetch',()=>{
  assert.equal(Object.keys(PRICE_PLATFORMS).length,9);
  for(const chainId of Object.keys(PRICE_PLATFORMS).map(Number))assert.equal(request(undefined,chainId).chainId,chainId);
  const upper='0x'+'a'.repeat(40).toUpperCase();
  const parsed=request([upper,upper.toLowerCase()]);
  assert.deepEqual(parsed.addresses,[upper.toLowerCase()]);assert.equal(parsed.cost,1);assert(Object.isFrozen(parsed));assert(Object.isFrozen(parsed.addresses));
  for(const [length,cost]of [[1,1],[50,1],[51,2],[100,2]])assert.equal(request(addresses.slice(0,length)).cost,cost);
  for(const body of [null,[],{},'secret',1,{chainId:'8453',addresses:[address(1)]},{chainId:8453.1,addresses:[address(1)]},{chainId:999,addresses:[address(1)]},{chainId:8453,addresses:[]},{chainId:8453,addresses:Array(1)},{chainId:8453,addresses:[...addresses,address(101)]},{chainId:8453,addresses:Array(101).fill(address(1))},{chainId:8453,addresses:[address(0)]},{chainId:8453,addresses:['0x'+'e'.repeat(40)]},{chainId:8453,addresses:[address(1)],apiKey:'SECRET_PROVIDER'},{chainId:8453,addresses:[address(1)],cost:1},{chainId:8453,addresses:['https://SECRET_PROVIDER.invalid']}])assert.throws(()=>parsePriceRequest(body),/^Error: Invalid price request\.$/);
});

test('handler revalidates full parsed shape/cost before any key access, including cancelled calls',async()=>{
  let keyReads=0,fetches=0;
  const protectedEnv={get COINGECKO_API_KEY(){keyReads++;throw Error('SECRET_PROVIDER');}};
  const options={fetchImpl:async()=>{fetches++;throw Error('SECRET_PROVIDER');}};
  for(const parsed of [undefined,{chainId:8453,addresses:[address(1)]},{...request(),extra:true},{...request(),cost:2},{...request(addresses),cost:1},{chainId:1.1,addresses:[address(1)],cost:1},{chainId:8453,addresses:[address(0)],cost:1}]){
    const result=await handlePriceRequest(parsed,protectedEnv,options);assert.equal(result.status,400);failClosed(result);
  }
  const controller=new AbortController();controller.abort('SECRET_PROVIDER');
  const cancelled=await handlePriceRequest(request(),protectedEnv,{...options,signal:controller.signal});assert.equal(cancelled.data.code,'PRICE_CANCELLED');failClosed(cancelled);
  assert.equal(keyReads,0);assert.equal(fetches,0);
  const unavailable=await handlePriceRequest(request(),protectedEnv,options);assert.equal(keyReads,1);assert.equal(unavailable.status,503);assert.equal(fetches,0);failClosed(unavailable);
});

test('all platform reads use fixed HTTPS origin, proper encoded query and numeric requested-only projection',async()=>{
  for(const [chainId,platform]of Object.entries(PRICE_PLATFORMS)){
    let calls=0;
    const result=await handlePriceRequest(request(undefined,Number(chainId)),env,{fetchImpl:async(url,init)=>{
      calls++;const u=new URL(url);assert.equal(u.origin,'https://pro-api.coingecko.com');assert.equal(u.pathname,'/api/v3/simple/token_price/'+platform);assert.equal(u.searchParams.get('contract_addresses'),address(1));assert.equal(u.searchParams.get('vs_currencies'),'usd');assert.equal([...u.searchParams].length,2);assert.equal(u.username,'');assert.equal(u.password,'');assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');assert.equal(init.headers.Accept,'application/json');assert.equal(init.headers['x-cg-pro-api-key'],env.COINGECKO_API_KEY);assert(init.signal instanceof AbortSignal);
      return Response.json({[address(1)]:{usd:12.5,extra:'SECRET_PROVIDER'},[address(999)]:{usd:999},ignored:'SECRET_PROVIDER'});
    }});
    assert.equal(calls,1);assert.equal(result.status,200);assert.deepEqual(result.data.prices,{[address(1)]:12.5});assert.equal(result.data.found,1);assert.equal(result.data.requested,1);assertSafe(result);
  }
});

test('100 unique inputs cause exactly two concurrent50-token requests with one signal, no retry',async()=>{
  let active=0,peak=0,calls=0,release;const gate=new Promise(r=>release=r),signals=[];
  const result=await handlePriceRequest(request(addresses),env,{fetchImpl:async(url,init)=>{
    calls++;active++;peak=Math.max(peak,active);signals.push(init.signal);if(calls===2)release();await gate;
    const batch=new URL(url).searchParams.get('contract_addresses').split(',');assert.equal(batch.length,50);active--;
    return Response.json(Object.fromEntries(batch.map(token=>[token,{usd:2}])));
  }});
  assert.equal(calls,2);assert.equal(peak,2);assert.equal(signals[0],signals[1]);assert.equal(result.status,200);assert.equal(result.data.found,100);assert.equal(result.data.requested,100);assertSafe(result);
});

test('429 on either batch fails the whole100-token result, preserves safe Retry-After and never retries',async()=>{
  let calls=0;
  const result=await handlePriceRequest(request(addresses),env,{fetchImpl:async()=>{
    calls++;return calls===1?Response.json({SECRET_PROVIDER:env.COINGECKO_API_KEY},{status:429,headers:{'Retry-After':'120'}}):Response.json({[address(51)]:{usd:2}});
  }});
  assert.equal(calls,2);assert.equal(result.status,429);assert.equal(result.headers['retry-after'],'120');assert.equal(result.data.requested,100);failClosed(result);
  for(const retry of ['https://SECRET_PROVIDER.invalid',env.COINGECKO_API_KEY,'-1','0','9999999999']){
    const r=await handlePriceRequest(request(),env,{fetchImpl:async()=>Response.json({},{status:429,headers:{'Retry-After':retry}})});
    assert.equal(r.status,429);assert.match(r.headers['retry-after'],/^(?:30|300)$/);failClosed(r);
  }
});

test('redirects are not followed; HTTP and credential failures never expose provider details',async()=>{
  for(const status of [301,302,307,308,400,401,403,404,500,503]){
    let calls=0;const result=await handlePriceRequest(request(),env,{fetchImpl:async(_url,init)=>{
      calls++;assert.equal(init.redirect,'manual');return new Response('SECRET_PROVIDER '+env.COINGECKO_API_KEY,{status,headers:{Location:'https://SECRET_PROVIDER.invalid/?key='+env.COINGECKO_API_KEY}});
    }});
    assert.equal(calls,1);assert.equal(result.status,503);assert.equal(result.data.code,'PRICE_UPSTREAM');failClosed(result);
  }
});

test('256KiB body limit applies to streamed bytes as well as declared Content-Length',async()=>{
  const limit=256*1024,encoder=new TextEncoder(),base=JSON.stringify({[address(1)]:{usd:1}});
  const valid=await handlePriceRequest(request(),env,{fetchImpl:async()=>new Response(base+' '.repeat(limit-base.length))});assert.equal(valid.status,200);
  for(const declared of [false,true]){
    let cancelled=false;
    const stream=new ReadableStream({start(controller){controller.enqueue(encoder.encode(base));controller.enqueue(new Uint8Array(limit));},cancel(){cancelled=true;}});
    const result=await handlePriceRequest(request(),env,{fetchImpl:async()=>new Response(stream,{headers:declared?{'Content-Length':String(limit+1)}:{}})});
    assert.equal(result.status,503);assert.equal(result.data.code,'PRICE_RESPONSE_LIMIT');assert.equal(cancelled,true);failClosed(result);
  }
});

test('invalid JSON/top-level shapes fail closed; missing and invalid prices stay unknown, neverzero',async()=>{
  for(const data of [null,[],1,'SECRET_PROVIDER',{error:'SECRET_PROVIDER'},{status:{error_code:401,error_message:env.COINGECKO_API_KEY}}]){
    const result=await handlePriceRequest(request(),env,{fetchImpl:async()=>Response.json(data)});assert.equal(result.status,503);assert.equal(result.data.code,'PRICE_INVALID_RESPONSE');failClosed(result);
  }
  const malformed=await handlePriceRequest(request(),env,{fetchImpl:async()=>new Response('SECRET_PROVIDER '+env.COINGECKO_API_KEY)});assert.equal(malformed.data.code,'PRICE_INVALID_RESPONSE');failClosed(malformed);
  const rows=addresses.slice(0,8),data={
    [rows[0]]:{usd:2},[rows[1]]:{usd:'3'},[rows[2]]:{usd:0},[rows[3]]:{usd:-1},[rows[4]]:{usd:null},[rows[5]]:[],[rows[6]]:null,
    [address(999)]:{usd:999},
  };
  const filtered=await handlePriceRequest(request(rows),env,{fetchImpl:async()=>Response.json(data)});assert.equal(filtered.status,200);assert.deepEqual(filtered.data.prices,{[rows[0]]:2});assert.equal(filtered.data.found,1);assert.equal(filtered.data.requested,8);assertSafe(filtered);
});

test('one deadline returns despite a fetch/body ignoring abort; external cancellation starts no extra work',async()=>{
  for(const body of [false,true]){
    let calls=0;const start=performance.now();
    const result=await handlePriceRequest(request(addresses),env,{budgetMs:20,fetchImpl:async()=>{
      calls++;return body?new Response(new ReadableStream({start(){},cancel(){return new Promise(()=>{});}})):new Promise(()=>{});
    }});
    assert.equal(result.data.code,'PRICE_TIMEOUT');assert.equal(calls,2);assert(performance.now()-start<400);failClosed(result);
  }
  const controller=new AbortController();let calls=0;const start=performance.now();
  const work=handlePriceRequest(request(addresses),env,{signal:controller.signal,fetchImpl:async()=>{calls++;return new Promise(()=>{});}});
  setTimeout(()=>controller.abort('SECRET_PROVIDER'),15);const result=await work;
  assert.equal(result.data.code,'PRICE_CANCELLED');assert.equal(calls,2);assert(performance.now()-start<400);failClosed(result);
});

test('configured larger timeout cannot expand the3500ms whole-request cap',async()=>{
  let calls=0;const start=performance.now();
  const result=await handlePriceRequest(request(),env,{budgetMs:60_000,fetchImpl:async()=>{calls++;return new Promise(()=>{});}});
  const elapsed=performance.now()-start;assert.equal(calls,1);assert.equal(result.data.code,'PRICE_TIMEOUT');assert(elapsed>=3000&&elapsed<4500,`Unexpected hard deadline ${elapsed}ms`);failClosed(result);
});
