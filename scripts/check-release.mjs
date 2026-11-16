import fs from 'node:fs/promises';
import path from 'node:path';
const build=process.env.NEXT_BUILD_DIR||'.next';
let inspected=0;
async function walk(root){const files=[];try{for(const entry of await fs.readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isDirectory())files.push(...await walk(file));else files.push(file);}}catch(e){if(e.code!=='ENOENT')throw e;}return files;}
const publicFiles=[...await walk('public'),...await walk(path.join(build,'static')),...(await walk(path.join(build,'server','app'))).filter(f=>/\.(html|rsc|js)$/.test(f))];
const failures=[];
for(const file of publicFiles){if(!/\.(js|css|html|rsc|json|svg|txt)$/.test(file))continue;inspected++;const text=await fs.readFile(file,'utf8');if(text.includes('/Users/')||text.includes('C:\\Users\\'))failures.push(file+': local user path');if(/BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY/.test(text))failures.push(file+': private key block');if(/\.css$/.test(file)&&/@import[^;]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/.test(text))failures.push(file+': remote font import');}
if(!publicFiles.some(f=>f.includes(path.join(build,'static'))))failures.push('Production build missing. Run npm run build first.');
const packageJson=JSON.parse(await fs.readFile('package.json','utf8'));const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));
if(packageJson.dependencies.next!==lock.packages['node_modules/next'].version)failures.push('Next.js package and lockfile differ.');
if(failures.length){for(const failure of failures)console.error(failure);process.exitCode=1;}else console.log(`Release checks passed (${inspected} public/runtime files; self-hosted font; no local user paths).`);
