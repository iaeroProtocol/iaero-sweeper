// Guarded server reads, locally validated instruction plans and durable submission recovery.
import {Connection, PublicKey, VersionedTransaction} from '@solana/web3.js';
import {SOLANA_MAINNET, SOLANA_USDC, SOLANA_WSOL, compileSolanaPlan, assertSolanaReview, sameBytes, type SolanaQuote, type SolanaReviewedIntent, type SolanaConstruction} from '@/lib/solana-intent';
import {beginSolanaPending, openSolanaRecovery, readSolanaPending, validateSolanaReconciliation, type SolanaPending} from '@/lib/solana-pending';
import {acquireWalletWorkflow, walletWorkflowKey, type JournalStorage, type WalletWorkflowLease} from '@/lib/wallet-workflow';
export interface SolanaTokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  balanceFormatted: string;
  price: number;
  valueUsd: number;
  logoUrl?: string;
  // Spam filtering fields
  tradeable?: boolean;      // Jupiter can quote it
  tradeError?: string;      // Why it can't be traded (if untradeable)
  priceSource?: 'jupiter' | 'helius' | 'unknown';
  // Quote info (populated during swap)
  priceImpactPct?: number;  // Price impact from Jupiter quote
  quotedOutputUsd?: number; // Expected output value
}

// ============================================================================
// SPAM FILTERING
// ============================================================================

// Known good tokens that should never be filtered
const KNOWN_GOOD_TOKENS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112',   // Wrapped SOL
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // JitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  // bSOL
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // wETH (Portal)
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // wBTC (Portal)
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  // RENDER
  'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',  // WEN
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',  // ORCA
  'RaijNvQiMeZBXqFGLRQRwihLmcMwvWXqeqLhGwjFr5j',  // RAYDIUM
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'AFbX8oGjGpmVFywbVouvhQSRmiW2aR1mohfahi4Y2AdB', // GST
].map(m => m.toLowerCase()));

// Common spam symbol patterns
const SPAM_SYMBOL_PATTERNS = [
  'airdrop',
  'claim',
  'free',
  'reward',
  '.com',
  '.io',
  '.xyz',
  '.org',
  'visit',
  'bonus',
  'gift',
  'win',
];

/**
 * Check if a token symbol looks like spam based on patterns
 */
export function isSpamBySymbol(symbol: string): boolean {
  if (!symbol) return false;
  const lower = symbol.toLowerCase();
  return SPAM_SYMBOL_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Check if a token is known good (whitelisted)
 */
export function isKnownGoodToken(mint: string): boolean {
  return KNOWN_GOOD_TOKENS.has(mint.toLowerCase());
}

// ============================================================================
// USER HIDDEN TOKENS (localStorage)
// ============================================================================

const HIDDEN_TOKENS_KEY = 'solana_sweeper_hidden_tokens';

/**
 * Get user-hidden token mints from localStorage
 */
export function getUserHiddenTokens(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(HIDDEN_TOKENS_KEY);
    if (stored) {
      return new Set(JSON.parse(stored).map((m: string) => m.toLowerCase()));
    }
  } catch (e) {
    console.warn('Failed to read hidden tokens:', e);
  }
  return new Set();
}

/**
 * Add a token to user-hidden list
 */
export function hideToken(mint: string): void {
  if (typeof window === 'undefined') return;
  try {
    const hidden = getUserHiddenTokens();
    hidden.add(mint.toLowerCase());
    localStorage.setItem(HIDDEN_TOKENS_KEY, JSON.stringify([...hidden]));
    console.log(`🚫 User hid token: ${mint.slice(0, 10)}...`);
  } catch (e) {
    console.warn('Failed to hide token:', e);
  }
}

/**
 * Remove a token from user-hidden list
 */
export function unhideToken(mint: string): void {
  if (typeof window === 'undefined') return;
  try {
    const hidden = getUserHiddenTokens();
    hidden.delete(mint.toLowerCase());
    localStorage.setItem(HIDDEN_TOKENS_KEY, JSON.stringify([...hidden]));
    console.log(`✅ User unhid token: ${mint.slice(0, 10)}...`);
  } catch (e) {
    console.warn('Failed to unhide token:', e);
  }
}

