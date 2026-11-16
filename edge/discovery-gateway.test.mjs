import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createDiscoveryGateway, DISCOVERY_PROVIDER_KEYS, DISCOVERY_LIMITS} from './discovery-gateway.mjs';

// All tests are local. Accidental network use fails immediately, including in
// the two SQLite concurrency workers. All provider values are sentinel mocks.
globalThis.fetch = async () => { throw new Error('Network forbidden in edge gateway tests'); };
const schema = await readFile(new URL('./discovery-schema.sql', import.meta.url), 'utf8');
const address = n => '0x' + BigInt(n).toString(16).padStart(40, '0');
const ipFor = n => `198.18.${Math.floor(n / 250) % 250}.${n % 250 + 1}`;
const wallet = address(100);
const chains = ['1','8453','42161','10','137','56','43114','534352','59144'];
const successData = () => ({tokens:[address(900)],count:1,logs:['mock: complete'],
  partial:false,complete:true,providers:[{provider:'alchemy',status:'complete',count:1,pages:1}],
  budgetMs:7800,limitations:['Mock candidates require fresh balances.']});

function request({ip='192.0.2.10', chainId='8453', account=wallet, path='/api/tokens/discover',
  query, method='GET', cf={colo:'LHR',asn:13335}, headers={}, signal}={}) {
  const params = query ?? new URLSearchParams({chainId, wallet:account}).toString();
  const req = new Request('https://edge.invalid' + path + (params ? '?' + params : ''),
    {method, headers:{...(ip === null ? {} : {'CF-Connecting-IP':ip}),...headers},signal});
  if (cf !== undefined && cf !== false) Object.defineProperty(req, 'cf', {value:cf});
  return req;
}

function localD1(path=':memory:', {initialize=true, defer=false}={}) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA busy_timeout = 5000');
  if (initialize) sqlite.exec(schema);
  const statements=[];
  const db={prepare(sql) {
    statements.push(sql);
    const statement=sqlite.prepare(sql);
    const bound=values=>({
      bind:(...next)=>bound(next),
      async first() { if(defer) await nextTurn(); return statement.get(...values) ?? null; },
      async run() { if(defer) await nextTurn(); const result=statement.run(...values);return {success:true,meta:{changes:Number(result.changes)}}; },
    });
    return bound([]);
  }};
  return {sqlite,db,statements,close:()=>sqlite.close()};
}

function setup(options) {
  const store=localD1(undefined,options),state={calls:0,keyReads:0,seen:[]};
  const env={DISCOVERY_DB:store.db};
  for(const key of DISCOVERY_PROVIDER_KEYS) Object.defineProperty(env,key,{get(){state.keyReads++;return 'sentinel-'+key;}});
  Object.defineProperty(env,'ZERO_EX_API_KEY',{get(){throw new Error('Unrelated key must never be read');}});
  const helper=async(params,keys,options)=>{
    state.calls++;state.seen.push({params:new URLSearchParams(params),keys,options});
    return {status:200,data:successData(),headers:{'x-private-key':'never-forward','access-control-allow-origin':'*','cache-control':'public'}};
  };
  return {...store,state,env,helper,gate:createDiscoveryGateway(helper)};
}

async function body(response) { return response.json(); }
async function clientHash(ip) {
  const s=setup();try {await s.gate(request({ip}),s.env);return s.sqlite.prepare('SELECT client_hash FROM discovery_attempts').get().client_hash;}finally{s.close();}
}
function seed(store,count,{hash='a'.repeat(64),account=address(700),age=120,uniqueWallet=false}={}) {
  const stmt=store.sqlite.prepare('INSERT INTO discovery_attempts(client_hash,wallet,chain_id,admitted_at) VALUES(?,?,8453,unixepoch()-?)');
  for(let i=0;i<count;i++)stmt.run(hash,uniqueWallet?address(1000+i):account,age);
}
function assertGuard(response,status,state) {
  assert.equal(response.status,status);
  assert.equal(response.headers.get('x-discovery-guard'),'d1-v1');
  assert.equal(response.headers.get('x-discovery-budget'),state);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
}

