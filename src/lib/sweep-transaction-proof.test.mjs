import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// Keep the production TypeScript import compatible with Next's bundler while
// running the actual helper + existing matchesPending in memory under Node.
// No generated app files, network, storage, wallet or provider calls.
const output=await build({entryPoints:[fileURLToPath(new URL('./sweep-transaction-proof.ts',import.meta.url))],
  bundle:true,write:false,platform:'node',format:'esm',target:'es2020',logLevel:'silent'});
const {bindSubmittedTransaction,bindSubmittedWalletRequest,SubmittedTransactionMismatchError}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const account='0x'+'ab'.repeat(20),target='0x'+'cd'.repeat(20),other='0x'+'ef'.repeat(20);
const anchor='0x'+'a1'.repeat(32),replacement='0x'+'b2'.repeat(32),data='0xaabbccdd'+'0'.repeat(64);
const record=()=>({version:1,account,chainId:8453,target,data,value:'0',hash:anchor,nonce:7,createdBlock:'100',createdAt:1,label:'Approve synthetic token'});
const transaction=()=>({hash:anchor,from:account,to:target,input:data,value:0n,nonce:8,chainId:8453});
const upper=value=>'0x'+value.slice(2).toUpperCase();

function held(p,tx,field,expected){
  assert.throws(()=>bindSubmittedTransaction(p,tx,expected),error=>{
    assert(error instanceof SubmittedTransactionMismatchError);assert.equal(error.stopQueue,true);assert(error.fields.includes(field));
    assert(error.message.includes(field));assert(!error.message.includes(data));assert(!error.message.includes(account));assert(!error.message.includes(target));
    if(p.originalHash??p.hash)assert.equal(error.anchorHash,(p.originalHash??p.hash).toLowerCase());
    return true;
  });
}

test('wallet-observed nonce may differ from the public pre-read only after exact original-hash/full-intent proof',()=>{
  const p=Object.freeze(record()),tx=Object.freeze(transaction()),bound=bindSubmittedTransaction(p,tx);
  assert.notEqual(bound,p);assert.equal(bound.nonce,8);assert.equal(bound.nonceBaseline,7);assert.equal(bound.nonceVerified,true);
  assert.equal(p.nonce,7);assert.equal(p.nonceVerified,undefined);assert.equal(bound.hash,anchor);assert.equal(bound.data,data);
  assert.equal(bound.createdBlock,p.createdBlock);assert.equal(bound.label,p.label);
});

test('changed hash, sender, target, full bytes, value or provided chain always holds without leaking raw payload',()=>{
  for(const [change,field] of [[{hash:replacement},'hash'],[{from:other},'sender'],[{to:other},'target'],[{to:null},'target'],
    [{input:data+'deadbeef'},'calldata'],[{input:data.slice(0,-2)+'01'},'calldata'],[{input:data.slice(0,-2)},'calldata'],
    [{value:1n},'value'],[{value:'0'},'value'],[{chainId:1},'chain'],[{chainId:null},'chain']])held(record(),{...transaction(),...change},field);
  held({...record(),value:'1'},transaction(),'value');
});

test('transaction hash, full bytes and address syntax are strict, including safe errors for malformed inputs',()=>{
  for(const hash of [undefined,null,'0x1234','0x'+'g'.repeat(64)])held(record(),{...transaction(),hash},'hash');
  for(const input of [null,undefined,'0x1','not-hex'])held(record(),{...transaction(),input},'calldata');
  for(const from of [null,undefined,'not-address'])held(record(),{...transaction(),from},'sender');
  held({...record(),chainId:0},transaction(),'chain');
});

test('case normalization accepts identical hex addresses/hash/calldata, and absent transaction chainId is supported',()=>{
  const tx={...transaction(),hash:upper(anchor),from:upper(account),to:upper(target),input:upper(data)};
  const p={...record(),hash:upper(anchor)};
  assert.equal(bindSubmittedTransaction(p,tx,anchor).nonce,8);
  delete tx.chainId;assert.equal(bindSubmittedTransaction(record(),tx).nonceVerified,true);
});

test('a hashless marker cannot be blindly bound even by passing an explicit pasted hash',()=>{
  const p=record();delete p.hash;
  for(const expected of [undefined,anchor])assert.throws(()=>bindSubmittedTransaction(p,transaction(),expected),error=>{
    assert.equal(error.stopQueue,true);assert(error.fields.includes('hash'));assert.equal(error.anchorHash,undefined);return true;
  });
  held(record(),transaction(),'hash',replacement);
});

