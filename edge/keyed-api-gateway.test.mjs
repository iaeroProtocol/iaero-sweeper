import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createKeyedApiGateway} from './keyed-api-gateway.mjs';
import {parsePriceRequest} from '../src/lib/coingecko-read-api.ts';
const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const wallet=address(10),token=address(11),keys=['ZERO_EX_API_KEY','COINGECKO_API_KEY','ALCHEMY_API_KEY'];
const schemas=await Promise.all(['provider-budget-schema.sql','discovery-schema.sql'].map(file=>readFile(new URL(file,import.meta.url),'utf8')));
globalThis.fetch=async()=>{throw new Error('No network in gateway tests');};
function setup({schema=true,discoverySchema=true}={}) {
 const db=new DatabaseSync(':memory:');if(schema)db.exec(schemas[0]);if(discoverySchema)db.exec(schemas[1]);
 const state={keyReads:[],calls:[],statements:0};
 const binding={prepare(sql){state.statements++;const stmt=db.prepare(sql);let values=[];return{bind(...input){values=input;return this;},async first(){return stmt.get(...values)??null;},async run(){stmt.run(...values);return{success:true};}};}};
 const env={DISCOVERY_DB:binding};
 for(const name of keys)Object.defineProperty(env,name,{get(){state.keyReads.push(name);return 'mock-'+name;}});
 const helpers={parsePriceRequest,
  async discoverTokens(params,projected){state.calls.push({route:'discovery',wallet:params.get('wallet')});assert.equal(projected.ALCHEMY_API_KEY,'mock-ALCHEMY_API_KEY');return{status:200,data:{tokens:[token],count:1}};},
  async handleQuoteRequest(params,projected){assert.equal(projected.ZERO_EX_API_KEY,'mock-ZERO_EX_API_KEY');state.calls.push({route:'quote'});return{status:200,data:{buyAmount:'100'},headers:{'x-secret-provider':'must-not-escape'}};},
  async handlePriceRequest(parsed,projected){assert.equal(projected.COINGECKO_API_KEY,'mock-COINGECKO_API_KEY');state.calls.push({route:'prices',cost:parsed.cost,count:parsed.addresses.length});return{status:200,data:{prices:{[token]:1}},headers:{'retry-after':'30','access-control-allow-origin':'*'}};},
 };
 return {db,state,env,helpers,gateway:createKeyedApiGateway(helpers),close:()=>db.close()};
}
function request(route='quote',{body,ip='192.0.2.1',method,query,cf=true,headers={},stream,signal}={}) {
 const path={quote:'/api/0x/quote',prices:'/api/coingecko/prices',discovery:'/api/tokens/discover'}[route]??route;
 const search=query??(route==='discovery'?`chainId=8453&wallet=${wallet}`:route==='quote'?'chainId=8453':'');
 const req=new Request('https://sweeper.invalid'+path+(search?'?'+search:''),{method:method??(route==='prices'?'POST':'GET'),
   headers:{'CF-Connecting-IP':ip,...(route==='prices'?{'Content-Type':'application/json'}:{}),...headers},
   ...(stream?{body:stream,duplex:'half'}:body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),signal});
 if(cf)Object.defineProperty(req,'cf',{value:{colo:'LHR'}});return req;
}
const prices=(count=1)=>({chainId:8453,addresses:Array.from({length:count},(_,n)=>address(100+n))});
function seedNearFull(s,remaining=1) {s.db.prepare("INSERT INTO provider_usage(client_hash,route,units,admitted_at) VALUES(?,'quote',1,unixepoch()-120)");
 const stmt=s.db.prepare("INSERT INTO provider_usage(client_hash,route,units,admitted_at) VALUES(?,'discovery',12,unixepoch()-120)");
 // Seed the shared hour total exactly4096-remaining using valid route weights.
 let n=4096-remaining;while(n>=12){stmt.run('a'.repeat(64));n-=12;}
 const one=s.db.prepare("INSERT INTO provider_usage(client_hash,route,units,admitted_at) VALUES(?,'quote',1,unixepoch()-120)");while(n-->0)one.run('a'.repeat(64));
}
test('all three keyed paths use one weighted primary before lazy provider binding access',async()=>{
 const s=setup();try{
  for(const [route,body]of[['quote',undefined],['prices',prices(60)],['discovery',undefined]]) {
   const response=await s.gateway(request(route,{body}),s.env);assert.equal(response.status,200);assert.equal(response.headers.get('x-provider-budget'),'d1-v1');assert.equal(response.headers.get('x-provider-budget-state'),'admitted');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-secret-provider'),null);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  assert.deepEqual(s.db.prepare('SELECT route,units FROM provider_usage ORDER BY id').all().map(r=>({...r})),[{route:'quote',units:1},{route:'prices',units:2},{route:'discovery',units:12}]);
  assert.deepEqual(s.state.calls.map(c=>c.route),['quote','prices','discovery']);assert.equal(s.db.prepare('SELECT count(*) n FROM discovery_attempts').get().n,1);
 }finally{s.close();}
});
test('missing D1 or new schema denies every valid keyed route with zero helper/key reads',async()=>{
 for(const config of [{schema:false},{}]){const s=setup(config);try{
  const env=config.schema===false?s.env:new Proxy(s.env,{get(target,key){return key==='DISCOVERY_DB'?undefined:Reflect.get(target,key);}});
  for(const route of['quote','prices','discovery']){const r=await s.gateway(request(route,{body:route==='prices'?prices(60):undefined}),env);assert.equal(r.status,503);}
  assert.deepEqual(s.state.calls,[]);assert.deepEqual(s.state.keyReads,[]);
 }finally{s.close();}}
});
test('the auditor eight-quote reproduction denies all eight when binding is absent',async()=>{
 const s=setup();try{for(let n=0;n<8;n++)assert.equal((await s.gateway(request(),{})).status,503);assert.deepEqual(s.state.calls,[]);assert.deepEqual(s.state.keyReads,[]);}finally{s.close();}
});
test('repeated valid requests and mixed routes cannot exceed remaining shared provider units',async()=>{
 const s=setup();try{
  seedNearFull(s,2);
  const p=await s.gateway(request('prices',{body:prices(60)}),s.env);assert.equal(p.status,200);
  for(let i=0;i<8;i++){const denied=await s.gateway(request(i%2?'discovery':'quote'),s.env);assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'60');}
  assert.equal(s.db.prepare('SELECT SUM(units) n FROM provider_usage WHERE admitted_at>=unixepoch()-3600').get().n,4096);
  assert.equal(s.state.calls.length,1);assert.deepEqual(s.state.keyReads,['COINGECKO_API_KEY']);
 }finally{s.close();}
});
test('101 addresses, invalid/oversize/streamed JSON reject before admission or key access',async()=>{
 const s=setup();try{
  const inputs=[{body:prices(101),status:400},{body:{...prices(),chainId:'8453'},status:400},
    {body:{...prices(),provider:'https://invalid'},status:400},{body:'{',status:400},
    {body:' '.repeat(8193),status:413},{body:prices(),headers:{'Content-Type':'text/plain'},status:415},
    {body:prices(),headers:{'Content-Length':'9000'},status:413},
    {stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(8200)));c.close();}}),headers:{'Content-Length':'1'},status:413}];
  for(const {status,...input}of inputs)assert.equal((await s.gateway(request('prices',input),s.env)).status,status);
  assert.equal(s.state.statements,0);assert.deepEqual(s.state.calls,[]);assert.deepEqual(s.state.keyReads,[]);
 }finally{s.close();}
});
test('zero or spoofed request weights do not come from caller fields; dedupe determines bounded price cost',async()=>{
 const s=setup();try{
  const p=prices(100);p.addresses.fill(token);const r=await s.gateway(request('prices',{body:p,headers:{'x-provider-units':'0'}}),s.env);assert.equal(r.status,200);
  assert.deepEqual(s.state.calls,[{route:'prices',cost:1,count:1}]);assert.equal(s.db.prepare('SELECT units FROM provider_usage').get().units,1);
  assert.equal((await s.gateway(request('prices',{body:{...prices(),cost:0}}),s.env)).status,400);
 }finally{s.close();}
});
test('incorrect methods, malformed discovery, huge quote query and missing native identity fail without provider work',async()=>{
 const s=setup();try{
  for(const route of['discovery','quote','prices']){assert.equal((await s.gateway(request(route,{method:'DELETE'}),s.env)).status,405);assert.equal((await s.gateway(request(route,{cf:false,body:route==='prices'?prices():undefined}),s.env)).status,503);}
  assert.equal((await s.gateway(request('quote',{query:'x='.padEnd(2050,'x')}),s.env)).status,400);
  assert.equal((await s.gateway(request('discovery',{query:'chainId=8453&wallet=invalid'}),s.env)).status,400);
  for(const path of['/','/api/1inch/balances','/api/0x/quote/','/api/coingecko/prices/'])assert.equal(await s.gateway(request(path),s.env),null);
  assert.deepEqual(s.state.calls,[]);assert.deepEqual(s.state.keyReads,[]);
 }finally{s.close();}
});
test('body read has a hard deadline even if its source never emits',async()=>{
 const s=setup();try{const start=performance.now();const r=await s.gateway(request('prices',{stream:new ReadableStream({pull(){return new Promise(()=>{});}})}),s.env);assert.equal(r.status,400);assert(performance.now()-start<1500);assert.equal(s.state.statements,0);assert.deepEqual(s.state.calls,[]);}finally{s.close();}
});
