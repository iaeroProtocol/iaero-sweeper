import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('./stock-display-estimates.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
const {runStockDisplayEstimates,stockDisplayValue,STOCK_DISPLAY_USDC}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {BASE_STOCK_DISPLAY_ADDRESSES}=await import('./sweep-inventory.ts');
const account='0x1111111111111111111111111111111111111111',other='0x2222222222222222222222222222222222222222',now=1_800_000_000_000;
const input=(i=0,extra={})=>({token:BASE_STOCK_DISPLAY_ADDRESSES[i],decimals:8,unitsVerified:true,balance:200_000_000n,...extra});
const quote=request=>({...request,netAmountOut:1_500_000n,quotedAt:now-1000});
const usdcPrice=(extra={})=>({chainId:8453,token:STOCK_DISPLAY_USDC,price:1.01,source:'defillama',observedAt:now-1000,retrievedAt:now-500,timeBasis:'provider-time',...extra});
const context=(extra={})=>({chainId:8453,account,...input(),now,...extra});
const run=extra=>runStockDisplayEstimates({chainId:8453,account,inputs:[input()],quote:async request=>quote(request),now:()=>now,...extra});

test('exact native raw identity yields immutable USDC display values without independent input promotion',async()=>{
  const original=input(),quoteObject=quote({account,tokenIn:original.token,tokenOut:STOCK_DISPLAY_USDC,amountIn:original.balance,decimals:8});
  const results=await run({inputs:[original],quote:async()=>quoteObject}),estimate=results[original.token];
  assert(Object.isFrozen(results));assert(Object.isFrozen(estimate));assert.equal(estimate.quotedAt,now-1000);assert.equal(estimate.balance,200_000_000n);assert.equal(estimate.usdcAmount,1_500_000n);
  assert.equal('priceObservation'in estimate,false);assert.equal('price'in estimate,false);assert.equal('valueUsd'in estimate,false);assert.equal('selected'in estimate,false);
  assert.deepEqual(stockDisplayValue(estimate,context()),{usdcUnits:1_500_000n,valueUsd:null,priceUsd:null});
  quoteObject.netAmountOut=1n;original.balance=1n;assert.equal(estimate.usdcAmount,1_500_000n);assert.equal(estimate.balance,200_000_000n);
});

test('USD conversion requires genuine current correctly bound USDC evidence, never a peg or stock quote',async()=>{
  const price=usdcPrice(),estimate=(await run({usdcPrice:price}))[input().token];
  assert(Object.isFrozen(estimate.usdcPrice));assert.notEqual(estimate.usdcPrice,price);assert.equal(estimate.usdcPrice.observedAt,now-1000);
  assert.deepEqual(stockDisplayValue(estimate,context()),{usdcUnits:1_500_000n,valueUsd:1.5150000000000001,priceUsd:0.7575000000000001});
  const part=stockDisplayValue(estimate,context({amount:50_000_000n}));assert.equal(part.usdcUnits,375_000n);assert.equal(part.priceUsd,0.7575000000000001);
  for(const bad of [{source:'stablecoin'},{source:'native'},{source:'zerox'},{chainId:1},{token:input().token},{price:0},{price:NaN},{observedAt:now-300001},{retrievedAt:now-300001}]){
    const record=(await run({usdcPrice:usdcPrice(bad)}))[input().token];assert.equal(record.usdcPrice,undefined);assert.deepEqual(stockDisplayValue(record,context()),{usdcUnits:1_500_000n,valueUsd:null,priceUsd:null});
  }
});

test('current account/chain/token/units/exact balance and positive custom cap bind every display read',async()=>{
  const estimate=(await run())[input().token];
  for(const change of [{chainId:1},{account:other},{token:BASE_STOCK_DISPLAY_ADDRESSES[1]},{decimals:18},{unitsVerified:false},{balance:200_000_001n},{balance:0n},{amount:0n},{amount:-1n},{amount:200_000_001n}])assert.equal(stockDisplayValue(estimate,context(change)),undefined);
  assert.equal(stockDisplayValue(estimate,context({amount:1n})),undefined,'Sub-microUSDC projection stays unavailable, not0');
  const upper=context({account:account.toUpperCase(),token:input().token.toUpperCase()});assert(stockDisplayValue(estimate,upper));
});

test('wrong quote identity/amount/units/nonpositive uint and stale/future timestamps are isolated',async()=>{
  for(const change of [{account:other},{tokenIn:other},{tokenOut:other},{amountIn:1n},{decimals:null},{decimals:18},{netAmountOut:0n},{netAmountOut:-1n},{netAmountOut:2n**256n},{quotedAt:NaN},{quotedAt:now-120001},{quotedAt:now+5001}])assert.deepEqual(await run({quote:async request=>({...quote(request),...change})}),{});
  for(const quotedAt of[now-120000,now+5000])assert((await run({quote:async request=>({...quote(request),quotedAt})}))[input().token]);
  let time=now;const results=await run({now:()=>time,quote:async request=>{time+=121000;return quote(request);}});assert.deepEqual(results,{},'Time is checked when quote completes, not only at dispatch');
});

test('all14 catalog tokens cap work with concurrency2 and publish healthy results progressively',async()=>{
  const inputs=BASE_STOCK_DISPLAY_ADDRESSES.map((_,i)=>input(i));inputs.push(...inputs, input(0,{token:'0xb200'+'0'.repeat(35)+'1'}));
  let active=0,peak=0,calls=0,published=0;
  const results=await run({inputs,quote:async request=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return quote(request);},onEstimate:estimate=>{published++;assert(Object.isFrozen(estimate));}});
  assert.equal(calls,14);assert.equal(peak,2);assert.equal(published,14);assert.equal(Object.keys(results).length,14);
});

