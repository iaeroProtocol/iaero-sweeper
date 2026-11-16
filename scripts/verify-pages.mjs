import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../',import.meta.url));
const expectedInputs = ['edge/discovery-gateway.mjs','edge/pages-dispatch.mjs',
  'edge/discovery-schema.sql','src/lib/sweeper-read-api.ts','src/app/api/tokens/discover/route.ts'];
export async function verifyPagesGuard({projectRoot=root,output='.vercel/output/static'}={}) {
  const worker = path.resolve(projectRoot,output,'_worker.js');
  const manifest = JSON.parse(await readFile(path.join(worker,'iaero-discovery-manifest.json'),'utf8'));
  if (manifest.version!==1 || manifest.guard!=='d1-v1' || manifest.binding!=='DISCOVERY_DB'
    || JSON.stringify(Object.keys(manifest.inputs).sort())!==JSON.stringify(expectedInputs.slice().sort())) throw new Error('Missing or unexpected discovery guard manifest.');
  for (const file of expectedInputs) {
    if (sha(await readFile(path.join(projectRoot,file)))!==manifest.inputs[file]) throw new Error(`Pages guard source changed after bundle: ${file}`);
  }
  const entry = await readFile(path.join(worker,'index.js'),'utf8');
  if (!entry.startsWith('// IAERO_DISCOVERY_GUARD_V1') || !entry.includes("export default guardPages(nextWorker);")) throw new Error('Pages entry bypasses discovery admission.');
  for (const [file,hash] of [['index.js',manifest.entrySha256],['iaero-next.mjs',manifest.nextSha256],['iaero-discovery.mjs',manifest.bundleSha256]]) {
    if (sha(await readFile(path.join(worker,file)))!==hash) throw new Error(`Pages output changed: ${file}`);
  }
  const fallback = await readFile(path.join(projectRoot,'src/app/api/tokens/discover/route.ts'),'utf8');
  if (/process\.env|discoverTokens|sweeper-read-api/.test(fallback) || !fallback.includes('status: 503')) throw new Error('Next fallback must fail closed without provider access.');
  async function scan(directory) {
    for (const item of await readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,item.name);
      if(item.isSymbolicLink()) throw new Error('Unexpected symlink in Pages Worker output.');
      if(item.isDirectory()) await scan(file);
      else if(/\.(js|mjs|json|map|html|txt)$/.test(file)) {
        const contents=await readFile(file,'utf8');
        if(contents.includes('/Users/')||contents.includes('C:\\Users\\')) throw new Error('Local user path in Pages Worker output.');
        if(/BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY/.test(contents)) throw new Error('Private key block in Pages output.');
      }
    }
  }
  await scan(worker);
  return manifest;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifest=await verifyPagesGuard();
  console.log(`Pages guard release check passed (${manifest.guard}; hosted binding and migration must be checked separately).`);
}