async function concurrencyWorker() {
  const s=localD1(workerData.path,{initialize:false,defer:true});let calls=0;
  const gate=createDiscoveryGateway(async()=>{calls++;return {status:200,data:successData()};});
  parentPort.postMessage({ready:true});await new Promise(resolve=>parentPort.once('message',resolve));
  const responses=await Promise.all(Array.from({length:12},(_,i)=>{
    const n=workerData.index*20+i;
    return gate(request({ip:workerData.mode==='client'?'192.0.2.77':ipFor(n),
      account:workerData.mode==='wallet'?wallet:address(2000+n),chainId:chains[n%chains.length]}),{DISCOVERY_DB:s.db});
  }));
  s.close();parentPort.postMessage({statuses:responses.map(r=>r.status),calls});
}

if (!isMainThread) {
  await concurrencyWorker();
} else {
  test('exact route, GET only, strict parameters and all nine original chains',async()=>{
    const s=setup();try {
      assert.equal(await s.gate(request({path:'/api/tokens/discover/'}),s.env),null);
      assert.equal(await s.gate(request({path:'/other'}),s.env),null);
      const method=await s.gate(request({method:'POST'}),s.env);assertGuard(method,405,'invalid');assert.equal(method.headers.get('allow'),'GET');
      for(const query of [
        '', `chainId=8453&wallet=${wallet}&chainId=1`, `chainId=8453&wallet=${wallet}&wallet=${wallet}`,
        `chainId=8453&wallet=${wallet}&provider=alchemy`, `chainId=08453&wallet=${wallet}`,
        `chainId=8453junk&wallet=${wallet}`, `chainId=999&wallet=${wallet}`,`wallet=${wallet}`,
        'chainId=8453', 'chainId=8453&wallet=0x123',`chainId=8453&wallet=${address(0)}`,
        'chainId=8453&wallet=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      ])assertGuard(await s.gate(request({query}),s.env),400,'invalid');
      assert.equal(s.state.calls,0);assert.equal(s.state.keyReads,0);assert.equal(s.statements.length,0);
      for(let i=0;i<chains.length;i++)assertGuard(await s.gate(request({chainId:chains[i],ip:ipFor(i),account:address(100+i)}),s.env),200,'admitted');
      assert.equal(s.state.calls,9);assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts').get().n,9);
    }finally{s.close();}
  });

  test('missing binding/native identity and spoofed forwarding/origin headers fail before any key access',async()=>{
    const s=setup();try {
      const badRequests=[request({cf:false}),request({cf:null}),request({cf:'LHR'}),request({ip:null}),
        request({ip:'not-an-ip'}),request({ip:'192.0.2.1, 192.0.2.2'}),request({ip:'999.2.3.4'}),
        request({ip:'0192.0.2.1'}),request({ip:'[2001:db8::1]'}),request({ip:'2001:db8::1%eth0'}),
        request({cf:false,headers:{Origin:'https://edge.invalid','X-Forwarded-For':'192.0.2.1','X-Real-IP':'192.0.2.1'}})];
      for(const req of badRequests)assertGuard(await s.gate(req,s.env),503,'unavailable');
      const noDb={};for(const key of DISCOVERY_PROVIDER_KEYS)Object.defineProperty(noDb,key,{get(){throw Error('key read before gate');}});
      assertGuard(await s.gate(request(),noDb),503,'unavailable');assertGuard(await s.gate(request(),undefined),503,'unavailable');
      assert.equal(s.state.calls,0);assert.equal(s.state.keyReads,0);assert.equal(s.statements.length,0);
      // Origin is not authorization; native identity and quota are what matter.
      assertGuard(await s.gate(request({headers:{Origin:'https://other.invalid'}}),s.env),200,'admitted');
    }finally{s.close();}
  });

  test('normalized wallet/IPv6 and IPv4-mapped IPv6 share durable identity; raw IP is never stored',async()=>{
    const s=setup();try {
      const variants=['2001:DB8:0:0:0:0:0:1','2001:db8::1'];
      for(let i=0;i<6;i++)assert.equal((await s.gate(request({ip:variants[i%2],account:address(1000+i)}),s.env)).status,200);
      assertGuard(await s.gate(request({ip:variants[0],account:address(2000)}),s.env),429,'denied');
      const rows=s.sqlite.prepare('SELECT client_hash,wallet,chain_id,admitted_at FROM discovery_attempts').all();
      assert.equal(new Set(rows.map(r=>r.client_hash)).size,1);assert.match(rows[0].client_hash,/^[0-9a-f]{64}$/);
      assert(!JSON.stringify(rows).includes('2001:'));assert(!JSON.stringify(rows).includes('192.0.2'));
      assert.equal(await clientHash('192.0.2.1'),await clientHash('::ffff:192.0.2.1'));
      const mixed='0x'+('Ab'.repeat(20));
      for(let i=0;i<3;i++)assert.equal((await s.gate(request({ip:ipFor(50+i),account:i%2?mixed.toLowerCase():mixed,chainId:chains[i]}),s.env)).status,200);
      assert.equal((await s.gate(request({ip:ipFor(60),account:mixed.toLowerCase(),chainId:'59144'}),s.env)).status,429);
      assert.equal(s.state.seen.at(-1).params.get('wallet'),mixed.toLowerCase());
    }finally{s.close();}
  });

  test('client minute6 and wallet minute3 limits cannot be bypassed by wallet/IP/chain rotation',async()=>{
    const s=setup();try {
      for(let i=0;i<6;i++)assert.equal((await s.gate(request({account:address(500+i),chainId:chains[i]}),s.env)).status,200);
      const before=s.state.keyReads;const denied=await s.gate(request({account:address(999),chainId:'59144'}),s.env);
      assertGuard(denied,429,'denied');assert.equal(denied.headers.get('retry-after'),'60');assert.equal(s.state.keyReads,before);
      for(let i=0;i<3;i++)assert.equal((await s.gate(request({ip:ipFor(i),account:wallet,chainId:chains[i]}),s.env)).status,200);
      assertGuard(await s.gate(request({ip:ipFor(99),account:wallet,chainId:'59144'}),s.env),429,'denied');
      assert.equal(s.state.calls,9);assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts').get().n,9);
    }finally{s.close();}
  });

  test('client hour60, wallet hour30, global hour120 and global day500 include exactly the last allowed attempt',async()=>{
    for(const mode of ['client','wallet','globalHour','globalDay']) {
      const s=setup();try {
        const req=request({account:wallet});
        const limit=mode==='client'?60:mode==='wallet'?30:mode==='globalHour'?120:500;
        seed(s,limit-1,{hash:mode==='client'?await clientHash('192.0.2.10'):'a'.repeat(64),
          account:mode==='wallet'?wallet:address(700),age:mode==='globalDay'?7200:120});
        assertGuard(await s.gate(req,s.env),200,'admitted');
        assertGuard(await s.gate(request({account:mode==='wallet'?wallet:address(333),ip:mode==='client'?'192.0.2.10':ipFor(88),chainId:'59144'}),s.env),429,'denied');
        assert.equal(s.state.calls,1);assert.equal(s.state.keyReads,DISCOVERY_PROVIDER_KEYS.length);
        assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts').get().n,limit);
      }finally{s.close();}
    }
  });

  test('expired rolling-window attempts do not deny a new scan; admission timestamp comes from DB',async()=>{
    const s=setup();try {
      seed(s,60,{hash:await clientHash('192.0.2.10'),age:3602});
      seed(s,30,{account:wallet,age:3602});
      seed(s,500,{age:86402});
      const before=s.sqlite.prepare('SELECT unixepoch() n').get().n;
      assertGuard(await s.gate(request(),s.env),200,'admitted');
      const last=s.sqlite.prepare('SELECT admitted_at FROM discovery_attempts ORDER BY id DESC LIMIT 1').get().admitted_at;
      const after=s.sqlite.prepare('SELECT unixepoch() n').get().n;
      assert(last>=before&&last<=after);assert.equal(s.state.calls,1);
    }finally{s.close();}
  });

  test('120 independent wallets and clients consume global budget; attempt121 cannot read provider keys',async()=>{
    const s=setup();try {
      for(let i=0;i<120;i++)assert.equal((await s.gate(request({ip:ipFor(i),account:address(2000+i),chainId:chains[i%9]}),s.env)).status,200);
      const reads=s.state.keyReads;
      assertGuard(await s.gate(request({ip:ipFor(121),account:address(4000)}),s.env),429,'denied');
      assert.equal(s.state.calls,120);assert.equal(s.state.keyReads,reads);
      assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts').get().n,120);
    }finally{s.close();}
  });

  test('schema/index/SQLite failures and malformed D1 admission rows fail closed without provider key access',async()=>{
    const s=setup({initialize:false});try {
      const response=await s.gate(request(),s.env);assertGuard(response,503,'unavailable');
      assert.equal(s.state.calls,0);assert.equal(s.state.keyReads,0);
      s.sqlite.exec(schema);s.sqlite.exec('DROP INDEX discovery_attempts_client_time');
      assertGuard(await s.gate(request(),s.env),503,'unavailable');assert.equal(s.state.calls,0);assert.equal(s.state.keyReads,0);
      for(const first of [async()=>{throw new Error('private-key https://private.invalid/never-show');},async()=>({}),async()=>undefined,async()=>({id:'1'}),async()=>({id:0})]) {
        const env={DISCOVERY_DB:{prepare(){return{bind(){return{first};}};}}};
        Object.defineProperty(env,'ALCHEMY_API_KEY',{get(){throw new Error('must not read key');}});
        const r=await s.gate(request(),env);assertGuard(r,503,'unavailable');const text=JSON.stringify(await body(r));
        assert(!text.includes('private-key'));assert(!text.includes('https://'));assert(!text.includes('192.0.2.10'));
      }
    }finally{s.close();}
  });

  test('limiter timeout and cancellation never start a provider, even if a late write later succeeds',async()=>{
    let lateResolve,keys=0,calls=0;
    const gate=createDiscoveryGateway(async()=>{calls++;return{status:200,data:successData()};});
    const env={DISCOVERY_DB:{prepare(){return{bind(){return{first:()=>new Promise(resolve=>lateResolve=resolve)};}};}}};
    Object.defineProperty(env,'ALCHEMY_API_KEY',{get(){keys++;return'sentinel';}});
    const start=performance.now();const response=await gate(request(),env);
    assertGuard(response,503,'unavailable');assert(performance.now()-start<DISCOVERY_LIMITS.gateTimeoutMs+500);
    lateResolve({id:1});await nextTurn();assert.equal(calls,0);assert.equal(keys,0);
    const abort=new AbortController();const pending=gate(request({signal:abort.signal}),env);setTimeout(()=>abort.abort(),10);
    assertGuard(await pending,503,'unavailable');assert.equal(calls,0);assert.equal(keys,0);
  });

  test('provider environment is projected only after admission, preserving all explorer keys and original JSON',async()=>{
    const s=setup();try {
      const r=await s.gate(request(),s.env);assertGuard(r,200,'admitted');assert.deepEqual(await body(r),successData());
      assert.equal(r.headers.get('x-private-key'),null);assert.equal(r.headers.get('access-control-allow-origin'),null);
      const seen=s.state.seen[0];assert.deepEqual(Object.keys(seen.keys),DISCOVERY_PROVIDER_KEYS);
      for(const key of DISCOVERY_PROVIDER_KEYS)assert.equal(seen.keys[key],'sentinel-'+key);
      assert.equal(seen.options.budgetMs,7800);assert.equal(seen.options.signal.aborted,true);
      const stored=s.sqlite.prepare('SELECT * FROM discovery_attempts').get();
      assert(!JSON.stringify(stored).includes('sentinel'));assert.equal(stored.wallet,wallet);assert.equal(stored.chain_id,8453);
    }finally{s.close();}
  });

  test('provider rejection/cancellation keeps admission debited and returns a safe error',async()=>{
    const s=setup();try {
      const gate=createDiscoveryGateway(async()=>{throw Error('https://provider.invalid/secret-provider-key');});
      assertGuard(await gate(request(),s.env),503,'unavailable');
      assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts').get().n,1);
      const abort=new AbortController();let started;
      const began=new Promise(resolve=>started=resolve);
      const hanging=createDiscoveryGateway(async()=>{started();return new Promise(()=>{});});
      const pending=hanging(request({ip:ipFor(80),signal:abort.signal}),s.env);await began;abort.abort();
      const response=await pending;assertGuard(response,503,'unavailable');assert(!JSON.stringify(await body(response)).includes('secret-provider-key'));
      assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts').get().n,2);
    }finally{s.close();}
  });

  test('provider hard deadline bounds even a helper that ignores AbortSignal',async t=>{
    const s=setup();let started;
    const began=new Promise(resolve=>started=resolve);
    t.mock.timers.enable({apis:['setTimeout']});
    try {
      const gate=createDiscoveryGateway(async()=>{started();return new Promise(()=>{});});
      const pending=gate(request(),s.env);await began;t.mock.timers.tick(8001);
      assertGuard(await pending,503,'unavailable');assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts').get().n,1);
    }finally{t.mock.timers.reset();s.close();}
  });

  test('48h cleanup is bounded, optional and best effort; denied requests cannot schedule cleanup',async()=>{
    const s=setup();try {
      seed(s,130,{age:172802});const jobs=[];const ctx={waitUntil:job=>jobs.push(job)};
      assertGuard(await s.gate(request(),s.env,ctx),200,'admitted');await Promise.all(jobs);
      assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts WHERE admitted_at < unixepoch()-172800').get().n,66);
      assert.equal(s.sqlite.prepare('SELECT count(*) n FROM discovery_attempts WHERE admitted_at >= unixepoch()-60').get().n,1);
      const broken={prepare(sql){if(sql.trimStart().startsWith('DELETE'))throw Error('cleanup unavailable');return s.db.prepare(sql);}};
      assertGuard(await s.gate(request({ip:ipFor(90)}),{...s.env,DISCOVERY_DB:broken},ctx),200,'admitted');await Promise.all(jobs);
      assertGuard(await s.gate(request({ip:ipFor(91)}),s.env,ctx),200,'admitted');await Promise.all(jobs);const count=jobs.length;
      assertGuard(await s.gate(request({ip:ipFor(92)}),s.env,ctx),429,'denied');assert.equal(jobs.length,count);
    }finally{s.close();}
  });

  test('two independent handler isolates race one shared SQLite primary without exceeding client/wallet/global limits',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'iaero-discovery-gate-'));
    try {
      for(const [mode,expected] of [['client',6],['wallet',3],['global',2]]) {
        const path=join(dir,mode+'.sqlite');const store=localD1(path);
        if(mode==='global')seed(store,118,{age:120});store.close();
        const workers=[0,1].map(index=>new Worker(new URL(import.meta.url),{workerData:{path,mode,index}}));
        try {
          const ready=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}));
          await Promise.all(ready);
          const done=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}));
          for(const worker of workers)worker.postMessage({go:true});
          const results=await Promise.all(done),statuses=results.flatMap(r=>r.statuses);
          assert.equal(statuses.filter(s=>s===200).length,expected,mode);
          assert.equal(statuses.filter(s=>s===429).length,24-expected,mode);
          assert.equal(results.reduce((n,r)=>n+r.calls,0),expected,mode);
          const check=localD1(path,{initialize:false});
          try{assert.equal(check.sqlite.prepare('SELECT count(*) n FROM discovery_attempts').get().n,mode==='global'?120:expected);}finally{check.close();}
        }finally{await Promise.all(workers.map(worker=>worker.terminate()));}
      }
    }finally{await rm(dir,{recursive:true,force:true});}
  });
}
