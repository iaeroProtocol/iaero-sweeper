import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import {createHash} from 'node:crypto';
const root=new URL('../../..',import.meta.url).pathname;
const out=await mkdtemp(tmpdir()+'/iaero-solana-author-');
// External packages resolve through the project's existing dependencies.
// Bundle all dependencies below instead, so temporary outputs have no package lookup requirement.
async function bundled(file){const b=await build({entryPoints:[root+'/'+file],bundle:true,platform:'node',format:'cjs',write:false});const target=out+'/'+file.split('/').pop()+'.cjs';await writeFile(target,b.outputFiles[0].text);return (await import(pathToFileURL(target))).default;}
const I=await bundled('src/lib/solana-intent.ts'),P=await bundled('src/lib/solana-pending.ts'),A=await bundled('src/lib/solana-read-api.ts');
const E=await bundled('src/components/solana-sweeper/solana-swap.ts');
const owner=Keypair.fromSeed(new Uint8Array(32).fill(7)),account=owner.publicKey.toBase58(),mint=Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey.toBase58(),hash=Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();
const now=Date.now(),pool=Keypair.fromSeed(new Uint8Array(32).fill(10)).publicKey.toBase58();
function quote(overrides={}){return {inputMint:mint,outputMint:I.SOLANA_USDC,inAmount:'1000',outAmount:'10000',otherAmountThreshold:'9900',swapMode:'ExactIn',slippageBps:100,priceImpactPct:'0.01',platformFee:{amount:'5',feeBps:5},routePlan:[{percent:100,swapInfo:{inputMint:mint,outputMint:I.SOLANA_USDC,inAmount:'1000',ammKey:pool}}],quotedAt:now,contextSlot:123,...overrides};}
function review(q=quote(),force=false){return I.createSolanaReview(account,q,8,6,force,now);}
function instruction(q=quote()){
 const bytes=Buffer.alloc(35);createHash('sha256').update('global:route').digest().copy(bytes,0,0,8);bytes.writeUInt32LE(1,8);bytes[12]=38;bytes[13]=100;bytes[14]=0;bytes[15]=1;bytes.writeBigUInt64LE(BigInt(q.inAmount),16);bytes.writeBigUInt64LE(BigInt(q.outAmount),24);bytes.writeUInt16LE(q.slippageBps,32);bytes[34]=5;
 const event=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],new PublicKey(I.JUPITER_PROGRAM))[0].toBase58();
 return {programId:I.JUPITER_PROGRAM,accounts:[I.SPL_TOKEN,account,I.associatedToken(account,mint),I.associatedToken(account,I.SOLANA_USDC),I.JUPITER_PROGRAM,I.SOLANA_USDC,I.associatedToken(I.SOLANA_FEE_WALLET,I.SOLANA_USDC),event,I.JUPITER_PROGRAM,I.SOLANA_DEX_PROGRAMS.MeteoraDlmm,pool,I.SOLANA_DEX_PROGRAMS.MeteoraDlmm,mint,I.SOLANA_USDC,I.associatedToken(account,mint),I.associatedToken(account,I.SOLANA_USDC),mint,I.SOLANA_USDC,pool,I.SOLANA_DEX_PROGRAMS.MeteoraDlmm,account,I.SPL_TOKEN,I.SPL_TOKEN,event,I.SOLANA_DEX_PROGRAMS.MeteoraDlmm].map((pubkey,i)=>({pubkey,isSigner:i===1,isWritable:[2,3,6,10,12,13,14,15,18].includes(i)})),data:bytes.toString('base64')};
}
function plan(q=quote()){const ix=instruction(q);return {network:I.SOLANA_MAINNET,account,feeWallet:I.SOLANA_FEE_WALLET,quote:q,swapInstruction:ix,blockhash:hash,lastValidBlockHeight:500,constructedAt:now,createOutputAta:false,accountProofs:[...new Set(ix.accounts.map(a=>a.pubkey))].map(pubkey=>({pubkey,owner:pubkey===pool?I.SOLANA_DEX_PROGRAMS.MeteoraDlmm:'11111111111111111111111111111111',exists:true,executable:[I.SPL_TOKEN,I.JUPITER_PROGRAM,I.SOLANA_DEX_PROGRAMS.MeteoraDlmm].includes(pubkey)}))};}
function memory(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};}
let count=0;function lease(){let active=true;return {name:'test',journalId:`00000000-0000-4000-8000-${String(++count).padStart(12,'0')}`,assertActive(){if(!active)throw Error('released');},release(){active=false;}};}
function balance(index,mint,amount){return {accountIndex:index,mint,owner:account,uiTokenAmount:{amount:String(amount)}};}
function canonical(record,tx){const source=I.associatedToken(account,mint),dest=I.associatedToken(account,I.SOLANA_USDC),keys=tx.message.staticAccountKeys.map(k=>k.toBase58());return {network:I.SOLANA_MAINNET,finalizedHeight:499,blockhashValid:true,status:{confirmationStatus:'finalized'},transaction:{wire:record.signedWire,slot:1234,err:null,preTokenBalances:[balance(keys.indexOf(source),mint,1000),balance(keys.indexOf(dest),I.SOLANA_USDC,200)],postTokenBalances:[balance(keys.indexOf(source),mint,0),balance(keys.indexOf(dest),I.SOLANA_USDC,10150)]}};}

