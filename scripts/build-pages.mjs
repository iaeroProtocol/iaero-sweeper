import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hardenPages} from './harden-pages.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const supplied=process.env.PAGES_BUILD_TOOLS;
const offline=process.env.PAGES_BUILD_OFFLINE==='1';
if(offline&&!supplied)throw new Error('Offline build requires the separately installed pinned PAGES_BUILD_TOOLS directory.');
let command='npm',args=['exec','--yes','--legacy-peer-deps',
  '--package=@cloudflare/next-on-pages@1.13.16','--package=vercel@59.1.3','--','next-on-pages'];
const env={...process.env,NEXT_TELEMETRY_DISABLED:'1',VERCEL_TELEMETRY_DISABLED:'1'};
if(offline)env.npm_config_offline='true';
if(supplied) {
  const tools=path.resolve(supplied);
  const adapter=JSON.parse(await readFile(path.join(tools,'node_modules/@cloudflare/next-on-pages/package.json'),'utf8'));
  const vercel=JSON.parse(await readFile(path.join(tools,'node_modules/vercel/package.json'),'utf8'));
  if(adapter.version!=='1.13.16'||vercel.version!=='59.1.3')throw new Error('Pinned build tools must be next-on-pages1.13.16 and Vercel59.1.3.');
  const bin=typeof adapter.bin==='string'?adapter.bin:Object.values(adapter.bin??{})[0];
  if(typeof bin!=='string')throw new Error('Pinned adapter executable missing.');
  command=process.execPath;args=[path.resolve(tools,'node_modules/@cloudflare/next-on-pages',bin)];
  env.PATH=path.join(tools,'node_modules/.bin')+path.delimiter+(env.PATH??'');
}
const code=await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,env,stdio:'inherit'});
  child.once('error',reject);child.once('exit',value=>resolve(value??1));
});
if(code!==0)process.exitCode=code;
else {
  const manifest=await hardenPages({projectRoot:root});
  console.log(`Pages shared provider guard installed and verified (${manifest.guard}; ${Object.keys(manifest.inputs).length} input hashes).`);
}
