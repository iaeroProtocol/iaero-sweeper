import {Buffer} from 'buffer';
import {PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram} from '@solana/web3.js';
import idl from './solana-jupiter-idl.json';

export const SOLANA_MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOLANA_WSOL = 'So11111111111111111111111111111111111111112';
export const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SPL_ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const SOLANA_FEE_BPS = 5;
// Existing hosted public fee recipient, preserved from the audited deployment.
export const SOLANA_FEE_WALLET = '7gC6tTQVFUTu2toG93nhtqx9ESvRZyHpRTY67dQksSZM';
// Primary program declarations: orca-so/whirlpools lib.rs36196253...;
// MeteoraAg/dlmm-sdk constants/index.ts ad27f713.... No arbitrary CPI target.
export const SOLANA_DEX_PROGRAMS: Readonly<Record<string,string>> = Object.freeze({
  Whirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  MeteoraDlmm: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
});
export const MAX_SOLANA_QUOTE_AGE = 60_000;
export const U64_MAX = (1n << 64n) - 1n;
export const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function solanaAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) throw new Error('Invalid Solana address');
  const key = new PublicKey(value);
  if (key.toBase58() !== value || key.equals(PublicKey.default)) throw new Error('Invalid Solana address');
  return value;
}
export function solanaSignature(value: unknown): string {
  if(typeof value!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value))throw new Error('Invalid Solana signature');
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;
  for(const c of value)n=n*58n+BigInt(alphabet.indexOf(c));
  let bytes=0,remaining=n;while(remaining>0n){remaining>>=8n;bytes++;}
  let zeroes=0;for(const c of value){if(c!=='1')break;zeroes++;}
  if(bytes+zeroes!==64||n===0n)throw new Error('Invalid Solana signature');return value;
}
export function rawU64(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw new Error('Invalid raw token amount');
  const n = BigInt(value); if (n > U64_MAX) throw new Error('Invalid raw token amount'); return n;
}
export function associatedToken(wallet: string, mint: string): string {
  return PublicKey.findProgramAddressSync([new PublicKey(solanaAddress(wallet)).toBytes(), new PublicKey(SPL_TOKEN).toBytes(), new PublicKey(solanaAddress(mint)).toBytes()], new PublicKey(SPL_ATA))[0].toBase58();
}
export function base64Bytes(value: unknown, max = 1232): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid encoded instruction');
  const result = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (result.length > max) throw new Error('Instruction exceeds limit'); return result;
}
export const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export type SolanaQuote = {
  inputMint: string; outputMint: string; inAmount: string; outAmount: string; otherAmountThreshold: string;
  swapMode: 'ExactIn'; slippageBps: number; priceImpactPct: string; platformFee: {amount: string; feeBps: number};
  routePlan: any[]; quotedAt: number; contextSlot: number;
};
export function validateSolanaQuote(value: unknown, expected: {inputMint: string; outputMint: string; amount: string; slippageBps: number}, now = Date.now()): SolanaQuote {
  if (!object(value) || value.inputMint !== solanaAddress(expected.inputMint) || value.outputMint !== solanaAddress(expected.outputMint)
    || value.inputMint === value.outputMint || value.inAmount !== rawU64(expected.amount).toString() || value.swapMode !== 'ExactIn'
    || value.slippageBps !== expected.slippageBps || !Number.isInteger(value.slippageBps) || value.slippageBps < 10 || value.slippageBps > 500
    || !Number.isSafeInteger(value.quotedAt) || value.quotedAt > now + 5_000 || now - value.quotedAt > MAX_SOLANA_QUOTE_AGE
    || !Number.isSafeInteger(value.contextSlot) || value.contextSlot < 1 || typeof value.priceImpactPct !== 'string'
    || !/^\d+(?:\.\d+)?$/.test(value.priceImpactPct) || !Number.isFinite(Number(value.priceImpactPct)) || Number(value.priceImpactPct) > 1
    || !object(value.platformFee) || value.platformFee.feeBps !== SOLANA_FEE_BPS || typeof value.platformFee.amount !== 'string'
    || !/^(0|[1-9][0-9]{0,19})$/.test(value.platformFee.amount)
    || !Array.isArray(value.routePlan) || value.routePlan.length !== 1) throw new Error('Quote does not match reviewed swap');
  const out = rawU64(value.outAmount), minimum = rawU64(value.otherAmountThreshold);
  if (minimum > out || minimum < out * BigInt(10_000 - value.slippageBps) / 10_000n
    || BigInt(value.platformFee.amount) > (out * 5n + 9_994n) / 9_995n + 1n) throw new Error('Quote output floor or fee is invalid');
  const leg = value.routePlan[0];
  if (!object(leg) || leg.percent !== 100 || !object(leg.swapInfo) || leg.swapInfo.inputMint !== value.inputMint
    || leg.swapInfo.outputMint !== value.outputMint || leg.swapInfo.inAmount !== value.inAmount || solanaAddress(leg.swapInfo.ammKey) !== leg.swapInfo.ammKey) throw new Error('Only a direct exact-input route is supported');
  return Object.freeze(JSON.parse(JSON.stringify(value))) as SolanaQuote;
}
// Jupiter documents a decimal fraction, not percentage points (0.01 means1%).
export const jupiterImpactPercent = (quote: Pick<SolanaQuote,'priceImpactPct'>):number => Number(quote.priceImpactPct) * 100;
export type SolanaReviewedIntent = Readonly<{
  version: 1; network: typeof SOLANA_MAINNET; account: string; inputMint: string; outputMint: string;
  inputAmount: string; inputDecimals: number; outputDecimals: number; minimumOut: string;
  reviewedOut: string; reviewedImpact: number; forceConsent: boolean; reviewedAt: number; slippageBps: number;
}>;
export function createSolanaReview(account: string, quote: SolanaQuote, inputDecimals: number, outputDecimals: number, forceConsent: boolean, now = Date.now()): SolanaReviewedIntent {
  const q = validateSolanaQuote(quote, {inputMint: quote.inputMint, outputMint: quote.outputMint, amount: quote.inAmount, slippageBps: quote.slippageBps}, now);
  if (![inputDecimals, outputDecimals].every(n => Number.isInteger(n) && n >= 0 && n <= 18) || typeof forceConsent !== 'boolean') throw new Error('Invalid reviewed token units');
  if (jupiterImpactPercent(q) > 5 && !forceConsent) throw new Error('High price impact requires explicit review');
  return Object.freeze({version: 1, network: SOLANA_MAINNET, account: solanaAddress(account), inputMint: q.inputMint, outputMint: q.outputMint,
    inputAmount: q.inAmount, inputDecimals, outputDecimals, minimumOut: q.otherAmountThreshold, reviewedOut: q.outAmount,
    reviewedImpact: jupiterImpactPercent(q), forceConsent, reviewedAt: q.quotedAt, slippageBps: q.slippageBps});
}
export function assertSolanaReview(intent: SolanaReviewedIntent, account: string, quote: SolanaQuote, now = Date.now()): void {
  if (!object(intent) || intent.version !== 1 || intent.network !== SOLANA_MAINNET || intent.account !== solanaAddress(account)
    || !Number.isSafeInteger(intent.reviewedAt) || intent.reviewedAt > now + 5_000 || now - intent.reviewedAt > 10 * 60_000
    || !Number.isFinite(intent.reviewedImpact) || intent.reviewedImpact < 0 || intent.reviewedImpact > 100
    || typeof intent.forceConsent !== 'boolean' || intent.reviewedImpact > 5 && !intent.forceConsent) throw new Error('Swap review expired or wallet changed');
  const q = validateSolanaQuote(quote, {inputMint: intent.inputMint, outputMint: intent.outputMint, amount: intent.inputAmount, slippageBps: intent.slippageBps}, now);
  if (rawU64(q.otherAmountThreshold) < rawU64(intent.minimumOut) || rawU64(q.outAmount) < rawU64(intent.minimumOut)
    || jupiterImpactPercent(q) > Math.max(5, intent.reviewedImpact)) throw new Error('Output floor or price impact changed. Review a new quote.');
}

