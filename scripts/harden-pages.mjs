import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {verifyPagesGuard} from './verify-pages.mjs';
import {guardInputs,guardVersion,guardEntry} from './pages-guard-contract.mjs';

export {guardInputs,guardEntry};
const sha = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../',import.meta.url));

export async function hardenPages({projectRoot=root, output='.vercel/output/static', esbuild}={}) {
  const outputRoot = path.resolve(projectRoot,output);
  const worker = path.join(outputRoot,'_worker.js');
  if (!(await stat(worker)).isDirectory()) throw new Error('Expected the next-on-pages _worker.js directory; refusing unrecognized output.');
  const entry = path.join(worker,'index.js');
  if (/IAERO_(?:DISCOVERY_GUARD_V1|KEYED_API_GUARD_V2)/.test(await readFile(entry,'utf8'))) {
    throw new Error('Pages output is already guarded. Rebuild clean output before hardening again.');
  }
  const {build} = esbuild ?? await import('esbuild');
  const bundle = await build({
    stdin: {contents: `import {withDiscoveryGuard} from './edge/pages-dispatch.mjs';
import {discoverTokens,parseQuoteRequest,handleQuoteRequest} from './src/lib/sweeper-read-api.ts';
import {parsePriceRequest,handlePriceRequest} from './src/lib/coingecko-read-api.ts';
import {parseSolanaRequest,handleSolanaRequest} from './src/lib/solana-read-api.ts';
export const guardPages = nextWorker => withDiscoveryGuard(nextWorker,{discoverTokens,parseQuoteRequest,handleQuoteRequest,parsePriceRequest,handlePriceRequest,parseSolanaRequest,handleSolanaRequest});`,
      resolveDir:projectRoot,sourcefile:'iaero-discovery-entry.mjs',loader:'js'},
    absWorkingDir:projectRoot,bundle:true,format:'esm',platform:'browser',target:'es2022',
    sourcemap:false,minify:false,write:false,legalComments:'none',
  });
  if (bundle.outputFiles.length !== 1) throw new Error('Unexpected discovery bundle output.');
  const compiled = bundle.outputFiles[0].contents;
  const original = await readFile(entry);
  const inputs = Object.fromEntries(await Promise.all(guardInputs.map(async file => [file,sha(await readFile(path.join(projectRoot,file)))])));
  const manifest = {version:2,guard:guardVersion,binding:'DISCOVERY_DB',inputs,
    entrySha256:sha(guardEntry),nextSha256:sha(original),bundleSha256:sha(compiled)};
  // Original imports remain relative to the same directory. No ASSETS fallback
  // or public /functions middleware can call the provider helper outside here.
  await writeFile(path.join(worker,'iaero-discovery.mjs'),compiled,{flag:'wx'});
  await rename(entry,path.join(worker,'iaero-next.mjs'));
  await writeFile(entry,guardEntry,{flag:'wx'});
  await writeFile(path.join(worker,'iaero-discovery-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await verifyPagesGuard({projectRoot,output});
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifest = await hardenPages();
  console.log(`Pages discovery guard installed and verified (${manifest.guard}; ${Object.keys(manifest.inputs).length} input hashes).`);
}