/**
 * Clear all user-hidden tokens
 */
export function clearUserHiddenTokens(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HIDDEN_TOKENS_KEY);
    console.log('🗑️ Cleared all user-hidden tokens');
  } catch (e) {
    console.warn('Failed to clear hidden tokens:', e);
  }
}


export type JupiterQuote = SolanaQuote;
export const SOLANA_TOKENS = {USDC:SOLANA_USDC,SOL:SOLANA_WSOL,USDT:'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',BONK:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'} as const;
export type SolanaStatus={ready:boolean;reason?:string;outputs:{mint:string;ready:boolean;reason?:string}[]};
export interface SwapResult {mint:string;symbol:string;status:'success'|'failed'|'skipped'|'pending';signature?:string;error?:string;inputAmount:bigint;outputAmount?:bigint;}
async function serverRead(operation:string, body?:unknown):Promise<any>{
 const response=await fetch('/api/solana/'+operation,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(10_000)});
 let data:any;try{data=await response.json();}catch{throw new Error('Solana read service returned an invalid response.');}
 if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'Solana read service is temporarily unavailable.');return data;
}
export async function getSolanaStatus():Promise<SolanaStatus>{return serverRead('status');}
export async function discoverSolanaTokens(wallet:string,_minimumValueUsd=0,onNotice?:(notice:string)=>void):Promise<SolanaTokenInfo[]>{
 const data=await serverRead('discover',{wallet});if(!Array.isArray(data.tokens))throw new Error('Solana discovery is unavailable.');
 if(data.partial)onNotice?.('Scan reached its bounded300-holding limit. Additional holdings may be present; this is a partial inventory.');
 return data.tokens.map((t:any)=>({...t,balance:BigInt(t.balance),balanceFormatted:(Number(t.balance)/10**t.decimals).toLocaleString(undefined,{maximumFractionDigits:Math.min(t.decimals,8)})}));
}
export async function getJupiterQuote(inputMint:string,outputMint:string,amount:bigint,slippageBps=100,wallet?:string):Promise<JupiterQuote|null>{
 if(!wallet)throw new Error('A connected wallet is required for a reviewed Solana quote.');
 return (await serverRead('quote',{wallet,inputMint,outputMint,amount:amount.toString(),slippageBps})).quote;
}
export async function getJupiterQuotesBatched(tokens:SolanaTokenInfo[],outputMint:string,slippageBps=100,onProgress?:(msg:string)=>void,wallet?:string):Promise<Map<string,JupiterQuote>>{
 const quotes=new Map<string,JupiterQuote>();
 for(let i=0;i<tokens.length;i+=2){onProgress?.(`Fetching quotes (${Math.min(i+2,tokens.length)}/${tokens.length})...`);await Promise.all(tokens.slice(i,i+2).filter(t=>t.balance>0n&&t.mint!==outputMint).map(async t=>{try{const q=await getJupiterQuote(t.mint,outputMint,t.balance,slippageBps,wallet);if(q)quotes.set(t.mint,q);}catch{/* Individual unsupported routes remain unselected. */}}));}
 return quotes;
}
// Force accepts the explicitly reviewed price impact; it never widens the output floor.
export function calculateDynamicSlippage(_impact:number,_force=false):number{return 100;}
function explicitSignRejection(error:unknown):boolean {
 let current:any=error;
 for(let depth=0;current&&depth<8;depth++){
  if(current.code===4001||current.name==='UserRejectedRequestError')return true;
  // Phantom/Solflare preserve the provider error on WalletError.error.
  current=current.cause??(current.name==='WalletSignTransactionError'?current.error:undefined);
 }
 return false;
}
export type SolanaExecutionOptions={reviews:readonly SolanaReviewedIntent[];storage?:JournalStorage;assertActive?:()=>void;onPending?:(p:SolanaPending|null)=>void;acquire?:()=>Promise<WalletWorkflowLease>;read?:(operation:string,body?:unknown)=>Promise<any>};
export async function recoverSolanaPending(account:string,options:Pick<SolanaExecutionOptions,'storage'|'assertActive'|'onPending'|'acquire'|'read'>={}):Promise<{state:string;outputAmount?:string;signature?:string}>{
 const storage=options.storage??localStorage,lease=await(options.acquire?.()??acquireWalletWorkflow(walletWorkflowKey(account,SOLANA_MAINNET)));
 try{options.assertActive?.();const journal=openSolanaRecovery(storage,lease,account,options.onPending);if(!journal)return {state:'none'};
  if(!journal.record.signature)return {state:'pending'};
  const p=journal.record,data=await(options.read??serverRead)('reconcile',{account,signature:p.signature,blockhash:p.blockhash,lastValidBlockHeight:p.lastValidBlockHeight});
  lease.assertActive();options.assertActive?.();journal.assertCurrent();const result=validateSolanaReconciliation(p,data);
  if(result.state==='confirmed'||result.state==='failed')journal.clear();return result;
 }finally{lease.release();}
}
export async function executeBatchSwap(tokens:SolanaTokenInfo[],outputMint:string,outputDecimals:number,wallet:PublicKey,connection:Connection,signTransaction:(tx:VersionedTransaction)=>Promise<VersionedTransaction>,_slippageBps=100,onProgress?:(msg:string)=>void,_signAllTransactions?:unknown,options?:SolanaExecutionOptions):Promise<{successful:SwapResult[];failed:SwapResult[];totalOutputAmount:bigint;pending?:SolanaPending}>{
 if(!options||options.reviews.length!==tokens.length||tokens.length===0||new Set(tokens.map(t=>t.mint)).size!==tokens.length)throw new Error('An exact immutable review is required for every selected token.');
 const account=wallet.toBase58(),storage=options.storage??localStorage,read=options.read??serverRead;
 const lease=await(options.acquire?.()??acquireWalletWorkflow(walletWorkflowKey(account,SOLANA_MAINNET)));
 const successful:SwapResult[]=[],failed:SwapResult[]=[];let totalOutputAmount=0n;
 const active=()=>{lease.assertActive();options.assertActive?.();};
 try{
  active();if(readSolanaPending(storage,account))throw new Error('An earlier Solana request is still pending. Reconcile the original transaction before another swap.');
  let genesis:string;try{genesis=await connection.getGenesisHash();}catch{throw new Error('Solana mainnet RPC is unavailable. No signature was requested.');}
  if(genesis!==SOLANA_MAINNET)throw new Error('Connect to Solana mainnet before reviewing a swap.');active();
  for(let index=0;index<tokens.length;index++){
   const token=tokens[index],intent=options.reviews[index];active();
   if(readSolanaPending(storage,account))throw new Error('A saved wallet request must be reconciled before another quote or signature.');
   if(intent.account!==account||intent.inputMint!==token.mint||intent.outputMint!==outputMint||intent.inputAmount!==token.balance.toString()||intent.inputDecimals!==token.decimals||intent.outputDecimals!==outputDecimals)throw new Error('Selected wallet, token, units or cap differs from the review.');
   let pending:ReturnType<typeof beginSolanaPending>|undefined,rejectedBeforeSigning=false;
   try{
    onProgress?.(`Refreshing reviewed ${token.symbol} quote...`);
    const fresh=(await read('quote',{wallet:account,inputMint:token.mint,outputMint,amount:token.balance.toString(),slippageBps:intent.slippageBps})).quote;active();assertSolanaReview(intent,account,fresh);
    const plan=await read('construct',{intent,quote:fresh}) as SolanaConstruction;active();const tx=compileSolanaPlan(plan,intent);const message=tx.message.serialize();
    onProgress?.(`Simulating ${token.symbol}...`);let simulation;try{simulation=await connection.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed'});}catch{throw new Error('Read-only Solana simulation is unavailable. No signature was requested.');}active();
    if(simulation.value.err)throw new Error('Read-only swap simulation failed. Review another route.');
    // Recheck age/intent immediately before the wallet prompt and persist before any signer call.
    compileSolanaPlan(plan,intent);active();pending=beginSolanaPending(storage,lease,intent,tx,plan.lastValidBlockHeight,options.onPending);
    onProgress?.(`Sign reviewed ${token.symbol} swap...`);active();pending.assertCurrent();const signed=await signTransaction(tx).catch(error=>{
     const unchanged=sameBytes(message,tx.message.serialize()),unsigned=tx.signatures.every(signature=>signature.every(byte=>byte===0));
     // Some adapters sign the original object before losing their response.
     if(unchanged&&!unsigned)pending!.signed(tx);
     rejectedBeforeSigning=explicitSignRejection(error)&&unchanged&&unsigned;
     throw error;
    });active();
    if(!sameBytes(message,signed.message.serialize()))throw new Error('Wallet transaction differs from the reviewed instruction plan.');
    const saved=pending.signed(signed);active();pending.assertCurrent();compileSolanaPlan(plan,intent);
    onProgress?.(`Submitting ${token.symbol}...`);const returned=await connection.sendRawTransaction(signed.serialize(),{skipPreflight:false,maxRetries:0});active();pending.submitted(returned);
    onProgress?.(`Confirming original ${token.symbol} transaction...`);
    await connection.confirmTransaction({signature:saved.signature!,blockhash:saved.blockhash,lastValidBlockHeight:saved.lastValidBlockHeight},'finalized');active();
    const observed=await read('reconcile',{account,signature:saved.signature,blockhash:saved.blockhash,lastValidBlockHeight:saved.lastValidBlockHeight});active();pending.assertCurrent();
    const result=validateSolanaReconciliation(pending.record,observed);
    if(result.state==='confirmed') {const outputAmount=BigInt(result.outputAmount!);pending.clear();pending=undefined;totalOutputAmount+=outputAmount;successful.push({mint:token.mint,symbol:token.symbol,status:'success',inputAmount:token.balance,outputAmount,signature:result.signature});}
    else if(result.state==='failed'){pending.clear();pending=undefined;failed.push({mint:token.mint,symbol:token.symbol,status:'failed',inputAmount:token.balance,signature:result.signature,error:'Original transaction failed on the finalized chain.'});}
    else throw new Error('Original transaction is still pending. Reconcile it before another swap.');
   }catch(error){
    if(pending&&rejectedBeforeSigning&&pending.record.phase==='signing'&&!pending.record.signedWire&&!pending.record.signature){
     try{
      active();pending.assertCurrent();pending.clear();pending=undefined;
      failed.push({mint:token.mint,symbol:token.symbol,status:'skipped',inputAmount:token.balance,error:'Signature declined in wallet. Review again when you are ready.'});
      for(const later of tokens.slice(index+1))failed.push({mint:later.mint,symbol:later.symbol,status:'skipped',inputAmount:later.balance,error:'Stopped after the signature request was declined.'});
      return {successful,failed,totalOutputAmount};
     }catch{/* A changed owner or failed storage write must retain the pending gate. */}
    }
    if(pending){try{pending.unknown();}catch{/* Never clear a marker whose storage ownership changed. */}const saved=readSolanaPending(storage,account)?.record??pending.record;
     failed.push({mint:token.mint,symbol:token.symbol,status:'pending',inputAmount:token.balance,signature:saved.signature,error:'Submission outcome is unknown. The original request is saved; no fresh retry will be made.'});
     for(const later of tokens.slice(index+1))failed.push({mint:later.mint,symbol:later.symbol,status:'skipped',inputAmount:later.balance,error:'Stopped while the original wallet request is pending.'});
     return {successful,failed,totalOutputAmount,pending:saved};
    }
    failed.push({mint:token.mint,symbol:token.symbol,status:'failed',inputAmount:token.balance,error:error instanceof Error?error.message:'Swap was held before signing.'});
   }
  }
  return {successful,failed,totalOutputAmount};
 }finally{lease.release();}
}
