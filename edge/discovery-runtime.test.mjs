/**
 * Real local workerd + Miniflare D1 integration. No provider helper/network/key,
 * Cloudflare account, remote binding or deployment is involved. Test-only worker
 * controls/counters below are compiled in memory, never into the application.
 *
 * Run: node --test --test-concurrency=2 edge/discovery-runtime.test.mjs
 * Optional tooling paths: MINIFLARE_MODULE_PATH, ESBUILD_MODULE_PATH.
 * Optional evidence path: DISCOVERY_RUNTIME_REPORT (otherwise private tmp).
 * Sources for emulator configuration/native test metadata:
 * https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/
 * https://developers.cloudflare.com/workers/testing/miniflare/core/fetch/
 * https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/README.md
 *
 * Limits: at most two Worker isolates in one local emulator, sequential test
 * groups. Native cf metadata is supplied by dispatchFetch at this trusted test
 * boundary; the production gateway has no test/identity bypass flag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const TOOL_ROOT='/Users/generalcuster/Developer/iAero/runs/2026-11-13/website-perf-b/frontend/node_modules';
const miniflareModule=await import(pathToFileURL(process.env.MINIFLARE_MODULE_PATH??TOOL_ROOT+'/miniflare/dist/src/index.js').href);
const {Miniflare,Log,LogLevel}=miniflareModule.default??miniflareModule;
const esbuildModule=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH??TOOL_ROOT+'/esbuild/lib/main.js').href);
const esbuild=esbuildModule.default??esbuildModule;
const schema=await readFile(new URL('./discovery-schema.sql',import.meta.url),'utf8');
const gateway=await readFile(new URL('./discovery-gateway.mjs',import.meta.url),'utf8');
const reportFile=process.env.DISCOVERY_RUNTIME_REPORT??'/private/tmp/iaero-sweeper-upgrade-20261116/evidence/repair/DISCOVERY_RUNTIME_RESULT.json';
const evidence={startedAt:new Date().toISOString(),mode:'Local Miniflare workerd with real emulated D1; fake discovery helper; no provider network.',
  gatewaySha256:createHash('sha256').update(gateway).digest('hex'),schemaSha256:createHash('sha256').update(schema).digest('hex'),groups:[],outboundCalls:0,providerNetworkCalls:0};
const addr=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const ipFor=n=>`198.18.${Math.floor(n/250)%250}.${n%250+1}`;
const wallet=addr(100),chains=['1','8453','42161','10','137','56','43114','534352','59144'];
const testCf={colo:'LHR',asn:13335,country:'GB',city:'London',timezone:'Europe/London'};
const knownKeys=['ALCHEMY_API_KEY','ALCHEMY_KEY','NEXT_PUBLIC_ALCHEMY_KEY','MORALIS_API_KEY',
  'ETHERSCAN_API_KEY','BSCSCAN_API_KEY','POLYGONSCAN_API_KEY','SNOWTRACE_API_KEY',
  'ARBISCAN_API_KEY','OPTIMISM_API_KEY','BASESCAN_API_KEY','SCROLLSCAN_API_KEY','LINEASCAN_API_KEY'];

const fixture=`
import {createDiscoveryGateway,DISCOVERY_PROVIDER_KEYS} from './discovery-gateway.mjs';
let calls=0,keyReads=0,unexpectedKeys=0,last=null,lastContext=null;
const helper=async(params,keys,options)=>{
  calls++;
  last={chainId:params.get('chainId'),wallet:params.get('wallet'),keyNames:Object.keys(keys),
    budgetMs:options.budgetMs,hasSignal:options.signal instanceof AbortSignal};
  return {status:200,data:{tokens:['${addr(900)}'],count:1,logs:['mock: complete'],
    partial:false,complete:true,providers:[{provider:'alchemy',status:'complete',count:1,pages:1}],
    budgetMs:7800,limitations:['Mock candidate; fresh balance checks still required.']},
    headers:{'x-secret-provider-header':'must-not-escape','access-control-allow-origin':'*'}};
};
const gate=createDiscoveryGateway(helper);
export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/__test/reset'){calls=keyReads=unexpectedKeys=0;last=lastContext=null;return Response.json({ok:true});}
  if(url.pathname==='/__test/state')return Response.json({worker:env.TEST_WORKER_NAME,calls,keyReads,unexpectedKeys,last,lastContext,
    nativeCf:request.cf!==null&&typeof request.cf==='object',hasClientHeader:request.headers.has('CF-Connecting-IP')});
  const safeEnv=new Proxy(env,{get(target,key,receiver){
    if(DISCOVERY_PROVIDER_KEYS.includes(key)){keyReads++;return 'test-only-sentinel';}
    if(typeof key==='string'&&/KEY|SECRET|TOKEN/.test(key)){unexpectedKeys++;throw Error('Unrelated binding access');}
    return Reflect.get(target,key,receiver);
  }});
  // Miniflare supplies an empty native cf object even when dispatch metadata is
  // omitted, and populates a loopback CF-Connecting-IP when that is omitted.
  // Native Request constructors can remove either property to exercise failed
  // deployment wiring. These hooks exist ONLY in this in-memory test fixture;
  // they cannot add/trust cf and do not change the production gateway.
  let gateRequest=request.headers.get('x-test-missing-cf')==='1'
    ?new Request(request.url,{method:request.method,headers:request.headers,signal:request.signal}):request;
  if(request.headers.get('x-test-missing-client-ip')==='1'){
    gateRequest=new Request(gateRequest);gateRequest.headers.delete('CF-Connecting-IP');
  }
  lastContext={ingressCf:request.cf!==null&&typeof request.cf==='object',
    gatewayCf:gateRequest.cf!==null&&typeof gateRequest.cf==='object',
    gatewayClientHeader:gateRequest.headers.has('CF-Connecting-IP')};
  const guarded=await gate(gateRequest,safeEnv,ctx);
  return guarded??new Response('unrelated route passed through',{headers:{'x-test-fallback':'true'}});
}};
`;
const compiled=await esbuild.build({stdin:{contents:fixture,resolveDir:fileURLToPath(new URL('.',import.meta.url)),sourcefile:'discovery-runtime-fixture.mjs'},
  bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,logLevel:'silent'});
const script=compiled.outputFiles[0].text;

async function runtime({binding=true,workers=2}={}){
  let outboundCalls=0;
  const workerNames=Array.from({length:workers},(_,i)=>i===0?'gateway-a':'gateway-b');
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.ERROR),
    workers:workerNames.map(name=>({name,modules:true,script,compatibilityDate:'2026-07-01',
      routes:[name+'.invalid/*'],bindings:{TEST_WORKER_NAME:name},
      ...(binding?{d1Databases:{DISCOVERY_DB:'7c59a05f-2401-4a85-9337-000000000001'}}:{}),
      outboundService:async()=>{outboundCalls++;throw Error('Provider network forbidden in runtime tests');},
    }))});
  await mf.ready;
  const db=binding?await mf.getD1Database('DISCOVERY_DB',workerNames[0]):null;
  const send=(options={})=>{
    const {worker=0,ip='192.0.2.10',chainId='8453',account=wallet,path='/api/tokens/discover',
      query,method='GET',headers={}}=options;
    const cf=Object.hasOwn(options,'cf')?options.cf:testCf;
    return mf.dispatchFetch('https://'+workerNames[worker]+'.invalid'+path+
      '?'+(query??new URLSearchParams({chainId,wallet:account}).toString()),
    {method,cf,headers:{...(ip===null?{}:{'CF-Connecting-IP':ip}),...headers}});
  };
  async function applySchema(){
    // Prepare each actual schema statement; there is no hand-written substitute
    // for the shipped DDL and no Node SQLite adapter in this runtime test.
    for(const sql of schema.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  }
  async function states(){return Promise.all(workerNames.map((_,worker)=>send({worker,path:'/__test/state'}).then(r=>r.json())));}
  async function reset(){if(db)await db.prepare('DELETE FROM discovery_attempts').run();await Promise.all(workerNames.map((_,worker)=>send({worker,path:'/__test/reset'})));}
  return {mf,db,send,states,reset,applySchema,workerNames,get outboundCalls(){return outboundCalls;},dispose:()=>mf.dispose()};
}

function guard(response,status,budget){
  assert.equal(response.status,status);
  assert.equal(response.headers.get('x-discovery-guard'),'d1-v1');
  assert.equal(response.headers.get('x-discovery-budget'),budget);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal(response.headers.get('x-secret-provider-header'),null);
}
async function counters(h){
  const states=await h.states();
  return {calls:states.reduce((n,s)=>n+s.calls,0),keys:states.reduce((n,s)=>n+s.keyReads,0),unexpectedKeys:states.reduce((n,s)=>n+s.unexpectedKeys,0),states};
}
async function seed(h,count,{hash='a'.repeat(64),account=addr(700),age=120}={}){
  await h.db.prepare(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<?1)
    INSERT INTO discovery_attempts(client_hash,wallet,chain_id,admitted_at)
    SELECT ?2,?3,8453,unixepoch()-?4 FROM sequence`).bind(count,hash,account,age).run();
}
async function checkNoSpend(h,before){
  const after=await counters(h);assert.equal(after.calls,before.calls);assert.equal(after.keys,before.keys);assert.equal(after.unexpectedKeys,0);return after;
}
async function save(){await mkdir(dirname(reportFile),{recursive:true});await writeFile(reportFile,JSON.stringify(evidence,null,2)+'\n');}

test('real Miniflare D1 gateway integration',{timeout:60000},async t=>{
  const run=(name,work)=>t.test(name,async()=>{try{await work();}catch(error){(evidence.failures??=[]).push({name,message:error.message});throw error;}});
  evidence.status='RUNNING';await save();
  let h;
  try{
    h=await runtime();
    await run('actual D1 INSERT RETURNING and all original chains preserve safe JSON and normalized identities',async()=>{
      await h.applySchema();await h.reset();
      for(let i=0;i<chains.length;i++){
        const response=await h.send({worker:i%2,ip:ipFor(i),account:i===0?'0x'+('Ab'.repeat(20)):addr(100+i),chainId:chains[i]});
        guard(response,200,'admitted');const data=await response.json();assert.equal(data.count,1);assert.equal(data.complete,true);assert.equal(data.partial,false);assert.equal(data.tokens[0],addr(900));
      }
      const count=await h.db.prepare('SELECT count(*) AS n FROM discovery_attempts').first();assert.equal(count.n,9);
      const rows=(await h.db.prepare('SELECT client_hash,wallet,chain_id,admitted_at,typeof(admitted_at) AS clock_type FROM discovery_attempts').all()).results;
      assert(rows.every(r=>/^[0-9a-f]{64}$/.test(r.client_hash)&&r.wallet===r.wallet.toLowerCase()&&r.clock_type==='integer'));
      assert(!JSON.stringify(rows).includes('198.18.'));const c=await counters(h);assert.equal(c.calls,9);assert.equal(c.keys,9*knownKeys.length);assert.equal(c.unexpectedKeys,0);
      for(const s of c.states){assert.equal(s.nativeCf,true);assert.deepEqual(s.last.keyNames,knownKeys);assert.equal(s.last.budgetMs,7800);assert.equal(s.last.hasSignal,true);}
      evidence.groups.push({name:'native-D1-success',passed:true,admissions:9,providerCalls:c.calls,workerNames:c.states.map(s=>s.worker)});
    });

    await run('invalid input, missing native cf/client header and forged forwarding headers cannot access providers',async()=>{
      await h.reset();const before=await counters(h);
      for(const input of [
        {query:`chainId=8453&wallet=${wallet}&chainId=1`},
        {query:`chainId=8453&wallet=${wallet}&wallet=${wallet}`},
        {query:`chainId=8453&wallet=${wallet}&provider=alchemy`},
        {chainId:'999'}, {chainId:'08453'}, {account:addr(0)}, {account:'0x123'},
      ])guard(await h.send(input),400,'invalid');
      guard(await h.send({headers:{'x-test-missing-cf':'1'}}),503,'unavailable');
      assert.deepEqual((await h.states())[0].lastContext,{ingressCf:true,gatewayCf:false,gatewayClientHeader:true});
      for(const input of [{ip:null,headers:{'x-test-missing-client-ip':'1'}},{ip:'192.0.2.1, 192.0.2.2'},
        {ip:null,headers:{'x-test-missing-client-ip':'1',Origin:'https://gateway-a.invalid','X-Forwarded-For':'192.0.2.1','X-Real-IP':'192.0.2.1'}}])guard(await h.send(input),503,'unavailable');
      assert.equal((await h.states())[0].lastContext.gatewayClientHeader,false);
      const after=await checkNoSpend(h,before);assert.equal((await h.db.prepare('SELECT count(*) AS n FROM discovery_attempts').first()).n,0);
      evidence.groups.push({name:'invalid-or-untrusted',passed:true,providerCalls:after.calls,keyReads:after.keys});
    });

    await run('unrelated routes pass through without quota/key work; CORS/Origin never authorizes scans',async()=>{
      await h.reset();const before=await counters(h);
      for(const path of ['/','/api/0x/quote','/api/tokens/discover/']){const response=await h.send({path});assert.equal(response.status,200);assert.equal(response.headers.get('x-test-fallback'),'true');assert.equal(await response.text(),'unrelated route passed through');}
      guard(await h.send({method:'POST'}),405,'invalid');await checkNoSpend(h,before);
      guard(await h.send({headers:{Origin:'https://other.invalid'}}),200,'admitted');
      evidence.groups.push({name:'routing-and-origin',passed:true,unrelatedPassThrough:3});
    });

    await run('24 concurrent requests across two real Worker isolates honor client6 and wallet3 minute caps',async()=>{
      for(const [mode,expected] of [['client',6],['wallet',3]]){
        await h.reset();const responses=await Promise.all(Array.from({length:24},(_,i)=>h.send({worker:i%2,
          ip:mode==='client'?'192.0.2.77':ipFor(i),account:mode==='wallet'?wallet:addr(2000+i),chainId:chains[i%9]})));
        const statuses=responses.map(r=>r.status);assert.equal(statuses.filter(s=>s===200).length,expected);assert.equal(statuses.filter(s=>s===429).length,24-expected);
        for(const r of responses)if(r.status===429){assert.equal(r.headers.get('retry-after'),'60');guard(r,429,'denied');}
        const c=await counters(h);assert.equal(c.calls,expected);assert.equal(c.keys,expected*knownKeys.length);
        assert.equal((await h.db.prepare('SELECT count(*) AS n FROM discovery_attempts').first()).n,expected);
        evidence.groups.push({name:'cross-isolate-'+mode+'-minute',passed:true,requests:24,admitted:expected,denied:24-expected,providerCalls:c.calls,keyReads:c.keys});
      }
    });

    await run('hour/day boundaries use actual D1 time and shared global caps survive IP/wallet rotation',async()=>{
      // Obtain the real canonical client hash through one actual admission.
      await h.reset();guard(await h.send(),200,'admitted');const hash=(await h.db.prepare('SELECT client_hash FROM discovery_attempts').first()).client_hash;
      for(const [mode,limit] of [['client-hour',60],['wallet-hour',30],['global-hour',120],['global-day',500]]){
        await h.reset();await seed(h,limit-1,{hash:mode==='client-hour'?hash:'a'.repeat(64),account:mode==='wallet-hour'?wallet:addr(700),age:mode==='global-day'?7200:120});
        guard(await h.send(),200,'admitted');const before=await counters(h);
        guard(await h.send({worker:1,ip:mode==='client-hour'?'192.0.2.10':ipFor(99),account:mode==='wallet-hour'?wallet:addr(999),chainId:'59144'}),429,'denied');
        await checkNoSpend(h,before);assert.equal((await h.db.prepare('SELECT count(*) AS n FROM discovery_attempts').first()).n,limit);
        evidence.groups.push({name:mode,passed:true,limit,providerCalls:before.calls});
      }
      await h.reset();const responses=await Promise.all(Array.from({length:121},(_,i)=>h.send({worker:i%2,ip:ipFor(i),account:addr(3000+i),chainId:chains[i%9]})));
      assert.equal(responses.filter(r=>r.status===200).length,120);assert.equal(responses.filter(r=>r.status===429).length,1);
      const c=await counters(h);assert.equal(c.calls,120);assert.equal(c.keys,120*knownKeys.length);
      evidence.groups.push({name:'global-concurrent-rotation',passed:true,requests:121,admitted:120,denied:1,providerCalls:c.calls});
    });

    await run('missing schema or required index fails closed in the actual D1 emulator',async()=>{
      await h.reset();await h.db.prepare('DROP TABLE discovery_attempts').run();const before=await counters(h);
      const missing=await h.send();guard(missing,503,'unavailable');const data=await missing.json();assert.equal(data.code,'DISCOVERY_GUARD_UNAVAILABLE');assert.equal(data.partial,true);assert.equal(data.complete,false);
      await checkNoSpend(h,before);await h.applySchema();await h.db.prepare('DROP INDEX discovery_attempts_client_time').run();
      guard(await h.send({worker:1}),503,'unavailable');await checkNoSpend(h,before);await h.applySchema();
      evidence.groups.push({name:'actual-D1-schema-and-index-errors',passed:true,providerCalls:before.calls,keyReads:before.keys});
    });
    assert.equal(h.outboundCalls,0);evidence.outboundCalls+=h.outboundCalls;
  }finally{await h?.dispose();}

  await run('an actually absent D1 binding fails before provider/environment access',async()=>{
    const missing=await runtime({binding:false,workers:1});
    try{const before=await counters(missing);const response=await missing.send();guard(response,503,'unavailable');await checkNoSpend(missing,before);assert.equal(missing.outboundCalls,0);evidence.groups.push({name:'actual-missing-binding',passed:true,providerCalls:0,keyReads:0});}
    finally{await missing.dispose();}
  });
  evidence.finishedAt=new Date().toISOString();evidence.status=evidence.failures?.length?'FAIL':'PASS';await save();
  assert.equal(evidence.failures?.length??0,0,'All runtime evidence groups must pass');
});
