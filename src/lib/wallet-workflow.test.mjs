import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireWalletWorkflow,createOwnedJournal,walletWorkflowKey} from './wallet-workflow.ts';
import {pendingTransactionKind} from './sweep-guards.ts';

class Locks {
  held = new Set();
  async request(name,options,callback) {
    assert.equal(options.mode,'exclusive');assert.equal(options.ifAvailable,true);
    if(this.held.has(name))return callback(null);
    this.held.add(name);
    try{return await callback({name,mode:'exclusive'});}finally{this.held.delete(name);}
  }
}
const id=n=>'00000000-0000-4000-8000-'+n.toString().padStart(12,'0');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const store=()=>{const data=new Map();return{data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const scope=walletWorkflowKey('0x1111111111111111111111111111111111111111',8453);

test('one shared native lock excludes another tab throughout the workflow without queueing an old trade',async()=>{
  const locks=new Locks(),a=await acquireWalletWorkflow(scope,{locks,id:()=>id(1)});
  let competingStarted=false;
  await assert.rejects(async()=>{const b=await acquireWalletWorkflow(scope,{locks,id:()=>id(2)});competingStarted=true;b.release();},/Another tab/);
  assert.equal(competingStarted,false);a.assertActive();a.release();await turn();
  const c=await acquireWalletWorkflow(scope,{locks,id:()=>id(3)});c.assertActive();c.release();await turn();assert.equal(locks.held.size,0);
});

test('wallet scope canonicalizes EVM checksums while preserving Solana case and network isolation',async()=>{
  assert.equal(walletWorkflowKey('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',8453),walletWorkflowKey('0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD',8453));
  assert.notEqual(walletWorkflowKey('SolanaKeyABC','solana-mainnet'),walletWorkflowKey('SolanaKeyAbC','solana-mainnet'));
  const locks=new Locks(),a=await acquireWalletWorkflow(scope,{locks,id:()=>id(1)}),b=await acquireWalletWorkflow(walletWorkflowKey('0x1111111111111111111111111111111111111111',1),{locks,id:()=>id(2)});
  a.release();b.release();await turn();
});

test('missing coordination or malformed ownership fails before journal or wallet work',async()=>{
  await assert.rejects(acquireWalletWorkflow(scope,{locks:{},id:()=>id(1)}),/cannot safely coordinate/);
  await assert.rejects(acquireWalletWorkflow(scope,{locks:new Locks(),id:()=>''}),/Secure wallet coordination/);
});

test('owned markers keep one immutable id through updates and clear only that exact snapshot',async()=>{
  const storage=store(),notifications=[],lease=await acquireWalletWorkflow(scope,{locks:new Locks(),id:()=>id(1)});
  const journal=createOwnedJournal({lease,storage,key:'pending',id:()=>id(2),notify:p=>notifications.push(p)});
  const record=journal.begin({version:1,label:'Approve token'});assert.equal(record.journalId,id(2));
  const updated={...record,hash:'0x'+'a'.repeat(64)};journal.update(updated);assert.equal(JSON.parse(storage.getItem('pending')).journalId,id(2));
  assert.throws(()=>journal.update({...updated,journalId:id(3)}),/ownership/);
  assert.equal(JSON.parse(storage.getItem('pending')).hash,updated.hash);
  journal.clear();assert.equal(storage.getItem('pending'),null);assert.equal(notifications.length,3);lease.release();await turn();
});

test('another tab marker cannot be erased by the first request rejection, hash update or final clear',async()=>{
  const storage=store(),lease=await acquireWalletWorkflow(scope,{locks:new Locks(),id:()=>id(1)});
  const journal=createOwnedJournal({lease,storage,key:'pending',id:()=>id(2)}),a=journal.begin({version:1,label:'A'});
  const b=JSON.stringify({version:1,journalId:id(3),label:'B',hash:'0x'+'b'.repeat(64)});storage.setItem('pending',b);
  assert.throws(()=>journal.clear(),/changed in another tab/);
  assert.throws(()=>journal.update({...a,hash:'0x'+'a'.repeat(64)}),/changed in another tab/);
  assert.equal(storage.getItem('pending'),b);lease.release();await turn();
});

test('a cleared or changed marker and a released workflow never authorize a later mutation',async()=>{
  const storage=store(),lease=await acquireWalletWorkflow(scope,{locks:new Locks(),id:()=>id(1)});
  const journal=createOwnedJournal({lease,storage,key:'pending',id:()=>id(2)}),record=journal.begin({label:'request'});
  storage.removeItem('pending');assert.throws(()=>journal.update(record),/changed in another tab/);
  lease.release();await turn();assert.throws(()=>journal.clear(),/workflow ownership changed/);
});

test('legacy pending recovery can acquire ownership only from its exact existing snapshot',async()=>{
  const storage=store(),lease=await acquireWalletWorkflow(scope,{locks:new Locks(),id:()=>id(1)}),old={version:1,label:'legacy',hash:'0x'+'a'.repeat(64)},raw=JSON.stringify(old);storage.setItem('pending',raw);
  const stale=createOwnedJournal({lease,storage,key:'pending',id:()=>id(2)});assert.throws(()=>stale.begin({...old,label:'different'},raw),/saved wallet request changed/);assert.equal(storage.getItem('pending'),raw);
  const current=createOwnedJournal({lease,storage,key:'pending',id:()=>id(3)}),owned=current.begin(old,raw);assert.equal(owned.journalId,id(3));current.clear();lease.release();await turn();
});

test('a public nonce baseline never proves replacement while an actually proven original nonce does',()=>{
  const account='0x1111111111111111111111111111111111111111',target='0x2222222222222222222222222222222222222222';
  const record={version:1,account,chainId:8453,target,data:'0x12345678',value:'0',nonce:17,createdAt:1,label:'request'};
  const cancellation={from:account,to:account,input:'0x',value:0n,nonce:17};
  assert.throws(()=>pendingTransactionKind(record,cancellation),/Original nonce has not been proven/);
  assert.throws(()=>pendingTransactionKind({...record,nonceVerified:false},cancellation),/Original nonce has not been proven/);
  assert.equal(pendingTransactionKind({...record,nonceVerified:true},cancellation),'replacement');
  assert.throws(()=>pendingTransactionKind({...record,nonce:18,nonceVerified:true},cancellation),/nonce does not match/);
});
