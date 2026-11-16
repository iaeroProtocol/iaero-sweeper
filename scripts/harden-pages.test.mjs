import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hardenPages,guardInputs} from './harden-pages.mjs';
import {verifyPagesGuard} from './verify-pages.mjs';

const app=fileURLToPath(new URL('../',import.meta.url));
async function fixture(run) {
  const projectRoot=await mkdtemp(path.join(tmpdir(),'sweeper-pages-release-'));
  try {
    for(const file of guardInputs) {
      await mkdir(path.dirname(path.join(projectRoot,file)),{recursive:true});
      await copyFile(path.join(app,file),path.join(projectRoot,file));
    }
    const worker=path.join(projectRoot,'.vercel/output/static/_worker.js');
    await mkdir(worker,{recursive:true});
    const next="export default {fetch:()=>new Response('next route')};\n";
    await writeFile(path.join(worker,'index.js'),next);
    await run({projectRoot,worker,next});
  } finally {await rm(projectRoot,{recursive:true,force:true});}
}

test('real edge bundle wraps original entry without modifying it; repeated hardening is refused',()=>fixture(async f=>{
  const manifest=await hardenPages({projectRoot:f.projectRoot});
  assert.equal(manifest.binding,'DISCOVERY_DB');
  assert.equal(await readFile(path.join(f.worker,'iaero-next.mjs'),'utf8'),f.next);
  const bundle=await readFile(path.join(f.worker,'iaero-discovery.mjs'),'utf8');
  assert.match(bundle,/DISCOVERY_DB/);
  assert.match(bundle,/INSERT INTO discovery_attempts/);
  assert.doesNotMatch(bundle,/ZERO_EX_API_KEY|process\.env|\/Users\//);
  assert.deepEqual(await verifyPagesGuard({projectRoot:f.projectRoot}),manifest);
  await assert.rejects(hardenPages({projectRoot:f.projectRoot}),/already guarded/);
}));

test('release rejects a stale source or any altered wrapped/compiled/original entry',()=>fixture(async f=>{
  await hardenPages({projectRoot:f.projectRoot});
  for(const file of ['index.js','iaero-next.mjs','iaero-discovery.mjs']) {
    const target=path.join(f.worker,file),original=await readFile(target);
    await writeFile(target,Buffer.concat([original,Buffer.from('\n// altered\n')]));
    await assert.rejects(verifyPagesGuard({projectRoot:f.projectRoot}),/changed/);
    await writeFile(target,original);
  }
  await writeFile(path.join(f.projectRoot,'edge/discovery-gateway.mjs'),'// stale compiled source\n');
  await assert.rejects(verifyPagesGuard({projectRoot:f.projectRoot}),/source changed/);
}));

test('unguarded, missing and unexpected adapter outputs cannot pass release',()=>fixture(async f=>{
  await assert.rejects(verifyPagesGuard({projectRoot:f.projectRoot}));
  await rm(f.worker,{recursive:true});
  await writeFile(f.worker,"export default {};\n");
  await assert.rejects(hardenPages({projectRoot:f.projectRoot}),/unrecognized output/);
}));