export type SolanaInstruction = {programId: string; accounts: {pubkey: string; isSigner: boolean; isWritable: boolean}[]; data: string};
// Official Jupiter v6 IDL: jup-ag/jupiter-cpi idl.json blob5018becdfb4006d8f8ab058b54fec7d686892e5e.
// This deliberately supports only the bounded classic-SPL direct `route` family.
const SAFE_SWAPS = new Set(Object.keys(SOLANA_DEX_PROGRAMS));
const ROUTE_DISCRIMINATOR = [229, 23, 203, 151, 122, 227, 173, 42];
function decodeRoute(data: Uint8Array) {
  if (data.length < 35 || !ROUTE_DISCRIMINATOR.every((x, i) => data[i] === x)) throw new Error('Unsupported Jupiter instruction family');
  const view = new DataView(data.buffer, data.byteOffset, data.length); let p = 8;
  const read = (type: any): any => {
    const need = (n: number) => {if (p + n > data.length) throw new Error('Truncated route');};
    if (type === 'u8' || type === 'bool') {need(1); const n = data[p++]; if (type === 'bool' && n > 1) throw new Error('Invalid route boolean'); return n;}
    if (type === 'u32') {need(4); const n = view.getUint32(p, true); p += 4; return n;}
    if (type === 'u64') {need(8); const n = view.getBigUint64(p, true); p += 8; return n;}
    if (object(type) && typeof type.defined === 'string') {
      const def: any = idl.types.find(t => t.name === type.defined); if (!def) throw new Error('Unsupported route type');
      if (def.type.kind === 'enum') {const tag = read('u8'), variant = def.type.variants[tag]; if (!variant) throw new Error('Unsupported route variant'); const fields = (variant.fields ?? []).map((f: any) => read(f.type)); return {name: variant.name, fields};}
    }
    throw new Error('Unsupported route encoding');
  };
  const count = read('u32'); if (count !== 1) throw new Error('Only a direct route is supported');
  const swap = read({defined: 'Swap'}); if (!SAFE_SWAPS.has(swap.name)) throw new Error('Unsupported route requires separate review');
  if (read('u8') !== 100 || read('u8') !== 0 || read('u8') !== 1) throw new Error('Unsupported route allocation');
  const amountIn = read('u64'), outOffset = p, out = read('u64');
  if (p + 3 !== data.length) throw new Error('Unexpected route trailing data');
  const slippageBps = view.getUint16(p, true); p += 2; const feeBps = data[p];
  return {amountIn, out, outOffset, slippageBps, feeBps, swap: swap.name};
}
export function validateJupiterRoute(value: unknown, intent: SolanaReviewedIntent, quote: SolanaQuote, feeWallet: string, now = Date.now()): SolanaInstruction {
  assertSolanaReview(intent, intent.account, quote, now);
  if (feeWallet !== SOLANA_FEE_WALLET) throw new Error('Platform fee recipient changed');
  if (!object(value) || value.programId !== JUPITER_PROGRAM || !Array.isArray(value.accounts) || value.accounts.length < 9 || value.accounts.length > 48) throw new Error('Unsupported swap instruction');
  const accounts = value.accounts.map((a: any) => {
    if (!object(a) || typeof a.isSigner !== 'boolean' || typeof a.isWritable !== 'boolean') throw new Error('Invalid swap account');
    return {pubkey: solanaAddress(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable};
  });
  const source = associatedToken(intent.account, intent.inputMint), dest = associatedToken(intent.account, intent.outputMint), fee = associatedToken(feeWallet, intent.outputMint);
  const event = PublicKey.findProgramAddressSync([new TextEncoder().encode('__event_authority')], new PublicKey(JUPITER_PROGRAM))[0].toBase58();
  const expected = [SPL_TOKEN, intent.account, source, dest, JUPITER_PROGRAM, intent.outputMint, fee, event, JUPITER_PROGRAM];
  for (let i = 0; i < 9; i++) if (accounts[i].pubkey !== expected[i] || accounts[i].isSigner !== (i === 1)) throw new Error('Swap token, recipient, fee or signer differs from review');
  const bytes = base64Bytes(value.data), d = decodeRoute(bytes);
  const authorityIndex=d.swap==='Whirlpool'?11:20;
  if(accounts[authorityIndex]?.pubkey!==intent.account||accounts[authorityIndex].isSigner||accounts[authorityIndex].isWritable)throw new Error('Expected readonly DEX authority is missing');
  if(d.swap==='Whirlpool'){
    if(accounts.length!==21||accounts[9].pubkey!==SOLANA_DEX_PROGRAMS.Whirlpool||accounts[10].pubkey!==SPL_TOKEN||accounts[12].pubkey!==quote.routePlan[0].swapInfo.ammKey||new Set([accounts[13].pubkey,accounts[15].pubkey]).size!==2||![source,dest].every(key=>[accounts[13].pubkey,accounts[15].pubkey].includes(key)))throw new Error('Whirlpool account layout differs');
  }else if(accounts.length<25||accounts[9].pubkey!==SOLANA_DEX_PROGRAMS.MeteoraDlmm||accounts[10].pubkey!==quote.routePlan[0].swapInfo.ammKey||accounts[14].pubkey!==source||accounts[15].pubkey!==dest||![intent.inputMint,intent.outputMint].every(key=>[accounts[16].pubkey,accounts[17].pubkey].includes(key))||accounts[21].pubkey!==SPL_TOKEN||accounts[22].pubkey!==SPL_TOKEN||accounts[24].pubkey!==SOLANA_DEX_PROGRAMS.MeteoraDlmm)throw new Error('Meteora account layout differs');
  if (!accounts[2].isWritable || !accounts[3].isWritable || !accounts[6].isWritable || accounts[1].isWritable
    || accounts.some((a, i) => a.isSigner && i !== 1 || a.pubkey === intent.account && (i !== 1 && i !== authorityIndex || a.isWritable))) throw new Error('Unexpected wallet authority');
  if (d.amountIn !== rawU64(intent.inputAmount) || d.out !== rawU64(quote.outAmount) || d.slippageBps !== quote.slippageBps || d.feeBps !== 5) throw new Error('Executable amount, minimum or fee differs from review');
  return Object.freeze({programId: JUPITER_PROGRAM, accounts, data: value.data}) as SolanaInstruction;
}
export type SolanaConstruction = {
  network: string; account: string; feeWallet: string; quote: SolanaQuote; swapInstruction: SolanaInstruction;
  blockhash: string; lastValidBlockHeight: number; constructedAt: number; createOutputAta: boolean;
  accountProofs: {pubkey:string;owner:string|null;executable:boolean;exists:boolean}[];
};
export function validateSolanaAccountProofs(route:SolanaInstruction,quote:SolanaQuote,proofs:SolanaConstruction['accountProofs']):void {
  const decoded=decodeRoute(base64Bytes(route.data)),dex=SOLANA_DEX_PROGRAMS[decoded.swap];
  const keys=[...new Set(route.accounts.map(a=>a.pubkey))];
  if(!Array.isArray(proofs)||proofs.length!==keys.length||new Set(proofs.map(p=>p.pubkey)).size!==keys.length)throw new Error('Missing route account proofs');
  const allowed=new Set([SPL_TOKEN,JUPITER_PROGRAM,dex]);
  for(const key of keys){const p=proofs.find(p=>p.pubkey===key);if(!p||typeof p.executable!=='boolean'||typeof p.exists!=='boolean'||p.exists&&typeof p.owner!=='string'||!p.exists&&(p.executable||p.owner!==null)||p.executable&&!allowed.has(key))throw new Error('Unknown executable route program');}
  for(const program of allowed){if(!keys.includes(program)||!proofs.find(p=>p.pubkey===program)?.executable)throw new Error('Expected route program is missing');}
  const pool=quote.routePlan[0].swapInfo.ammKey;
  if(typeof pool!=='string'||!keys.includes(pool)||proofs.find(p=>p.pubkey===pool)?.owner!==dex||proofs.find(p=>p.pubkey===pool)?.executable)throw new Error('Pool does not belong to the supported route program');
}
export function compileSolanaPlan(plan: SolanaConstruction, intent: SolanaReviewedIntent, now = Date.now()): VersionedTransaction {
  if (!object(plan) || plan.network !== SOLANA_MAINNET || plan.account !== intent.account || typeof plan.createOutputAta !== 'boolean'
    || !Number.isSafeInteger(plan.lastValidBlockHeight) || plan.lastValidBlockHeight < 1 || !Number.isSafeInteger(plan.constructedAt)
    || plan.constructedAt > now + 5_000 || now - plan.constructedAt > 30_000) throw new Error('Construction expired or network changed');
  solanaAddress(plan.blockhash);
  const route = validateJupiterRoute(plan.swapInstruction, intent, plan.quote, solanaAddress(plan.feeWallet), now);
  validateSolanaAccountProofs(route,plan.quote,plan.accountProofs);
  // API thresholds can round up one raw unit. Tighten only the decoded quote
  // reference so even floor-rounded onchain arithmetic enforces the reviewed
  // net minimum. Input/path/accounts/slippage/fee bytes remain unchanged.
  const data=base64Bytes(route.data).slice(), decoded=decodeRoute(data);
  const denominator=BigInt(10_000-decoded.slippageBps);
  const required=(rawU64(intent.minimumOut)*10_000n+denominator-1n)/denominator;
  const reference=required>decoded.out?required:decoded.out;
  if(reference>U64_MAX||reference>decoded.out+2n)throw new Error('Output floor requires a new quote');
  new DataView(data.buffer,data.byteOffset,data.byteLength).setBigUint64(decoded.outOffset,reference,true);
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000}), ComputeBudgetProgram.setComputeUnitPrice({microLamports: 1_000})];
  if (plan.createOutputAta) instructions.push(new TransactionInstruction({programId: new PublicKey(SPL_ATA), data: Buffer.from([1]), keys: [
    {pubkey: new PublicKey(intent.account), isSigner: true, isWritable: true},
    {pubkey: new PublicKey(associatedToken(intent.account, intent.outputMint)), isSigner: false, isWritable: true},
    {pubkey: new PublicKey(intent.account), isSigner: false, isWritable: false},
    {pubkey: new PublicKey(intent.outputMint), isSigner: false, isWritable: false},
    {pubkey: PublicKey.default, isSigner: false, isWritable: false},
    {pubkey: new PublicKey(SPL_TOKEN), isSigner: false, isWritable: false},
  ]}));
  instructions.push(new TransactionInstruction({programId: new PublicKey(route.programId), keys: route.accounts.map(a => ({...a, pubkey: new PublicKey(a.pubkey)})), data: Buffer.from(data)}));
  const tx = new VersionedTransaction(new TransactionMessage({payerKey: new PublicKey(intent.account), recentBlockhash: plan.blockhash, instructions}).compileToV0Message());
  if (tx.serialize().length > 1232 || tx.message.header.numRequiredSignatures !== 1 || tx.message.addressTableLookups.length) throw new Error('Route exceeds supported transaction size');
  return tx;
}
