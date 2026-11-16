import {VersionedTransaction, VersionedMessage} from '@solana/web3.js';
import {SOLANA_MAINNET, associatedToken, base64Bytes, object, rawU64, sameBytes, solanaAddress, toBase64, type SolanaReviewedIntent} from './solana-intent';
import {createOwnedJournal, type JournalStorage, type WalletWorkflowLease} from './wallet-workflow';

export type SolanaPending = {
  version:1; journalId?:string; network:typeof SOLANA_MAINNET; account:string; phase:'signing'|'signed'|'submitted'|'unknown';
  intent:SolanaReviewedIntent; unsignedMessage:string; blockhash:string; lastValidBlockHeight:number;
  signedWire?:string; signature?:string; createdAt:number;
};
export const solanaPendingKey=(account:string)=>`iaero.sweeper.solana.pending.v1.${SOLANA_MAINNET}.${solanaAddress(account)}`;
const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function signatureBase58(bytes:Uint8Array):string {
  if(bytes.length!==64||bytes.every(v=>v===0))throw new Error('Wallet did not return a transaction signature');
  let n=0n;for(const byte of bytes)n=(n<<8n)+BigInt(byte);let s='';while(n>0){s=ALPHABET[Number(n%58n)]+s;n/=58n;}for(const byte of bytes){if(byte!==0)break;s='1'+s;}return s;
}
export function readSolanaPending(storage:JournalStorage,account:string):{raw:string;record:SolanaPending}|null {
  const raw=storage.getItem(solanaPendingKey(account));if(raw===null)return null;
  if(raw.length>16_000)throw new Error('Saved Solana request is invalid. Keep it for manual reconciliation.');
  let p:any;try{p=JSON.parse(raw);}catch{throw new Error('Saved Solana request is invalid. Keep it for manual reconciliation.');}
  if(!object(p)||p.version!==1||p.network!==SOLANA_MAINNET||p.account!==account||p.intent?.account!==account||p.intent?.network!==SOLANA_MAINNET
    ||!['signing','signed','submitted','unknown'].includes(p.phase)||!Number.isSafeInteger(p.lastValidBlockHeight)||p.lastValidBlockHeight<1||!Number.isSafeInteger(p.createdAt))throw new Error('Saved Solana request has an invalid owner or context. Do not retry.');
  solanaAddress(p.blockhash);base64Bytes(p.unsignedMessage,1232);
  const message=VersionedMessage.deserialize(base64Bytes(p.unsignedMessage,1232));
  if(message.staticAccountKeys[0]?.toBase58()!==account||message.header.numRequiredSignatures!==1||message.recentBlockhash!==p.blockhash||message.addressTableLookups.length)throw new Error('Saved transaction wallet or blockhash differs. Do not retry.');
  if(p.signedWire){const tx=VersionedTransaction.deserialize(base64Bytes(p.signedWire));if(toBase64(tx.message.serialize())!==p.unsignedMessage||signatureBase58(tx.signatures[0])!==p.signature||tx.message.recentBlockhash!==p.blockhash)throw new Error('Saved signed transaction differs from its original request. Do not retry.');}
  else if(p.signature)throw new Error('Saved Solana signature has no original signed bytes. Do not retry.');
  return {raw,record:p as SolanaPending};
}
export function beginSolanaPending(storage:JournalStorage,lease:WalletWorkflowLease,intent:SolanaReviewedIntent,tx:VersionedTransaction,lastValidBlockHeight:number,notify?:(p:SolanaPending|null)=>void){
  const journal=createOwnedJournal<SolanaPending>({storage,lease,key:solanaPendingKey(intent.account),notify});
  let record=journal.begin({version:1,network:SOLANA_MAINNET,account:intent.account,phase:'signing',intent, unsignedMessage:toBase64(tx.message.serialize()),blockhash:tx.message.recentBlockhash,lastValidBlockHeight,createdAt:Date.now()});
  return {get record(){return record;},assertCurrent:journal.assertCurrent,
    signed(signed:VersionedTransaction){journal.assertCurrent();if(toBase64(signed.message.serialize())!==record.unsignedMessage||signed.signatures.length!==1)throw new Error('Wallet transaction differs from the reviewed instruction plan.');
      record={...record,phase:'signed',signedWire:toBase64(signed.serialize()),signature:signatureBase58(signed.signatures[0])};journal.update(record);return record;},
    submitted(returned:string){journal.assertCurrent();if(returned!==record.signature)throw new Error('RPC returned a different transaction signature. Original request remains pending.');record={...record,phase:'submitted'};journal.update(record);},
    unknown(){record={...record,phase:'unknown'};journal.update(record);},
    clear:journal.clear,
  };
}
export type SolanaReconciliation = {state:'pending'|'expired-unresolved'|'confirmed'|'failed';outputAmount?:string;signature?:string;slot?:number};
export function validateSolanaReconciliation(p:SolanaPending,value:unknown):SolanaReconciliation {
  if(!object(value)||value.network!==SOLANA_MAINNET||!Number.isSafeInteger(value.finalizedHeight)||typeof value.blockhashValid!=='boolean')throw new Error('Original transaction status is unavailable. Do not retry.');
  if(!p.signedWire||!p.signature)return {state:'pending'};
  if(value.transaction===null){
    // Even an expired blockhash does not prove an unsigned/unknown wallet response was never submitted.
    // Do not auto-clear an absent transaction or start a new attempt. This is an explicit manual hold.
    return {state:value.finalizedHeight>p.lastValidBlockHeight&&!value.blockhashValid?'expired-unresolved':'pending',signature:p.signature};
  }
  const t=value.transaction;if(!object(t)||!Number.isSafeInteger(t.slot)||t.slot<1||t.wire!==p.signedWire)throw new Error('Canonical transaction differs from the saved signed bytes. Keep the request pending.');
  const tx=VersionedTransaction.deserialize(base64Bytes(t.wire));if(signatureBase58(tx.signatures[0])!==p.signature||toBase64(tx.message.serialize())!==p.unsignedMessage)throw new Error('Canonical transaction identity differs.');
  if(t.err!==null)return {state:'failed',signature:p.signature,slot:t.slot};
  const keys=tx.message.staticAccountKeys.map(k=>k.toBase58()),source=associatedToken(p.account,p.intent.inputMint),dest=associatedToken(p.account,p.intent.outputMint);
  if(!Array.isArray(t.preTokenBalances)||!Array.isArray(t.postTokenBalances)||t.preTokenBalances.length>64||t.postTokenBalances.length>64)throw new Error('Finalized token changes are unavailable. Keep the request pending.');
  const amounts=(rows:any[])=>{
    const m=new Map<number,{mint:string;amount:bigint}>();
    for(const row of rows){if(!object(row)||row.owner!==p.account)continue;if(!Number.isInteger(row.accountIndex)||row.accountIndex<0||row.accountIndex>=keys.length||m.has(row.accountIndex)||typeof row.uiTokenAmount?.amount!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(row.uiTokenAmount.amount))throw new Error('Invalid finalized token changes');m.set(row.accountIndex,{mint:solanaAddress(row.mint),amount:BigInt(row.uiTokenAmount.amount)});}return m;
  };
  const pre=amounts(t.preTokenBalances),post=amounts(t.postTokenBalances);let inputDelta=0n,outputDelta=0n;
  for(const index of new Set([...pre.keys(),...post.keys()])){const a=pre.get(index),b=post.get(index);if(a&&b&&a.mint!==b.mint)throw new Error('Token identity changed');const mint=(a??b)!.mint,delta=(b?.amount??0n)-(a?.amount??0n);
    if(keys[index]===source&&mint===p.intent.inputMint)inputDelta+=delta;else if(keys[index]===dest&&mint===p.intent.outputMint)outputDelta+=delta;else if(delta<0n)throw new Error('Unexpected owned token debit. Keep the request pending.');}
  if(inputDelta!==-rawU64(p.intent.inputAmount)||outputDelta<rawU64(p.intent.minimumOut))throw new Error('Finalized balances do not match the reviewed exact cap and output minimum. Keep the request pending.');
  return {state:'confirmed',signature:p.signature,slot:t.slot,outputAmount:outputDelta.toString()};
}
export function openSolanaRecovery(storage:JournalStorage,lease:WalletWorkflowLease,account:string,notify?:(p:SolanaPending|null)=>void){
  const saved=readSolanaPending(storage,account);if(!saved)return null;
  const journal=createOwnedJournal<SolanaPending>({storage,lease,key:solanaPendingKey(account),notify});const record=journal.begin(saved.record,saved.raw);
  return {record,assertCurrent:journal.assertCurrent,clear:journal.clear};
}
