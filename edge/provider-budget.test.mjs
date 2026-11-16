import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {admitProviderUsage, PROVIDER_BUDGET_LIMITS} from './provider-budget.mjs';

// No actual provider, credential, HTTP service or remote resource is used.
globalThis.fetch=async()=>{throw Error('Network forbidden in provider budget tests');};
const schema=await readFile(new URL('./provider-budget-schema.sql',import.meta.url),'utf8');
const pattern=[{route:'discovery',units:12},{route:'quote',units:1},{route:'prices',units:2}];
const defaultUsage={route:'quote',units:1};
const ipFor=n=>`198.18.${Math.floor(n/250)%250}.${n%250+1}`;

function request({ip='192.0.2.10',cf={colo:'LHR',asn:13335},signal,headers={},method='GET'}={}){
  const req=new Request('https://edge.invalid/api/local-test',{method,signal,
    headers:{...(ip===null?{}:{'CF-Connecting-IP':ip}),...headers}});
  if(cf!==false)Object.defineProperty(req,'cf',{value:cf});
  return req;
}

function localD1(path=':memory:',{initialize=true,defer=false}={}){
  const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA busy_timeout = 5000');if(initialize)sqlite.exec(schema);
  const statements=[];
  const db={prepare(sql){
    statements.push(sql);const stmt=sqlite.prepare(sql);
    const bind=values=>({bind:(...next)=>bind(next),async first(){if(defer)await nextTurn();return stmt.get(...values)??null;},
      async run(){if(defer)await nextTurn();const r=stmt.run(...values);return{success:true,meta:{changes:Number(r.changes)}};}});
    return bind([]);
  }};
  return{sqlite,db,statements,close:()=>sqlite.close()};
}

function setup(options){
  const store=localD1(undefined,options),state={keyReads:0,providerCalls:0};
  const env={DISCOVERY_DB:store.db};
  for(const key of ['ALCHEMY_API_KEY','MORALIS_API_KEY','ZERO_EX_API_KEY','COINGECKO_API_KEY','BASESCAN_API_KEY']){
    Object.defineProperty(env,key,{get(){state.keyReads++;return'test-only-sentinel';}});
  }
  async function guarded(req,usage=defaultUsage,ctx){
    const denied=await admitProviderUsage(req,env,ctx,usage);
    if(denied!==null)return denied;
    // The same caller ordering required of the dispatcher: no key/provider work
    // until null admission, and no callback is handed into the budget module.
    void env.ALCHEMY_API_KEY;state.providerCalls++;return new Response('mock provider',{status:200});
  }
  return{...store,state,env,guarded};
}

function check(response,status){
  assert(response instanceof Response);assert.equal(response.status,status);
  assert.equal(response.headers.get('x-provider-budget'),'d1-v1');
  assert.equal(response.headers.get('x-provider-budget-state'),status===429?'denied':'unavailable');
  assert.equal(response.headers.get('retry-after'),'60');assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
}
const total=store=>store.sqlite.prepare('SELECT coalesce(sum(units),0) AS n FROM provider_usage').get().n;

async function realHash(ip){
  const s=setup();try{assert.equal(await admitProviderUsage(request({ip}),s.env,null,defaultUsage),null);
    return s.sqlite.prepare('SELECT client_hash FROM provider_usage').get().client_hash;}finally{s.close();}
}

function seedUnits(store,units,{hash='a'.repeat(64),age=120,rotateClients=false}={}){
  const insert=store.sqlite.prepare('INSERT INTO provider_usage(client_hash,route,units,admitted_at) VALUES(?,?,?,unixepoch()-?)');
  let i=0;
  while(units>0){
    const candidate=pattern[i%pattern.length],usage=candidate.units<=units?candidate:defaultUsage;
    const client=rotateClients?BigInt(Math.floor(i/3)%3+1).toString(16).padStart(64,'0'):hash;
    insert.run(client,usage.route,usage.units,age);units-=usage.units;i++;
  }
}

async function concurrencyWorker(){
  const store=localD1(workerData.path,{initialize:false,defer:true});let keys=0,calls=0;
  const env={DISCOVERY_DB:store.db};Object.defineProperty(env,'ALCHEMY_API_KEY',{get(){keys++;return'test-only';}});
  parentPort.postMessage({ready:true});await new Promise(resolve=>parentPort.once('message',resolve));
  const results=await Promise.all(Array.from({length:12},async(_,i)=>{
    const usage=pattern[i%3],n=workerData.index*20+i;
    const response=await admitProviderUsage(request({ip:workerData.mode.startsWith('client')?'192.0.2.77':ipFor(n)}),env,null,usage);
    if(response===null){void env.ALCHEMY_API_KEY;calls++;}
    return{...usage,status:response===null?200:response.status};
  }));
  store.close();parentPort.postMessage({results,keys,calls});
}

