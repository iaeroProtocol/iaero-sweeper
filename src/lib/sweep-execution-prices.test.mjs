import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled = await build({entryPoints:[new URL('./sweep-execution-prices.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
const {createExecutionPriceReader} = await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const now=1_800_000_000_000;
const token=n=>'0x'+n.toString(16).padStart(40,'0');
const input=(n,priceObservation)=>({address:token(n),decimals:8,balance:123456789n,symbol:'STOCK'+n,priceObservation});
const price=(n,time=now,extra={})=>({chainId:8453,token:token(n),price:10,source:'defillama',observedAt:time,retrievedAt:time,timeBasis:'provider-time',...extra});

test('fresh observations add zero requests and preserve original timestamps and inputs',async()=>{
  const original=input(1,price(1,now-240000)),before=structuredClone(original);let calls=0;
  const read=createExecutionPriceReader({chainId:8453,now:()=>now,read:async()=>{calls++;return {};}});
  assert.equal((await read([original])).get(token(1)),original.priceObservation);
  await read([original]);assert.equal(calls,0);assert.deepEqual(original,before);
});

test('expired stock and output observations renew together once with duplicate addresses removed',async()=>{
  let time=now+300001;const calls=[];
  const read=createExecutionPriceReader({chainId:8453,now:()=>time,read:async inputs=>{
    calls.push(inputs.map(t=>t.address));return Object.fromEntries(inputs.map(t=>[t.address,{observation:price(Number(BigInt(t.address)),time,{price:11})}]));
  }});
  const original=[input(1,price(1)),input(2,price(2))];
  const values=await read([...original,original[0]]);
  assert.deepEqual(calls,[[token(1),token(2)]]);assert.equal(values.get(token(1)).price,11);
  time+=1000;assert.equal((await read(original)).get(token(1)).observedAt,now+300001);assert.equal(calls.length,1);
  assert.equal(original[0].priceObservation.observedAt,now);
});

test('invalid refreshed chain, token, stale evidence and missing prices stay unavailable without invented age',async()=>{
  let calls=0;const read=createExecutionPriceReader({chainId:8453,now:()=>now,read:async()=>{
    calls++;return {[token(1)]:{observation:price(1,now,{chainId:1})},[token(2)]:{observation:price(9)},[token(3)]:{observation:price(3,now-300001)}};
  }});
  const inputs=[1,2,3,4].map(n=>input(n));
  for(const value of (await read(inputs)).values())assert.equal(value,undefined);
  await read(inputs);assert.equal(calls,1);
});

test('failed missing-price requests are bounded and can recover after the thirty-second cooldown',async()=>{
  let time=now,calls=0;
  const read=createExecutionPriceReader({chainId:8453,now:()=>time,read:async()=>{
    if(++calls===1)throw Error('synthetic outage');return {[token(1)]:{observation:price(1,time)}};
  }});
  assert.equal((await read([input(1)])).get(token(1)),undefined);
  time+=29999;await read([input(1)]);assert.equal(calls,1);
  time++;assert.equal((await read([input(1)])).get(token(1)).observedAt,time);assert.equal(calls,2);
});

test('evidence expiring during a provider request is rejected at completion',async()=>{
  let time=now;
  const read=createExecutionPriceReader({chainId:8453,now:()=>time,read:async()=>{
    time+=300001;return {[token(1)]:{observation:price(1)}};
  }});
  assert.equal((await read([input(1)])).get(token(1)),undefined);
});

test('a successfully renewed observation may renew again on expiry without a false cooldown',async()=>{
  let time=now,calls=0;
  const read=createExecutionPriceReader({chainId:8453,now:()=>time,read:async()=>{
    calls++;return {[token(1)]:{observation:price(1,time-(calls===1?299000:0))}};
  }});
  assert.equal((await read([input(1)])).get(token(1)).observedAt,now-299000);
  time+=1001;assert.equal((await read([input(1)])).get(token(1)).observedAt,time);assert.equal(calls,2);
});

test('new batches reuse the common output observation and request only their expired inputs',async()=>{
  const requests=[];const read=createExecutionPriceReader({chainId:8453,now:()=>now,read:async inputs=>{
    requests.push(inputs.map(t=>t.address));return Object.fromEntries(inputs.map(t=>[t.address,{observation:price(Number(BigInt(t.address)))}]));
  }});
  await read([input(1),input(3)]);await read([input(2),input(3)]);
  assert.deepEqual(requests,[[token(1),token(3)],[token(2)]]);
});