test('legacy version1 records with a saved original hash bind without a pre-read nonce',()=>{
  const p=record();delete p.nonce;const bound=bindSubmittedTransaction(p,transaction());
  assert.equal(bound.version,1);assert.equal(bound.nonce,8);assert.equal(bound.nonceVerified,true);assert.equal(bound.nonceBaseline,undefined);
  assert.equal(p.nonce,undefined);assert.equal(p.nonceVerified,undefined);
});

test('replacement records bind only their original anchor, never the replacement hash',()=>{
  const p={...record(),originalHash:anchor,hash:replacement};assert.equal(bindSubmittedTransaction(p,transaction()).nonce,8);
  held(p,{...transaction(),hash:replacement},'hash');held(p,{...transaction(),hash:replacement},'hash',replacement);
});

test('already verified original nonce and its baseline are immutable on repeat proofs',()=>{
  const first=bindSubmittedTransaction(record(),transaction());const again=bindSubmittedTransaction(first,transaction());
  assert.equal(again.nonce,8);assert.equal(again.nonceBaseline,7);assert.equal(again.nonceVerified,true);
  held(first,{...transaction(),nonce:9},'nonce');assert.equal(first.nonce,8);assert.equal(first.nonceBaseline,7);
  const zero=bindSubmittedTransaction({...record(),nonce:0},transaction());assert.equal(bindSubmittedTransaction(zero,transaction()).nonceBaseline,0);
  held({...record(),nonceVerified:true,nonce:undefined},transaction(),'nonce');
});

test('invalid observed or persisted nonce/proof values always hold',()=>{
  for(const nonce of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'8',undefined,null])held(record(),{...transaction(),nonce},'nonce');
  for(const nonce of [-1,NaN,'7'])held({...record(),nonce},transaction(),'nonce');
  held({...record(),nonceBaseline:-1},transaction(),'nonce');held({...record(),nonceVerified:'true'},transaction(),'nonce');
  assert.equal(bindSubmittedTransaction(record(),{...transaction(),nonce:0}).nonce,0);
});

const approve=(spender,amount)=>'0x095ea7b3'+spender.slice(2).toLowerCase().padStart(64,'0')+BigInt(amount).toString(16).padStart(64,'0');
// Public fields copied from local stocks/USER_APPROVAL_PROOF.json and balance
// comparison. The fixture review amount uses that comparison's reported balance;
// nonce is held equal to observed1536 to isolate the proven approval edit.
const chz={hash:'0xcb0407dc9a538c84f2ad40cf4146aae5eb3fe3f75bac7ed42c12909c095fdee2',
  account:'0xe6e7d3c6379ad80de02f26ccc72605d0f70d5201',token:'0x70c8392de9b39a1e48d12a70af6ff4be25d6d0a2',
  spender:'0x0fef9e88a7b76bcdbf451780c6774fe32965ee98',reviewed:'354414190489621235064',observed:'9007199254740991000000000000000000',
  input:'0x095ea7b30000000000000000000000000fef9e88a7b76bcdbf451780c6774fe32965ee98000000000000000000000000000000000001bc16d674ec7ff21f494c589c0000'};
const approvalRecord=()=>({...record(),account:chz.account,target:chz.token,hash:chz.hash,nonce:1536,label:'Approve CHZ',data:approve(chz.spender,chz.reviewed)});
const approvalTx=()=>({...transaction(),hash:chz.hash,from:chz.account,to:chz.token,nonce:1536,input:chz.input});
function approvalHeld(p,tx,field='calldata',expected){
  assert.throws(()=>bindSubmittedWalletRequest(p,tx,expected),error=>{
    assert.equal(error.stopQueue,true);assert(error.fields.includes(field));assert.equal(error.anchorHash,(p.originalHash??p.hash)?.toLowerCase());
    assert(!error.message.includes(chz.input));assert(!error.message.includes(approve(chz.spender,chz.reviewed)));return true;
  });
}

