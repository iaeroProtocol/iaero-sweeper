import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createSolanaApiGateway} from '../../../edge/solana-api-gateway.mjs';
const root=new URL('../../..',import.meta.url).pathname;
const out=await mkdtemp(tmpdir()+'/iaero-solana-gateway-');
const b=await build({entryPoints:[root+'/src/lib/solana-read-api.ts'],bundle:true,platform:'node',format:'cjs',write:false});await writeFile(out+'/api.cjs',b.outputFiles[0].text);const {parseSolanaRequest}= (await import(pathToFileURL(out+'/api.cjs'))).default;
const schema=await readFile(new URL('../../../edge/provider-budget-schema.sql',import.meta.url),'utf8');
const account='7gC6tTQVFUTu2toG93nhtqx9ESvRZyHpRTY67dQksSZM';
function setup(){const db=new DatabaseSync(':memory:');db.exec(schema);let prepares=0,keys=0,providers=0;
 const env={DISCOVERY_DB:{prepare(sql){prepares++;const q=db.prepare(sql);return{bind(...values){return{async first(){return q.get(...values)??null;},async run(){q.run(...values);return{success:true};}};}};}}};Object.defineProperty(env,'HELIUS_API_KEY',{get(){keys++;return 'NOT_A_REAL_KEY';}});
 const gateway=createSolanaApiGateway({parseSolanaRequest,handleSolanaRequest:async(op,p,bindings)=>{void bindings.HELIUS_API_KEY;providers++;return {status:200,data:{ready:true}};}});
 function req(operation,body={},native=true){const r=new Request('https://mock.invalid/api/solana/'+operation,{method:operation==='status'?'GET':'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'192.0.2.34'},body:operation==='status'?undefined:JSON.stringify(body)});if(native)Object.defineProperty(r,'cf',{value:{colo:'LHR'}});return r;}
 return {db,env,gateway,req,counters:()=>({prepares,keys,providers})};}
test('malformed Solana bodies never debit/read bindings; valid request admitted only after shared D1',async()=>{const s=setup();try{
 for(const body of [{},{wallet:account,extra:true},{wallet:'not-base58'}])assert.equal((await s.gateway(s.req('discover',body),s.env)).status,400);
 assert.deepEqual(s.counters(),{prepares:0,keys:0,providers:0});
 assert.equal((await s.gateway(s.req('discover',{wallet:account}),s.env)).status,200);assert.deepEqual(s.counters(),{prepares:1,keys:1,providers:1});assert.equal(s.db.prepare('select sum(units) as n from provider_usage').get().n,12);
 }finally{s.db.close();}});
test('missing native identity/schema/global capacity closes Solana before secret/provider reads',async()=>{for(const mode of ['identity','schema','capacity']){const s=setup();try{
 if(mode==='schema')s.db.exec('DROP TABLE provider_usage');if(mode==='capacity')s.db.prepare('INSERT INTO provider_usage(client_hash,route,units,admitted_at) VALUES(?,?,?,unixepoch())').run('a'.repeat(64),'discovery',12);if(mode==='capacity'){for(let i=0;i<1400;i++)s.db.prepare('INSERT INTO provider_usage(client_hash,route,units,admitted_at) VALUES(?,?,?,unixepoch())').run('a'.repeat(64),'discovery',12);}
 const response=await s.gateway(s.req('status',{},mode!=='identity'),s.env);assert.equal(response.status,mode==='capacity'?429:503);assert.equal(s.counters().keys,0);assert.equal(s.counters().providers,0);
 }finally{s.db.close();}}});
test('inert Next route and all Solana dispatcher/helper sources are bound in guard manifest',async()=>{const {guardInputs}=await import('../../../scripts/pages-guard-contract.mjs');for(const file of ['edge/solana-api-gateway.mjs','src/lib/solana-read-api.ts','src/lib/solana-intent.ts','src/lib/solana-jupiter-idl.json','src/app/api/solana/[operation]/route.ts'])assert(guardInputs.includes(file));const fallback=await readFile(root+'/src/app/api/solana/[operation]/route.ts','utf8');assert.doesNotMatch(fallback,/process\.env|\bfetch\s*\(/);assert.match(fallback,/status:503/);});