test('exact reviewed floor, account, units, age and worsening impact survive fresh quotes',()=>{
 const i=review();I.assertSolanaReview(i,account,quote({outAmount:'11000',otherAmountThreshold:'10890'}),now);
 for(const q of [quote({outAmount:'5000',otherAmountThreshold:'4950'}),quote({priceImpactPct:'0.5'}),quote({inAmount:'1001'}),quote({quotedAt:now-60_001}),quote({platformFee:{amount:'5',feeBps:0}})])assert.throws(()=>I.assertSolanaReview(i,account,q,now));
 assert.equal(I.jupiterImpactPercent(quote()),1);assert.equal(I.jupiterImpactPercent(quote({priceImpactPct:'1'})),100);
 assert.throws(()=>I.createSolanaReview(account,quote({priceImpactPct:'0.5'}),8,6,false,now));const accepted=review(quote({priceImpactPct:'0.5'}),true);I.assertSolanaReview(accepted,account,quote({priceImpactPct:'0.5'}),now);assert.throws(()=>I.assertSolanaReview(accepted,account,quote({priceImpactPct:'0.51'}),now));
});
test('executable route binding rejects unrelated instruction, recipient, cap, floor, fee, signer and unsupported family',()=>{
 const i=review(),q=quote();I.validateJupiterRoute(instruction(),i,q,I.SOLANA_FEE_WALLET,now);
 for(const mutate of [x=>x.programId='11111111111111111111111111111111',x=>x.accounts[3].pubkey=mint,x=>x.accounts[6].pubkey=mint,x=>x.accounts[1].isWritable=true,x=>x.accounts.push({pubkey:account,isSigner:true,isWritable:true}),x=>{const b=Buffer.from(x.data,'base64');b.writeBigUInt64LE(1001n,16);x.data=b.toString('base64');},x=>{const b=Buffer.from(x.data,'base64');b.writeUInt16LE(500,32);x.data=b.toString('base64');},x=>{const b=Buffer.from(x.data,'base64');b[12]=13;x.data=b.toString('base64');}]){const x=instruction();mutate(x);assert.throws(()=>I.validateJupiterRoute(x,i,q,I.SOLANA_FEE_WALLET,now));}
 const tx=I.compileSolanaPlan(plan(),i,now);assert.equal(tx.message.header.numRequiredSignatures,1);assert.equal(tx.message.addressTableLookups.length,0);assert.equal(tx.message.compiledInstructions.length,3);
 const unknown=structuredClone(plan());unknown.accountProofs.find(p=>p.pubkey===pool).executable=true;assert.throws(()=>I.compileSolanaPlan(unknown,i,now));const wrongPool=structuredClone(plan());wrongPool.accountProofs.find(p=>p.pubkey===pool).owner=I.JUPITER_PROGRAM;assert.throws(()=>I.compileSolanaPlan(wrongPool,i,now));
});
test('persist before signing, persist original signed bytes before send, reload holds exact signature/context',()=>{
 const storage=memory(),i=review(),tx=I.compileSolanaPlan(plan(),i,now),j=P.beginSolanaPending(storage,lease(),i,tx,500);
 assert.equal(P.readSolanaPending(storage,account).record.phase,'signing');tx.sign([owner]);const record=j.signed(tx);assert.equal(P.readSolanaPending(storage,account).record.signedWire,Buffer.from(tx.serialize()).toString('base64'));
 assert.throws(()=>j.submitted('different'));j.unknown();const restored=P.readSolanaPending(storage,account);assert.equal(restored.record.blockhash,hash);assert.equal(restored.record.lastValidBlockHeight,500);assert.equal(restored.record.signature,record.signature);
 assert.equal(P.validateSolanaReconciliation(restored.record,{network:I.SOLANA_MAINNET,transaction:null,finalizedHeight:600,blockhashValid:false}).state,'expired-unresolved');assert.ok(storage.getItem(P.solanaPendingKey(account)));
});
test('wallet mutation or journal replacement cannot be signed/sent/cleared through original owner',()=>{
 const storage=memory(),i=review(),tx=I.compileSolanaPlan(plan(),i,now),j=P.beginSolanaPending(storage,lease(),i,tx,500),other=I.compileSolanaPlan({...plan(),blockhash:mint},i,now);other.sign([owner]);assert.throws(()=>j.signed(other));
 storage.setItem(P.solanaPendingKey(account),'replaced');assert.throws(()=>j.clear());
});
test('finalized settlement uses actual token deltas and saved full wire; no quote-as-received or double clearance',()=>{
 const storage=memory(),i=review(),tx=I.compileSolanaPlan(plan(),i,now),j=P.beginSolanaPending(storage,lease(),i,tx,500);tx.sign([owner]);const p=j.signed(tx),data=canonical(p,tx);assert.equal(P.validateSolanaReconciliation(p,data).outputAmount,'9950');
 assert.throws(()=>P.validateSolanaReconciliation(p,{...data,transaction:{...data.transaction,wire:'AAAA'}}));const bad=structuredClone(data);bad.transaction.postTokenBalances[1].uiTokenAmount.amount='100';assert.throws(()=>P.validateSolanaReconciliation(p,bad));
});
function tokenAccount(mint,owner){const b=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(b,0);new PublicKey(owner).toBuffer().copy(b,32);b.writeBigUInt64LE(1000n,64);b[108]=1;return {owner:I.SPL_TOKEN,executable:false,data:[b.toString('base64'),'base64']};}
function mintAccount(decimals){const b=Buffer.alloc(82);b[44]=decimals;b[45]=1;return {owner:I.SPL_TOKEN,executable:false,data:[b.toString('base64'),'base64']};}
const env={HELIUS_API_KEY:'TEST_SECRET_NOT_REAL',NEXT_PUBLIC_PLATFORM_FEE_WALLET:I.SOLANA_FEE_WALLET};
test('status revalidates initialized classic fee ATA and independently disables missing WSOL',async()=>{
 let calls=0;const result=await A.handleSolanaRequest('status',{},env,{fetchImpl:async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.deepEqual(body.map(x=>x.method),['getGenesisHash','getMultipleAccounts']);return Response.json([{id:1,result:I.SOLANA_MAINNET},{id:2,result:{value:[mintAccount(6),mintAccount(9),tokenAccount(I.SOLANA_USDC,I.SOLANA_FEE_WALLET),null]}}]);}});
 assert.equal(calls,1);assert.equal(result.status,200);assert.equal(result.data.ready,true);assert.deepEqual(result.data.outputs.map(o=>o.ready),[true,false]);
 const wrong=tokenAccount(I.SOLANA_USDC,account);assert.throws(()=>A.verifyClassicAccount(wrong,I.SOLANA_USDC,I.SOLANA_FEE_WALLET));
});
test('invalid request does not read provider bindings; bounded fixed endpoints never reflect secrets',async()=>{
 let keys=0,fetches=0;const bindings={get HELIUS_API_KEY(){keys++;return 'SECRET';}};
 const invalid=await A.handleSolanaRequest('quote',{wallet:account},bindings,{fetchImpl:async()=>{fetches++;throw Error('secret URL');}});assert.equal(invalid.status,400);assert.equal(keys,0);assert.equal(fetches,0);
 const parsed={wallet:account,inputMint:mint,outputMint:I.SOLANA_USDC,amount:'1000',slippageBps:100};
 const bad=await A.handleSolanaRequest('quote',parsed,env,{fetchImpl:async()=>{throw Error('https://secret-provider?key=TEST_SECRET_NOT_REAL');}});assert.equal(bad.status,503);assert.doesNotMatch(JSON.stringify(bad),/TEST_SECRET|https:/);
});
test('discovery pagination is capped at3 with exact onchain u64 balances and explicit partial',async()=>{
 let calls=0;const result=await A.handleSolanaRequest('discover',{wallet:account},env,{fetchImpl:async(_url,init)=>{calls++;const body=JSON.parse(init.body)[0];
 if(body.method==='getMultipleAccounts'){const exact=tokenAccount(mint,account),raw=Buffer.from(exact.data[0],'base64');raw.writeBigUInt64LE(9007199254740993n,64);exact.data[0]=raw.toString('base64');return Response.json([{id:1,result:{value:[exact]}}]);}
 assert.equal(body.method,'searchAssets');const p=body.params;assert.equal(p.ownerAddress,account);assert.equal(p.limit,100);return Response.json([{id:1,result:{items:Array.from({length:100},()=>({id:mint,ownership:{owner:account},token_info:{balance:9007199254740992,decimals:8},content:{metadata:{symbol:'TEST'}}}))}}]);}});assert.equal(calls,6);assert.equal(result.data.partial,true);assert.equal(result.data.tokens.length,1);assert.equal(result.data.tokens[0].balance,'9007199254740993');
});

