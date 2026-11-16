import test from 'node:test';
import assert from 'node:assert/strict';
import {exactAmount,minimumOutput,preserveMinimum,bind0xQuote,pendingKey,validatePending,matchesPending,isWalletRejection,isProvenNotSubmitted,pendingTransactionKind,mapBounded} from './sweep-guards.ts';
const account='0x1111111111111111111111111111111111111111',token='0x2222222222222222222222222222222222222222',out='0x3333333333333333333333333333333333333333',target='0x4444444444444444444444444444444444444444';
test('stock raw units and strict reviewed caps never fall back to full balance',()=>{
 assert.equal(exactAmount('0.001',3465726n,8,true),100000n);
 assert.equal(exactAmount('',3465726n,8,true),3465726n);
 for(const v of ['1e-3','-1','0','0.000000001','1','NaN','1,000','0x10'])assert.throws(()=>exactAmount(v,3465726n,8,true));
 assert.throws(()=>exactAmount('',3465726n,0,false));
 assert.throws(()=>exactAmount('',3465726n,37,true));
});
test('a refresh cannot lower the accepted minimum',()=>{
 const min=minimumOutput(1_000_000n);assert.equal(min,995000n);
 assert.equal(preserveMinimum(min,996000n),min);
 assert.throws(()=>preserveMinimum(min,994999n));
});
const expected={sellToken:token,buyToken:out,amount:12n,taker:account,target};
const good={sellToken:token,buyToken:out,sellAmount:'12',buyAmount:'100',minBuyAmount:'99',taker:account,transaction:{to:target,data:'0x12345678',value:'0'}};
test('0x quote binds exact tokens/raw amount/spender/zero value',()=>{
 assert.equal(bind0xQuote(good,expected).buyAmount,100n);
 for(const change of [{sellToken:out},{buyToken:token},{sellAmount:'13'},{buyAmount:'0'},{minBuyAmount:undefined},{minBuyAmount:'1'},{minBuyAmount:'101'},{taker:target},{liquidityAvailable:false},{issues:{allowance:{spender:out}}},{transaction:{...good.transaction,value:'1'}},{transaction:{...good.transaction,to:token}},{transaction:{...good.transaction,data:'0x123'}}])assert.throws(()=>bind0xQuote({...good,...change},expected));
});
test('pending records are wallet/chain and calldata bound across refresh',()=>{
 const p={version:1,account,chainId:8453,target,data:'0x12345678',value:'0',createdAt:1,label:'Sweep',hash:'0x'+'a'.repeat(64)};
 assert.equal(pendingKey(account,8453),pendingKey(account.toUpperCase().replace('0X','0x'),8453));
 assert.deepEqual(validatePending(p,account,8453),p);
 assert.equal(validatePending(p,token,8453),null);assert.equal(validatePending(p,account,1),null);
 const tx={from:account,to:target,input:p.data,value:0n};assert.equal(matchesPending(p,tx),true);
 for(const change of [{from:token},{to:out},{input:'0x87654321'},{value:1n}])assert.equal(matchesPending(p,{...tx,...change}),false);
 assert.equal(isWalletRejection({cause:{code:4001}}),true);assert.equal(isWalletRejection({code:-32000}),false);
});
test('bounded fanout preserves order without serial batch sleeps',async()=>{
 let active=0,peak=0;
 const output=await mapBounded([1,2,3,4,5,6,7],3,async n=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return n*2;});
 assert.deepEqual(output,[2,4,6,8,10,12,14]);assert.equal(peak,3);
});

test('proven pre-broadcast failures release only their unsent marker',()=>{
 for(const name of ['ConnectorNotConnectedError','ConnectorAccountNotFoundError','ChainMismatchError','InsufficientFundsError'])assert.equal(isProvenNotSubmitted({cause:{name}}),true);
 for(const name of ['TransactionReceiptNotFoundError','TimeoutError','HttpRequestError','NonceTooLowError','TransactionExecutionError'])assert.equal(isProvenNotSubmitted({name}),false);
 assert.equal(isProvenNotSubmitted({code:-32000,message:'network error'}),false);
});

test('repricing and cancellation require the proven original sender and nonce',()=>{
 const p={version:1,account,chainId:8453,target,data:'0x12345678',value:'0',nonce:22,nonceVerified:true,createdAt:1,label:'Sweep'};
 const tx={from:account,to:target,input:p.data,value:0n,nonce:22};
 assert.equal(pendingTransactionKind(p,tx),'intent');
 assert.equal(pendingTransactionKind(p,{...tx,to:account,input:'0x'}),'replacement');
 assert.throws(()=>pendingTransactionKind(p,{...tx,nonce:23}));
 assert.throws(()=>pendingTransactionKind(p,{...tx,from:token}));
 assert.throws(()=>pendingTransactionKind({...p,nonce:undefined},{...tx,to:account,input:'0x'}));
 assert.throws(()=>pendingTransactionKind({...p,nonce:undefined},tx));
});

test('a global read failure stops new work and waits for in-flight reads',async()=>{
 const started=[],settled=[];
 const error=new Error('RPC rate limited');
 await assert.rejects(mapBounded([0,1,2,3,4,5,6],3,async n=>{
  started.push(n);await new Promise(r=>setTimeout(r,n===0?1:12));settled.push(n);if(n===0)throw error;return n;
 }),e=>e===error);
 assert.deepEqual(started,[0,1,2]);assert.deepEqual(settled.sort(),[0,1,2]);
});