test('observed CHZ wallet approval increase is recognized only in approval role and preserves reviewed bytes',()=>{
  assert.equal(approve(chz.spender,chz.observed),chz.input);
  const p=Object.freeze(approvalRecord()),tx=Object.freeze(approvalTx());
  assert.throws(()=>bindSubmittedTransaction(p,tx),e=>e.fields.includes('calldata'));
  const bound=bindSubmittedWalletRequest(p,tx);
  assert.deepEqual(bound.approvalProof,{spender:chz.spender,reviewedAmount:chz.reviewed,observedAmount:chz.observed});
  assert.equal(bound.data,p.data);assert.notEqual(bound.data,tx.input);assert.equal(p.data,approve(chz.spender,chz.reviewed));
  assert.equal(bound.nonce,1536);assert.equal(bound.nonceBaseline,1536);assert.equal(bound.nonceVerified,true);
  for(const label of ['Sweep batch 1','ApproveCHZ','Approver CHZ','approve CHZ','ResetCHZ'])approvalHeld({...p,label},tx);
});

test('positive approvals permit exact or increased amounts, while reduced approval amounts always hold',()=>{
  const p={...approvalRecord(),data:approve(chz.spender,42n)};
  for(const amount of [42n,43n,2n**256n-1n])assert.equal(bindSubmittedWalletRequest(p,{...approvalTx(),input:approve(chz.spender,amount)}).approvalProof.observedAmount,amount.toString());
  for(const amount of [0n,41n])approvalHeld(p,{...approvalTx(),input:approve(chz.spender,amount)});
});

test('zero/reset approvals must remain zero and yield a fresh zero-valued proof',()=>{
  const p={...approvalRecord(),label:'Reset CHZ approval',data:approve(chz.spender,0n)};
  const bound=bindSubmittedWalletRequest(p,{...approvalTx(),input:p.data});
  assert.deepEqual(bound.approvalProof,{spender:chz.spender,reviewedAmount:'0',observedAmount:'0'});
  for(const amount of [1n,BigInt(chz.observed)])approvalHeld(p,{...approvalTx(),input:approve(chz.spender,amount)});
});

test('approval spender, token, function, length, suffix, wrapper and noncanonical padding changes always hold',()=>{
  const p=approvalRecord(),tx=approvalTx();
  for(const input of [approve(other,chz.observed),'0xa9059cbb'+tx.input.slice(10),tx.input.slice(0,-2),tx.input+'00',
    '0x12345678'+tx.input.slice(2),'0x095ea7b3'+'01'+tx.input.slice(12)])approvalHeld(p,{...tx,input});
  approvalHeld(p,{...tx,to:other},'target');
  for(const invalid of [tx.input+'00','0xa9059cbb'+tx.input.slice(10)])approvalHeld({...p,data:invalid},{...tx,input:invalid});
});

test('semantic approval path retains original hash, sender, native value, chain and verified-nonce proof',()=>{
  const p=approvalRecord(),tx=approvalTx();
  for(const [change,field] of [[{hash:replacement},'hash'],[{from:other},'sender'],[{value:1n},'value'],[{chainId:1},'chain'],[{nonce:-1},'nonce']])approvalHeld(p,{...tx,...change},field);
  const bound=bindSubmittedWalletRequest(p,tx);approvalHeld(bound,{...tx,nonce:1537},'nonce');
  const noHash={...p};delete noHash.hash;approvalHeld(noHash,tx,'hash',chz.hash);
  const mixed={...tx,input:upper(tx.input),from:upper(tx.from),to:upper(tx.to),hash:upper(tx.hash)};
  assert.deepEqual(bindSubmittedWalletRequest(p,mixed).approvalProof,bound.approvalProof);
});

test('stored approvalProof is discarded; fresh proof never changes strict swap identity',()=>{
  const stale={spender:other,reviewedAmount:'0',observedAmount:'1'};
  const bound=bindSubmittedWalletRequest({...approvalRecord(),approvalProof:stale},approvalTx());
  assert.equal(bound.approvalProof.spender,chz.spender);assert.equal(bound.approvalProof.reviewedAmount,chz.reviewed);
  const swap={...record(),label:'Sweep batch 1',approvalProof:stale};
  const exact={...transaction(),input:swap.data};const strict=bindSubmittedWalletRequest(swap,exact);
  assert.equal(strict.data,swap.data);assert.equal(strict.approvalProof,undefined);
  for(const input of [swap.data+'00',swap.data.slice(0,-2)+'01'])approvalHeld(swap,{...exact,input});
});