test('unknown submission stops queue, survives reload and second invocation does not obtain a new quote or sign',async()=>{
 const storage=memory(),i=review(),token={mint,symbol:'TEST',decimals:8,balance:1000n},other={mint:I.SOLANA_WSOL,symbol:'WSOL',decimals:9,balance:10n};let signs=0,sends=0,reads=0;
 const conn={getGenesisHash:async()=>I.SOLANA_MAINNET,simulateTransaction:async()=>({value:{err:null}}),sendRawTransaction:async()=>{sends++;throw Error('network unknown');},confirmTransaction:async()=>{throw Error('must not happen');}};
 const read=async(op)=>{reads++;return op==='quote'?{quote:quote()}:plan();};
 const result=await E.executeBatchSwap([token],I.SOLANA_USDC,6,new PublicKey(account),conn,async tx=>{signs++;tx.sign([owner]);return tx;},100,undefined,undefined,{reviews:[i],storage,acquire:async()=>lease(),read});
 assert.equal(result.pending.phase,'unknown');assert.equal(signs,1);assert.equal(sends,1);assert.equal(result.failed[0].status,'pending');const before=reads;
 await assert.rejects(E.executeBatchSwap([token],I.SOLANA_USDC,6,new PublicKey(account),conn,async()=>{signs++;throw Error('must not happen');},100,undefined,undefined,{reviews:[i],storage,acquire:async()=>lease(),read}));assert.equal(reads,before);assert.equal(signs,1);assert.ok(P.readSolanaPending(storage,account));
});
test('known send signature remains durable if confirmation fails; actual original blockhash/expiry are used',async()=>{
 const storage=memory(),i=review(),token={mint,symbol:'TEST',decimals:8,balance:1000n};let expectedSig;
 const conn={getGenesisHash:async()=>I.SOLANA_MAINNET,simulateTransaction:async()=>({value:{err:null}}),sendRawTransaction:async bytes=>{const t=VersionedTransaction.deserialize(bytes);expectedSig=P.signatureBase58(t.signatures[0]);return expectedSig;},confirmTransaction:async context=>{assert.deepEqual(context,{signature:expectedSig,blockhash:hash,lastValidBlockHeight:500});throw Error('confirmation timeout');}};
 const result=await E.executeBatchSwap([token],I.SOLANA_USDC,6,new PublicKey(account),conn,async tx=>{tx.sign([owner]);return tx;},100,undefined,undefined,{reviews:[i],storage,acquire:async()=>lease(),read:async op=>op==='quote'?{quote:quote()}:plan()});assert.equal(result.pending.signature,expectedSig);assert.equal(P.readSolanaPending(storage,account).record.signature,expectedSig);
});
test('engine never prompts for reviewed100→fresh50 or synthetic unrelated transaction',async()=>{
 const i=review(),token={mint,symbol:'TEST',decimals:8,balance:1000n};for(const mode of ['floor','opaque']){let signs=0;
 const result=await E.executeBatchSwap([token],I.SOLANA_USDC,6,new PublicKey(account),{getGenesisHash:async()=>I.SOLANA_MAINNET},async()=>{signs++;throw Error('unexpected');},100,undefined,undefined,{reviews:[i],storage:memory(),acquire:async()=>lease(),read:async op=>op==='quote'?{quote:mode==='floor'?quote({outAmount:'5000',otherAmountThreshold:'4950'}):quote()}:{...plan(),swapInstruction:{programId:'11111111111111111111111111111111',accounts:[],data:'AAAA'}}});assert.equal(signs,0);assert.equal(result.successful.length,0);assert.equal(result.failed.length,1);}
});