if(!isMainThread){await concurrencyWorker();}
else{
  test('all fixed weights reserve together using one atomic write, DB time and no provider binding access',async()=>{
    const s=setup();try{
      const before=s.sqlite.prepare('SELECT unixepoch() AS n').get().n;
      for(const usage of [...pattern,{route:'prices',units:1}])assert.equal(await admitProviderUsage(request({method:usage.route==='prices'?'POST':'GET'}),s.env,null,usage),null);
      assert.equal(total(s),16);assert.equal(s.statements.length,4);assert(s.statements.every(sql=>sql.trimStart().startsWith('INSERT')));
      assert.equal(s.state.keyReads,0);assert.equal(s.state.providerCalls,0);
      const after=s.sqlite.prepare('SELECT unixepoch() AS n').get().n;
      const rows=s.sqlite.prepare('SELECT * FROM provider_usage').all();
      assert(rows.every(r=>/^[0-9a-f]{64}$/.test(r.client_hash)&&Number.isInteger(r.admitted_at)&&r.admitted_at>=before&&r.admitted_at<=after));
      assert.equal(new Set(rows.map(r=>r.client_hash)).size,1);assert(!JSON.stringify(rows).includes('192.0.2.10'));assert(!JSON.stringify(rows).includes('sentinel'));
    }finally{s.close();}
  });

  test('invalid route/weight configuration fails closed before DB, keys or callback work',async()=>{
    const s=setup();try{
      for(const usage of [undefined,null,{}, {route:'unknown',units:1},{route:'Quote',units:1},
        {route:'discovery',units:1},{route:'discovery',units:11},{route:'quote',units:2},
        {route:'prices',units:0},{route:'prices',units:3},{route:'quote',units:'1'},
        {route:'quote',units:1.5},{route:'quote',units:NaN},{route:'quote',units:Infinity},{route:'quote',units:-1}]){
        check(await admitProviderUsage(request(),s.env,null,usage),503);
      }
      assert.equal(s.statements.length,0);assert.equal(s.state.keyReads,0);assert.equal(total(s),0);
    }finally{s.close();}
  });

  test('schema independently enforces route units and stores no raw identity or provider binding',async()=>{
    const s=setup();try{
      const insert=s.sqlite.prepare('INSERT INTO provider_usage(client_hash,route,units) VALUES(?,?,?)');
      for(const [route,units] of [['discovery',1],['quote',12],['prices',3],['other',1],['quote',0]])assert.throws(()=>insert.run('a'.repeat(64),route,units));
      assert.throws(()=>insert.run('192.0.2.10','quote',1));assert.equal(total(s),0);
    }finally{s.close();}
  });

  test('missing/native-untrusted identity, missing binding and spoofed Origin/forwarding headers cannot authorize work',async()=>{
    const s=setup();try{
      for(const req of [request({cf:false}),request({cf:null}),request({cf:[]}),request({cf:'LHR'}),request({ip:null}),
        request({ip:'192.0.2.1, 192.0.2.2'}),request({ip:'999.0.2.1'}),request({ip:'0192.0.2.1'}),
        request({ip:'[2001:db8::1]'}),request({ip:'2001:db8::1%eth0'}),request({ip:'192.0.2.1:443'}),
        request({ip:null,headers:{Origin:'https://edge.invalid','X-Forwarded-For':'192.0.2.1','X-Real-IP':'192.0.2.1'}})])check(await s.guarded(req),503);
      const noDb={};Object.defineProperty(noDb,'ALCHEMY_API_KEY',{get(){throw Error('No key access allowed');}});
      check(await admitProviderUsage(request(),noDb,null,defaultUsage),503);check(await admitProviderUsage(request(),undefined,null,defaultUsage),503);
      assert.equal(s.state.keyReads,0);assert.equal(s.state.providerCalls,0);assert.equal(s.statements.length,0);
      assert.equal((await s.guarded(request({headers:{Origin:'https://other.invalid'}}))).status,200);
    }finally{s.close();}
  });

  test('canonical IPv6 and mapped IPv4 share hashed client limits across all routes',async()=>{
    for(const [a,b] of [['2001:DB8:0:0:0:0:0:1','2001:db8::1'],['192.0.2.1','::ffff:192.0.2.1'],['192.0.2.1','::ffff:c000:201'],['::ffff:0:192.0.2.1','::ffff:0:c000:201']]){
      const s=setup();try{
        assert.equal(await admitProviderUsage(request({ip:a}),s.env,null,defaultUsage),null);
        assert.equal(await admitProviderUsage(request({ip:b}),s.env,null,defaultUsage),null);
        const rows=s.sqlite.prepare('SELECT DISTINCT client_hash FROM provider_usage').all();assert.equal(rows.length,1);
        seedUnits(s,1022,{hash:rows[0].client_hash,age:0});
        check(await s.guarded(request({ip:b}),{route:'prices',units:1}),429);assert.equal(total(s),1024);
        assert.equal(s.state.providerCalls,0);assert.equal(s.state.keyReads,0);
      }finally{s.close();}
    }
  });

  test('all five weighted thresholds share route totals and admit the exact last unit without overshoot',async()=>{
    const hash=await realHash('192.0.2.10');
    for(const [mode,limit,age] of [['clientMinute',1024,0],['clientHour',4096,120],['clientDay',8192,7200],['globalHour',4096,120],['globalDay',16384,7200]]){
      const s=setup();try{
        seedUnits(s,limit-13,{hash:mode.startsWith('client')?hash:'a'.repeat(64),age,rotateClients:mode==='globalDay'});
        assert.equal((await s.guarded(request(),{route:'discovery',units:12})).status,200);
        const before={...s.state};const denied=await s.guarded(request(),{route:'prices',units:2});check(denied,429);
        assert.match((await denied.json()).error,/rate.?limit/i,'Existing queue blocker must recognize the429 error text');
        assert.deepEqual(s.state,before);assert.equal(total(s),limit-1);
        assert.equal((await s.guarded(request(),{route:'quote',units:1})).status,200);
        const full={...s.state};check(await s.guarded(request(),{route:'prices',units:1}),429);
        assert.deepEqual(s.state,full);assert.equal(total(s),limit,mode);
        assert.equal(s.state.providerCalls,2);assert.equal(s.state.keyReads,2);
      }finally{s.close();}
    }
  });

  test('expired client/global minute, hour and day windows do not debit a fresh request',async()=>{
    const hash=await realHash('192.0.2.10');
    for(const [mode,units,age] of [['clientMinute',1024,62],['clientHour',4096,3602],['clientDay',8192,86402],['globalHour',4096,3602],['globalDay',16384,86402]]){
      const s=setup();try{
        seedUnits(s,units,{hash:mode.startsWith('client')?hash:'a'.repeat(64),age,rotateClients:mode==='globalDay'});
        assert.equal(await admitProviderUsage(request({headers:{'X-Current-Time':'0'}}),s.env,null,defaultUsage),null,mode);
        assert.equal(total(s),units+1);assert.equal(s.state.keyReads,0);
      }finally{s.close();}
    }
  });

  test('missing schema/index, query errors and malformed admission rows return safe503 before key/callback work',async()=>{
    const s=setup({initialize:false});try{
      check(await s.guarded(request()),503);assert.equal(s.state.providerCalls,0);assert.equal(s.state.keyReads,0);
      s.sqlite.exec(schema);s.sqlite.exec('DROP INDEX provider_usage_client_time');check(await s.guarded(request()),503);
      s.sqlite.exec(schema);s.sqlite.exec('DROP INDEX provider_usage_time');check(await s.guarded(request()),503);
      assert.equal(s.state.providerCalls,0);assert.equal(s.state.keyReads,0);
      for(const first of [async()=>{throw Error('sentinel-secret https://private.invalid/key');},async()=>({}),async()=>undefined,
        async()=>({id:0}),async()=>({id:-1}),async()=>({id:'1'}),async()=>({id:1.5})]){
        const env={DISCOVERY_DB:{prepare(){return{bind(){return{first};}};}}};Object.defineProperty(env,'ZERO_EX_API_KEY',{get(){throw Error('No key access');}});
        const response=await admitProviderUsage(request(),env,null,defaultUsage);check(response,503);const text=await response.text();
        assert(!text.includes('sentinel-secret'));assert(!text.includes('https://'));assert(!text.includes('192.0.2.10'));
      }
    }finally{s.close();}
  });

  test('1s admission deadline stays closed after late completion and cancellation, with no automatic work',async()=>{
    let resolveLate,keys=0,calls=0;
    const env={DISCOVERY_DB:{prepare(){return{bind(){return{first:()=>new Promise(resolve=>resolveLate=resolve)};}};}}};
    Object.defineProperty(env,'ALCHEMY_API_KEY',{get(){keys++;return'test-only';}});
    async function guarded(req){const denied=await admitProviderUsage(req,env,null,defaultUsage);if(denied!==null)return denied;void env.ALCHEMY_API_KEY;calls++;return null;}
    const start=performance.now();check(await guarded(request()),503);assert(performance.now()-start<PROVIDER_BUDGET_LIMITS.gateTimeoutMs+500);
    resolveLate({id:1});await nextTurn();assert.equal(keys,0);assert.equal(calls,0);
    const controller=new AbortController();const pending=guarded(request({signal:controller.signal}));setTimeout(()=>controller.abort(),10);
    check(await pending,503);resolveLate({id:2});await nextTurn();assert.equal(keys,0);assert.equal(calls,0);
    const already=new AbortController();already.abort();check(await guarded(request({signal:already.signal})),503);assert.equal(keys,0);
  });

  test('reservations survive provider failures; 48h cleanup is bounded, best effort and never a refund',async()=>{
    const s=setup();try{
      seedUnits(s,130,{age:172802});const oldRows=s.sqlite.prepare('SELECT count(*) AS n FROM provider_usage').get().n;
      // Add enough old quote rows to prove the64-row deletion bound.
      for(let i=oldRows;i<130;i++)s.sqlite.prepare('INSERT INTO provider_usage(client_hash,route,units,admitted_at) VALUES(?,\'quote\',1,unixepoch()-172802)').run('b'.repeat(64));
      const jobs=[],ctx={waitUntil:job=>jobs.push(job)};
      assert.equal(await admitProviderUsage(request(),s.env,ctx,{route:'discovery',units:12}),null);await Promise.all(jobs);
      assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM provider_usage WHERE admitted_at < unixepoch()-172800').get().n,66);
      assert.equal(s.sqlite.prepare('SELECT sum(units) AS n FROM provider_usage WHERE admitted_at>=unixepoch()-60').get().n,12);
      const broken={prepare(sql){if(sql.trimStart().startsWith('DELETE'))throw Error('Cleanup unavailable');return s.db.prepare(sql);}};
      assert.equal(await admitProviderUsage(request(),{DISCOVERY_DB:broken},ctx,{route:'prices',units:2}),null);await Promise.all(jobs);
      // The caller's provider failure has no refund operation to invoke.
      await assert.rejects(async()=>{throw Error('Mock provider rejected after admission');});
      assert.equal(s.sqlite.prepare('SELECT sum(units) AS n FROM provider_usage WHERE admitted_at>=unixepoch()-60').get().n,14);
      assert.equal(await admitProviderUsage(request(),s.env,{waitUntil(){throw Error('Context unavailable');}},defaultUsage),null);
      await nextTurn();assert.equal(s.sqlite.prepare('SELECT sum(units) AS n FROM provider_usage WHERE admitted_at>=unixepoch()-60').get().n,15);
    }finally{s.close();}
  });

  test('two independent workers atomically share every weighted client/global limit across all three routes',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'iaero-provider-budget-'));const hash=await realHash('192.0.2.77');
    try{
      for(const [mode,limit,age] of [['clientMinute',1024,0],['clientHour',4096,120],['clientDay',8192,7200],['globalHour',4096,120],['globalDay',16384,7200]]){
        const path=join(dir,mode+'.sqlite'),store=localD1(path);
        seedUnits(store,limit-12,{hash:mode.startsWith('client')?hash:'a'.repeat(64),age,rotateClients:mode==='globalDay'});store.close();
        const workers=[0,1].map(index=>new Worker(new URL(import.meta.url),{workerData:{path,mode,index}}));
        try{
          await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);})));
          const done=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}));
          for(const worker of workers)worker.postMessage({go:true});
          const results=await Promise.all(done),rows=results.flatMap(r=>r.results),accepted=rows.filter(r=>r.status===200),denied=rows.filter(r=>r.status===429);
          assert.equal(accepted.reduce((n,r)=>n+r.units,0),12,mode);assert.equal(accepted.length+denied.length,24,mode);assert(denied.length>0);
          assert.equal(results.reduce((n,r)=>n+r.keys,0),accepted.length);assert.equal(results.reduce((n,r)=>n+r.calls,0),accepted.length);
          const checkStore=localD1(path,{initialize:false});try{assert.equal(total(checkStore),limit,mode);}finally{checkStore.close();}
        }finally{await Promise.all(workers.map(worker=>worker.terminate()));}
      }
    }finally{await rm(dir,{recursive:true,force:true});}
  });
}