test('wrong chain/no eligible holdings and pre-cancellation start zero quotes',async()=>{
  let calls=0;const callback=async request=>{calls++;return quote(request);};
  for(const extra of [{chainId:1},{account:'0x'+'0'.repeat(40)},{inputs:[]},{shouldContinue:()=>false},{inputs:[input(0,{token:other}),input(0,{balance:0n}),input(0,{decimals:37}),input(0,{decimals:NaN}),input(0,{unitsVerified:false})]}])assert.deepEqual(await run({...extra,quote:callback}),{});
  assert.equal(calls,0);
});

test('cancellation stops queued tasks and suppresses all late callbacks/results without abort promises',async()=>{
  let active=true,calls=0,published=0,release;const gate=new Promise(r=>release=r);
  const pending=run({inputs:BASE_STOCK_DISPLAY_ADDRESSES.map((_,i)=>input(i)),shouldContinue:()=>active,quote:async request=>{calls++;await gate;return quote(request);},onEstimate:()=>published++});
  assert.equal(calls,2);active=false;release();assert.deepEqual(await pending,{});assert.equal(calls,2);assert.equal(published,0);
});

test('individual route/callback failures preserve other estimates and never reset original ages',async()=>{
  const original=usdcPrice({observedAt:now-299000,retrievedAt:now-1000});let callbacks=0;
  const results=await run({inputs:[input(0),input(1),input(2)],usdcPrice:original,quote:async request=>{if(request.tokenIn===input(1).token)throw Error('Synthetic route unavailable');return quote(request);},onEstimate:()=>{callbacks++;throw Error('Synthetic callback failure');}});
  assert.equal(Object.keys(results).length,2);assert.equal(callbacks,2);
  const estimate=results[input().token];assert.equal(estimate.quotedAt,now-1000);assert.equal(estimate.usdcPrice.observedAt,now-299000);
  assert.equal(stockDisplayValue(estimate,context({now:now+1001})).valueUsd,null,'Expired USDC evidence falls back to USDC without relabeling age');
  assert.equal(stockDisplayValue(estimate,context({now:now+119001})),undefined,'Native quote itself expires after120s');
  const huge=(await run({usdcPrice:usdcPrice({price:Number.MAX_VALUE})}))[input().token];assert.equal(stockDisplayValue(huge,context()).valueUsd,null,'Nonfinite conversion cannot be displayed');
});