test('server construct rechecks mint units, source cap, fee owner and every executable route program',async()=>{
 for(const mode of ['valid','fee','foreign-program']){let calls=0;
 const result=await A.handleSolanaRequest('construct',{intent:review(),quote:quote()},env,{now:()=>now,fetchImpl:async(url,init)=>{
   calls++;if(String(url).startsWith('https://lite-api.jup.ag/'))return Response.json({swapInstruction:instruction(),setupInstructions:[{programId:'11111111111111111111111111111111',accounts:[],data:'AAAA'}]});
   const request=JSON.parse(init.body);assert.deepEqual(request.map(r=>r.method),['getGenesisHash','getMultipleAccounts','getLatestBlockhash','getMultipleAccounts']);
   const ix=instruction(),keys=[...new Set(ix.accounts.map(a=>a.pubkey))];
   const routeAccounts=keys.map(k=>k===pool?{owner:I.SOLANA_DEX_PROGRAMS.MeteoraDlmm,executable:mode==='foreign-program',data:['','base64']}:k===I.associatedToken(account,mint)?tokenAccount(mint,account):k===I.associatedToken(account,I.SOLANA_USDC)?tokenAccount(I.SOLANA_USDC,account):k===I.associatedToken(I.SOLANA_FEE_WALLET,I.SOLANA_USDC)?tokenAccount(I.SOLANA_USDC,I.SOLANA_FEE_WALLET):{owner:'11111111111111111111111111111111',executable:[I.SPL_TOKEN,I.JUPITER_PROGRAM,I.SOLANA_DEX_PROGRAMS.MeteoraDlmm].includes(k),data:['','base64']});
   return Response.json([{id:1,result:I.SOLANA_MAINNET},{id:2,result:{value:[tokenAccount(mint,account),tokenAccount(I.SOLANA_USDC,account),tokenAccount(I.SOLANA_USDC,mode==='fee'?account:I.SOLANA_FEE_WALLET),mintAccount(8),mintAccount(6),{executable:true}]}},{id:3,result:{value:{blockhash:hash,lastValidBlockHeight:500}}},{id:4,result:{value:routeAccounts}}]);
 }});assert.equal(calls,2);assert.equal(result.status,mode==='valid'?200:422);if(mode==='valid'){const tx=I.compileSolanaPlan(result.data,review(),now);assert.equal(tx.message.compiledInstructions.length,3);}
 }
});
test('one whole8s deadline is hard even if fetch ignores abort; cancellation prevents further requests',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;const result=A.handleSolanaRequest('status',{},env,{fetchImpl:async()=>{calls++;return new Promise(()=>{});}});await Promise.resolve();t.mock.timers.tick(8001);const timed=await result;assert.equal(timed.status,503);assert.equal(timed.data.code,'SOLANA_READ_TIMEOUT');assert.equal(calls,1);t.mock.timers.reset();
 const controller=new AbortController();controller.abort();const stopped=await A.handleSolanaRequest('status',{},env,{signal:controller.signal,fetchImpl:async()=>{calls++;throw Error('must not fetch');}});assert.equal(stopped.status,503);assert.equal(calls,1);
});
test('missing fee configuration,429 and oversized upstream response remain safe and do not retry',async()=>{
 let calls=0;const missing=await A.handleSolanaRequest('status',{}, {HELIUS_API_KEY:'NOT_REAL'},{fetchImpl:async()=>{calls++;throw Error('must not fetch');}});assert.equal(missing.status,503);assert.equal(calls,0);
 const req={wallet:account,inputMint:mint,outputMint:I.SOLANA_USDC,amount:'1000',slippageBps:100};
 const limited=await A.handleSolanaRequest('quote',req,env,{fetchImpl:async()=>{calls++;return new Response('secret provider body',{status:429});}});assert.equal(limited.status,429);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(limited),/secret provider/);
 const large=await A.handleSolanaRequest('quote',req,env,{fetchImpl:async()=>{calls++;return new Response('x'.repeat(192001));}});assert.equal(large.status,503);assert.equal(calls,2);
});
test('hashless wallet rejection remains a durable hold and stops all later wallet requests',async()=>{
 const storage=memory(),i=review(),token={mint,symbol:'TEST',decimals:8,balance:1000n};let signs=0;
 const result=await E.executeBatchSwap([token],I.SOLANA_USDC,6,new PublicKey(account),{getGenesisHash:async()=>I.SOLANA_MAINNET,simulateTransaction:async()=>({value:{err:null}})},async()=>{signs++;throw Error('wallet response lost');},100,undefined,undefined,{reviews:[i],storage,acquire:async()=>lease(),read:async op=>op==='quote'?{quote:quote()}:plan()});assert.equal(signs,1);assert.equal(result.pending.signature,undefined);assert.equal(P.readSolanaPending(storage,account).record.phase,'unknown');
});

