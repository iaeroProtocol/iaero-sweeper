/**
 * Bounded, entirely local workerd/Miniflare D1 verification of provider-budget.
 * Only this in-memory test worker has controls/counters; production modules have
 * no test bypass. No real provider helper/key, network, account or resource.
 *
 * node --test --test-concurrency=2 edge/provider-runtime.test.mjs
 * Tool overrides: MINIFLARE_MODULE_PATH, ESBUILD_MODULE_PATH.
 * Evidence override: PROVIDER_RUNTIME_REPORT (default is taskroot/keyed/...).
 * At most two Worker isolates in one emulator; all test groups run sequentially.
 *
 * Official API references:
 * https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/
 * https://developers.cloudflare.com/workers/testing/miniflare/core/fetch/
 * https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/README.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const TOOL_ROOT='/Users/generalcuster/Developer/iAero/runs/2026-11-13/website-perf-b/frontend/node_modules';
const mfImport=await import(pathToFileURL(process.env.MINIFLARE_MODULE_PATH??TOOL_ROOT+'/miniflare/dist/src/index.js').href);
const {Miniflare,Log,LogLevel}=mfImport.default??mfImport;
const buildImport=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH??TOOL_ROOT+'/esbuild/lib/main.js').href);
const esbuild=buildImport.default??buildImport;
const schema=await readFile(new URL('./provider-budget-schema.sql',import.meta.url),'utf8');
const budgetSource=await readFile(new URL('./provider-budget.mjs',import.meta.url),'utf8');
const reportFile=process.env.PROVIDER_RUNTIME_REPORT??'/private/tmp/iaero-sweeper-upgrade-20261116/keyed/M02_PROVIDER_RUNTIME_RESULT.json';
const evidence={status:'RUNNING',startedAt:new Date().toISOString(),
  mode:'Two local workerd Worker isolates sharing real emulated D1; mock provider only; every outbound fetch forbidden.',
  providerBudgetSha256:createHash('sha256').update(budgetSource).digest('hex'),
  schemaSha256:createHash('sha256').update(schema).digest('hex'),groups:[],outboundCalls:0,providerNetworkCalls:0};
const pattern=[{route:'discovery',units:12},{route:'quote',units:1},{route:'prices',units:2}];
const testCf={colo:'LHR',asn:13335,country:'GB',city:'London',timezone:'Europe/London'};
const ipFor=n=>`198.18.${Math.floor(n/250)%250}.${n%250+1}`;

const fixture=`
import {admitProviderUsage} from './provider-budget.mjs';
let calls=0,keyReads=0,unexpectedKeys=0,acceptedUnits=0,lastContext=null;
const byRoute={discovery:0,quote:0,prices:0};
const keyFor={discovery:'ALCHEMY_API_KEY',quote:'ZERO_EX_API_KEY',prices:'COINGECKO_API_KEY'};
export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/__test/reset'){
    calls=keyReads=unexpectedKeys=acceptedUnits=0;lastContext=null;
    for(const route of Object.keys(byRoute))byRoute[route]=0;
    return Response.json({ok:true});
  }
  if(url.pathname==='/__test/state')return Response.json({worker:env.TEST_WORKER_NAME,calls,keyReads,unexpectedKeys,acceptedUnits,byRoute,lastContext});
  if(url.pathname!=='/__test/provider')return new Response('unrelated test route',{headers:{'x-test-fallback':'true'}});
  const safeEnv=new Proxy(env,{get(target,key,receiver){
    if(Object.values(keyFor).includes(key)){keyReads++;return'test-only-fake-provider-key';}
    if(typeof key==='string'&&/KEY|SECRET|TOKEN/.test(key)){unexpectedKeys++;throw Error('Unexpected binding access');}
    return Reflect.get(target,key,receiver);
  }});
  // Miniflare creates default ingress cf/IP even when dispatch omits them.
  // Native Request constructors remove them ONLY in this test fixture to verify
  // missing-context deployment failures; nothing here can add/trust fake cf.
  let gateRequest=request.headers.get('x-test-missing-cf')==='1'
    ?new Request(request.url,{method:request.method,headers:request.headers,signal:request.signal}):request;
  if(request.headers.get('x-test-missing-client-ip')==='1'){
    gateRequest=new Request(gateRequest);gateRequest.headers.delete('CF-Connecting-IP');
  }
  lastContext={ingressCf:request.cf!==null&&typeof request.cf==='object',
    gateCf:gateRequest.cf!==null&&typeof gateRequest.cf==='object',gateClientHeader:gateRequest.headers.has('CF-Connecting-IP')};
  const route=url.searchParams.get('route'),units=Number(url.searchParams.get('units'));
  const denied=await admitProviderUsage(gateRequest,safeEnv,ctx,{route,units});
  if(denied!==null)return denied;
  // This is a counter, not a real provider. Read exactly one mock key and invoke
  // this mock helper only AFTER completed admission, matching the dispatcher API.
  void safeEnv[keyFor[route]];calls++;acceptedUnits+=units;byRoute[route]++;
  return Response.json({mock:true,route,units},{headers:{'cache-control':'no-store','x-provider-budget':'d1-v1','x-provider-budget-state':'admitted'}});
}};
`;
const built=await esbuild.build({stdin:{contents:fixture,resolveDir:fileURLToPath(new URL('.',import.meta.url)),sourcefile:'provider-runtime-fixture.mjs'},
  bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,logLevel:'silent'});
const script=built.outputFiles[0].text;

async function runtime({binding=true,workers=2}={}){
  let outboundCalls=0;
  const names=Array.from({length:workers},(_,i)=>'provider-'+(i===0?'a':'b'));
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,log:new Log(LogLevel.ERROR),
    workers:names.map(name=>({name,modules:true,script,compatibilityDate:'2026-07-01',routes:[name+'.invalid/*'],
      bindings:{TEST_WORKER_NAME:name},...(binding?{d1Databases:{DISCOVERY_DB:'7c59a05f-2401-4a85-9337-000000000002'}}:{}),
      outboundService:async()=>{outboundCalls++;throw Error('Outbound network forbidden by provider runtime test');},
    }))});
  try{
    await mf.ready;
    const db=binding?await mf.getD1Database('DISCOVERY_DB',names[0]):null;
    async function send({worker=0,ip='192.0.2.10',route='quote',units=1,path='/__test/provider',headers={}}={}){
      const response=await mf.dispatchFetch('https://'+names[worker]+'.invalid'+path+'?'+new URLSearchParams({route,units:String(units)}),
        {cf:testCf,headers:{...(ip===null?{}:{'CF-Connecting-IP':ip}),...headers}});
      // Consume each real HTTP body immediately rather than leaving24 native
      // streams waiting while later replies resolve. Assertions inspect the
      // captured wire status/headers/JSON, never synthetic provider values.
      const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=null;}
      return{status:response.status,headers:response.headers,data};
    }
    async function applySchema(){for(const sql of schema.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();}
    async function stats(){
      const states=await Promise.all(names.map((_,worker)=>send({worker,path:'/__test/state'}).then(r=>r.data)));
      return{states,calls:states.reduce((n,s)=>n+s.calls,0),keyReads:states.reduce((n,s)=>n+s.keyReads,0),
        unexpectedKeys:states.reduce((n,s)=>n+s.unexpectedKeys,0),acceptedUnits:states.reduce((n,s)=>n+s.acceptedUnits,0)};
    }
    async function reset(){await db.prepare('DELETE FROM provider_usage').run();await Promise.all(names.map((_,worker)=>send({worker,path:'/__test/reset'})));}
    return{db,send,applySchema,stats,reset,get outboundCalls(){return outboundCalls;},dispose:()=>mf.dispose()};
  }catch(error){await mf.dispose().catch(()=>{});throw error;}
}

async function seed(h,units,{hash='a'.repeat(64),age=120,rotateClients=false}={}){
  // Dense legal-weight rows seed only the local limiter history. They make no
  // claims about actual past helper/provider calls or discovery pagination.
  const full=Math.floor(units/12);let remainder=units%12;
  if(full)await h.db.prepare(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<?1)
    INSERT INTO provider_usage(client_hash,route,units,admitted_at)
    SELECT CASE WHEN ?4=1 THEN printf('%064x',n%3+1) ELSE ?2 END,'discovery',12,unixepoch()-?3 FROM sequence`)
    .bind(full,hash,age,rotateClients?1:0).run();
  while(remainder>0){const weight=remainder>=2?2:1;
    await h.db.prepare('INSERT INTO provider_usage(client_hash,route,units,admitted_at) VALUES(?,\'prices\',?,unixepoch()-?)').bind(hash,weight,age).run();remainder-=weight;}
  assert.equal((await h.db.prepare('SELECT sum(units) AS n FROM provider_usage').first()).n,units);
}

async function check(response,status){
  assert.equal(response.status,status);assert.equal(response.headers.get('x-provider-budget'),'d1-v1');
  assert.equal(response.headers.get('x-provider-budget-state'),status===429?'denied':'unavailable');
  assert.equal(response.headers.get('retry-after'),'60');assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  const data=response.data;
  assert.equal(data.code,status===429?'PROVIDER_RATE_LIMITED':'PROVIDER_BUDGET_UNAVAILABLE');
  if(status===429)assert.match(data.error,/rate.?limit/i,'Existing frontend blocker must recognize budget denial');
  assert(!JSON.stringify(data).includes('test-only-fake-provider-key'));assert(!JSON.stringify(data).includes('https://'));
}
async function unchanged(h,before){const after=await h.stats();assert.equal(after.calls,before.calls);assert.equal(after.keyReads,before.keyReads);assert.equal(after.unexpectedKeys,0);return after;}
async function save(){await mkdir(dirname(reportFile),{recursive:true});await writeFile(reportFile,JSON.stringify(evidence,null,2)+'\n');}

test('weighted provider budget in actual local Miniflare D1',{timeout:60000},async t=>{
  const run=(name,work)=>t.test(name,async()=>{try{await work();}catch(error){(evidence.failures??=[]).push({name,message:error.message});throw error;}});
  await save();let h;
  try{
    h=await runtime();await h.applySchema();
    await run('all allowed route weights use real D1 RETURNING and only then touch fake providers',async()=>{
      await h.reset();const before=await h.db.prepare('SELECT unixepoch() AS n').first();
      for(const [i,usage] of [...pattern,{route:'prices',units:1}].entries())assert.equal((await h.send({...usage,worker:i%2,ip:ipFor(i)})).status,200);
      const stats=await h.stats();assert.equal(stats.calls,4);assert.equal(stats.keyReads,4);assert.equal(stats.acceptedUnits,16);assert.equal(stats.unexpectedKeys,0);
      assert.deepEqual(stats.states.map(s=>s.worker),['provider-a','provider-b']);assert(stats.states.every(s=>s.calls>0&&s.lastContext.gateCf));
      const rows=(await h.db.prepare('SELECT client_hash,route,units,admitted_at,typeof(admitted_at) AS clock_type FROM provider_usage').all()).results;
      const after=await h.db.prepare('SELECT unixepoch() AS n').first();assert.equal(rows.reduce((n,r)=>n+r.units,0),16);
      assert(rows.every(r=>/^[0-9a-f]{64}$/.test(r.client_hash)&&r.clock_type==='integer'&&r.admitted_at>=before.n&&r.admitted_at<=after.n));
      assert(!JSON.stringify(rows).includes('198.18.'));evidence.groups.push({name:'all-route-weights',passed:true,calls:4,keyReads:4,weightedUnits:16});
    });

    await run('two real Worker isolates cannot overshoot client minute, global hour or global day with mixed concurrent weights',async()=>{
      await h.reset();assert.equal((await h.send({ip:'192.0.2.77'})).status,200);
      const hash=(await h.db.prepare('SELECT client_hash FROM provider_usage').first()).client_hash;
      for(const [mode,limit,age] of [['client-minute',1024,0],['global-hour',4096,120],['global-day',16384,7200]]){
        await h.reset();await seed(h,limit-12,{hash:mode==='client-minute'?hash:'a'.repeat(64),age,rotateClients:mode==='global-day'});
        const attempts=Array.from({length:24},(_,i)=>({...pattern[i%3],worker:i%2,
          ip:mode==='client-minute'?(i%2?'::ffff:192.0.2.77':'192.0.2.77'):ipFor(30+i)}));
        const responses=await Promise.all(attempts.map(input=>h.send(input)));
        const admitted=responses.map((r,i)=>({status:r.status,...attempts[i]})).filter(r=>r.status===200);
        const denied=responses.filter(r=>r.status===429);assert.equal(admitted.length+denied.length,24);assert(denied.length>0);
        for(const response of denied)await check(response,429);
        const reserved=admitted.reduce((n,r)=>n+r.units,0);assert.equal(reserved,12,mode);
        const row=await h.db.prepare('SELECT sum(units) AS n FROM provider_usage').first();assert(row.n<=limit);assert.equal(row.n,limit);
        const stats=await h.stats();assert.equal(stats.calls,admitted.length);assert.equal(stats.keyReads,admitted.length);assert.equal(stats.acceptedUnits,reserved);assert.equal(stats.unexpectedKeys,0);
        const before={...stats};await check(await h.send({worker:1,ip:mode==='client-minute'?'::ffff:192.0.2.77':ipFor(99)}),429);await unchanged(h,before);
        evidence.groups.push({name:mode,passed:true,limit,requests:24,admitted:admitted.length,denied:denied.length,reservedUnits:reserved,finalUnits:row.n,helperCalls:stats.calls,keyReads:stats.keyReads});
      }
    });

    await run('invalid weights and missing native context/client IP fail closed without any mock key or helper work',async()=>{
      await h.reset();const before=await h.stats();
      for(const usage of [{route:'discovery',units:1},{route:'quote',units:2},{route:'prices',units:3},{route:'other',units:1}])await check(await h.send(usage),503);
      await check(await h.send({headers:{'x-test-missing-cf':'1'}}),503);
      assert.deepEqual((await h.stats()).states[0].lastContext,{ingressCf:true,gateCf:false,gateClientHeader:true});
      await check(await h.send({ip:null,headers:{'x-test-missing-client-ip':'1',Origin:'https://provider-a.invalid','X-Forwarded-For':'192.0.2.1'}}),503);
      assert.equal((await h.stats()).states[0].lastContext.gateClientHeader,false);
      await check(await h.send({ip:'192.0.2.1, 192.0.2.2'}),503);await unchanged(h,before);
      assert.equal((await h.db.prepare('SELECT count(*) AS n FROM provider_usage').first()).n,0);
      evidence.groups.push({name:'invalid-or-missing-identity',passed:true,helperCalls:0,keyReads:0});
    });

    await run('actual missing new table and both required indices fail closed before provider work',async()=>{
      await h.reset();const before=await h.stats();await h.db.prepare('DROP TABLE provider_usage').run();
      await check(await h.send(),503);await unchanged(h,before);await h.applySchema();
      for(const index of ['provider_usage_client_time','provider_usage_time']){
        await h.db.prepare('DROP INDEX '+index).run();await check(await h.send({worker:1}),503);await unchanged(h,before);await h.applySchema();
      }
      evidence.groups.push({name:'actual-D1-schema-and-indices',passed:true,helperCalls:0,keyReads:0});
    });
    assert.equal(h.outboundCalls,0);evidence.outboundCalls+=h.outboundCalls;
  }finally{await h?.dispose();}

  await run('actual missing D1 binding cannot read fake keys or invoke the helper',async()=>{
    const missing=await runtime({binding:false,workers:1});
    try{const before=await missing.stats();await check(await missing.send(),503);await unchanged(missing,before);assert.equal(missing.outboundCalls,0);
      evidence.groups.push({name:'actual-missing-binding',passed:true,helperCalls:0,keyReads:0});}
    finally{await missing.dispose();}
  });
  evidence.status=evidence.failures?.length?'FAIL':'PASS';evidence.finishedAt=new Date().toISOString();await save();
  assert.equal(evidence.failures?.length??0,0,'Every runtime evidence group must pass');
});