test('authentic public V1 Whirlpool response binds unchanged provider bytes and conservatively tightens ceil floor',async()=>{
 const captured=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/public-jupiter-unsigned.json',import.meta.url),'utf8'));
 const state=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/public-account-proofs.json',import.meta.url),'utf8'));
 const at=Date.parse(captured.at),q={...captured.quote,quotedAt:at};assert.equal(I.SOLANA_MAINNET,state.genesisHash);
 const i=I.createSolanaReview(captured.wallet,q,6,6,false,at),ix=captured.instructions.swapInstruction;
 const original=Buffer.from(ix.data,'base64');assert.equal(I.validateJupiterRoute(ix,i,q,I.SOLANA_FEE_WALLET,at).data,ix.data);
 const tx=I.compileSolanaPlan({network:state.genesisHash,account:captured.wallet,feeWallet:I.SOLANA_FEE_WALLET,quote:q,swapInstruction:ix,accountProofs:state.proofs,blockhash:state.blockhash.value.blockhash,lastValidBlockHeight:state.blockhash.value.lastValidBlockHeight,constructedAt:at,createOutputAta:false},i,at);
 const executable=Buffer.from(tx.message.compiledInstructions.at(-1).data);assert.equal(original.length,36);
 // Whirlpool's one boolean route field shifts quotedOutAmount to25. Only that decoded u64 may tighten.
 for(let offset=0;offset<original.length;offset++)if(offset<25||offset>=33)assert.equal(executable[offset],original[offset]);
 assert.equal(original.readBigUInt64LE(25),BigInt(q.outAmount));assert(executable.readBigUInt64LE(25)>=original.readBigUInt64LE(25));assert(executable.readBigUInt64LE(25)*9900n/10000n>=BigInt(i.minimumOut));
 assert.equal(i.minimumOut,'988791');assert.equal(captured.quote.otherAmountThreshold,'988791');assert.equal(Number(q.priceImpactPct)*100,i.reviewedImpact);
});
test('pure construct validation rejects stale reviews and impossible minima before any environment access',async()=>{
 const stale={...review(),reviewedAt:now-601_000},impossible={...review(),minimumOut:'10001'};let reads=0;
 for(const intent of [stale,impossible]){assert.equal(A.parseSolanaRequest('construct',{intent,quote:quote()}),null);const result=await A.handleSolanaRequest('construct',{intent,quote:quote()},{get HELIUS_API_KEY(){reads++;throw Error('must not read');}});assert.equal(result.status,400);}
 assert.equal(reads,0);
});

test('explicit signer rejection clears only its unsigned marker and stops the remaining queue',async()=>{
 const token={mint,symbol:'TEST',decimals:8,balance:1000n},later={mint:I.SOLANA_WSOL,symbol:'WSOL',decimals:9,balance:10n};
 const laterQuote=quote({inputMint:I.SOLANA_WSOL,inAmount:'10',routePlan:[{percent:100,swapInfo:{inputMint:I.SOLANA_WSOL,outputMint:I.SOLANA_USDC,inAmount:'10',ammKey:pool}}]});
 const laterReview=I.createSolanaReview(account,laterQuote,9,6,false,now);
 for(const error of [{code:4001},{name:'UserRejectedRequestError'},{name:'WalletSignTransactionError',error:{code:4001}}]){
  const storage=memory();let signs=0,sends=0,reads=0;
  const result=await E.executeBatchSwap([token,later],I.SOLANA_USDC,6,new PublicKey(account),{getGenesisHash:async()=>I.SOLANA_MAINNET,simulateTransaction:async()=>({value:{err:null}}),sendRawTransaction:async()=>{sends++;throw Error('must not send');}},async()=>{signs++;throw error;},100,undefined,undefined,{reviews:[review(),laterReview],storage,acquire:async()=>lease(),read:async op=>{reads++;return op==='quote'?{quote:quote()}:plan();}});
  assert.equal(signs,1);assert.equal(sends,0);assert.equal(reads,2);assert.equal(result.pending,undefined);assert.equal(result.failed.length,2);assert(result.failed.every(r=>r.status==='skipped'));assert.equal(P.readSolanaPending(storage,account),null);
  assert.equal((await E.recoverSolanaPending(account,{storage,acquire:async()=>lease(),read:async()=>{throw Error('nothing to reconcile');}})).state,'none');
 }
});
test('a4001 after signing or after send never clears the original signed bytes',async()=>{
 for(const mode of ['mutated-before-rejection','send-error']){
  const storage=memory(),token={mint,symbol:'TEST',decimals:8,balance:1000n};let sends=0;
  const result=await E.executeBatchSwap([token],I.SOLANA_USDC,6,new PublicKey(account),{getGenesisHash:async()=>I.SOLANA_MAINNET,simulateTransaction:async()=>({value:{err:null}}),sendRawTransaction:async()=>{sends++;throw {code:4001};}},async tx=>{tx.sign([owner]);if(mode==='mutated-before-rejection')throw {code:4001};return tx;},100,undefined,undefined,{reviews:[review()],storage,acquire:async()=>lease(),read:async op=>op==='quote'?{quote:quote()}:plan()});
  assert.equal(sends,mode==='send-error'?1:0);assert.equal(result.failed[0].status,'pending');const saved=P.readSolanaPending(storage,account).record;assert(saved.signature);assert(saved.signedWire);assert.equal(saved.signature,result.pending.signature);
 }
});
test('ambiguous signer text and foreign or uncleared storage keep the pending gate',async()=>{
 for(const mode of ['ambiguous-text','foreign-owner','clear-failed']){
  const storage=memory(),token={mint,symbol:'TEST',decimals:8,balance:1000n};let foreign;
  if(mode==='clear-failed')storage.removeItem=()=>{throw Error('storage unavailable');};
  const result=await E.executeBatchSwap([token],I.SOLANA_USDC,6,new PublicKey(account),{getGenesisHash:async()=>I.SOLANA_MAINNET,simulateTransaction:async()=>({value:{err:null}})},async()=>{
   if(mode==='foreign-owner'){const p=P.readSolanaPending(storage,account).record;foreign=JSON.stringify({...p,journalId:'ffffffff-ffff-4fff-8fff-ffffffffffff'});storage.setItem(P.solanaPendingKey(account),foreign);}
   if(mode==='ambiguous-text')throw Error('User rejected the request');throw {code:4001};
  },100,undefined,undefined,{reviews:[review()],storage,acquire:async()=>lease(),read:async op=>op==='quote'?{quote:quote()}:plan()});
  assert.equal(result.failed[0].status,'pending');assert(P.readSolanaPending(storage,account));if(foreign)assert.equal(storage.getItem(P.solanaPendingKey(account)),foreign);
 }
});
