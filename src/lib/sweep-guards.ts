import { decodeEventLog, parseAbi, isAddress, parseUnits, type Address, type Hex } from 'viem';

export const AERO = '0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee' as const;
export const SLIPPAGE_BPS = 50;
export const QUOTE_TTL_MS = 120_000;
export type OutputToken = 'USDC' | 'WETH' | 'AERO';
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function exactAmount(input: string | undefined, balance: bigint, decimals: number, verified: boolean): bigint {
  if (!verified || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Token units could not be verified. Re-scan before swapping.');
  if (!input?.trim()) { if (balance <= 0n) throw new Error('No token balance.'); return balance; }
  const value = input.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) throw new Error('Enter a plain decimal amount within this token’s precision.');
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount > balance) throw new Error('Amount must be positive and within the available balance.');
  return amount;
}
export function minimumOutput(quote: bigint, bps = SLIPPAGE_BPS): bigint {
  if (quote <= 0n || !Number.isInteger(bps) || bps < 0 || bps > 500) throw new Error('Invalid minimum output.');
  return (quote * BigInt(10_000 - bps)) / 10_000n;
}
export function preserveMinimum(original: bigint, fresh: bigint) {
  if (fresh < original) throw new Error('The quote changed below your reviewed minimum. Review a new quote before continuing.');
  return original;
}
export function bind0xQuote(data: any, expected: {sellToken: Address; buyToken: Address; amount: bigint; taker: Address; target: Address}) {
  if (!data || !sameAddress(String(data.sellToken), expected.sellToken) || !sameAddress(String(data.buyToken), expected.buyToken) || String(data.sellAmount) !== expected.amount.toString()) throw new Error('Quote token or amount mismatch.');
  if (data.liquidityAvailable === false || !/^\d+$/.test(String(data.buyAmount)) || BigInt(data.buyAmount) <= 0n) throw new Error('No executable liquidity found.');
  if (data.taker && !sameAddress(data.taker, expected.taker)) throw new Error('Quote account mismatch.');
  const tx = data.transaction;
  if (!tx || !isAddress(tx.to) || !sameAddress(tx.to, expected.target) || !/^0x[0-9a-fA-F]{8,}$/.test(tx.data) || (tx.data.length % 2) !== 0 || BigInt(tx.value ?? '0') !== 0n) throw new Error('Quote transaction target or value is invalid.');
  if (!/^[1-9]\d*$/.test(String(data.minBuyAmount)) || BigInt(data.minBuyAmount)>BigInt(data.buyAmount) || BigInt(data.minBuyAmount)<minimumOutput(BigInt(data.buyAmount))) throw new Error('Quote minimum output is missing or below the reviewed slippage limit.');
  if (data.issues?.allowance?.spender && !sameAddress(data.issues.allowance.spender, expected.target)) throw new Error('Quote spender mismatch.');
  return {buyAmount: BigInt(data.buyAmount), minimum: BigInt(data.minBuyAmount), transactionTo: tx.to as Address, transactionData: tx.data as Hex};
}
export interface PendingSweep {
  version: 1; account: Address; chainId: number; target: Address; data: Hex; value: '0';
  hash?: Hex; originalHash?: Hex; nonce?: number; createdBlock?: string; createdAt: number; label: string;
  nonceBaseline?: number; nonceVerified?: boolean; journalId?: string;
}
export function pendingKey(account: Address, chainId: number) { return `iaero.sweeper.pending.v1.${chainId}.${account.toLowerCase()}`; }
export function validatePending(value: unknown, account: Address, chainId: number): PendingSweep | null {
  const p = value as PendingSweep;
  if (!p || p.version !== 1 || !sameAddress(String(p.account), account) || p.chainId !== chainId || !isAddress(p.target) || !/^0x[0-9a-fA-F]+$/.test(p.data) || p.value !== '0' || (p.hash && !/^0x[0-9a-fA-F]{64}$/.test(p.hash))
    || p.originalHash!==undefined&&!/^0x[0-9a-fA-F]{64}$/.test(p.originalHash)
    || p.nonceBaseline!==undefined&&(!Number.isSafeInteger(p.nonceBaseline)||p.nonceBaseline<0)
    || p.nonceVerified!==undefined&&typeof p.nonceVerified!=='boolean'
    || p.journalId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.journalId)
    || p.nonceVerified===true&&(!Number.isSafeInteger(p.nonce)||p.nonce!<0)) return null;
  return p;
}
export function matchesPending(p: PendingSweep, tx: {from: string; to: string | null; input: string; value: bigint}) {
  return sameAddress(tx.from, p.account) && !!tx.to && sameAddress(tx.to, p.target) && tx.input.toLowerCase() === p.data.toLowerCase() && tx.value === 0n;
}
export function pendingTransactionKind(p: PendingSweep, tx: {from:string;to:string|null;input:string;value:bigint;nonce:number}): 'intent'|'replacement' {
  if (!sameAddress(tx.from,p.account)) throw new Error('Transaction sender does not match this wallet request.');
  if (p.nonceVerified !== true || !Number.isSafeInteger(p.nonce) || p.nonce! < 0) throw new Error('Original nonce has not been proven. Check the original transaction first.');
  if (tx.nonce !== p.nonce) throw new Error('Transaction nonce does not match the saved wallet request.');
  if (matchesPending(p,tx)) return 'intent';
  return 'replacement';
}
export function isWalletRejection(error: unknown): boolean {
  let e: any = error;
  for (let n=0; e && n<8; n++, e=e.cause) if (e.code === 4001 || e.name === 'UserRejectedRequestError') return true;
  return false;
}
// These viem/wagmi preflight failures occur before a transaction can be accepted.
// Generic RPC, transport, nonce and receipt errors remain ambiguous and stay held.
export function isProvenNotSubmitted(error: unknown): boolean {
  if (isWalletRejection(error)) return true;
  const names = new Set(['ConnectorNotConnectedError','ConnectorNotFoundError','ConnectorAccountNotFoundError','AccountNotFoundError','AccountTypeNotSupportedError','ChainMismatchError','ConnectorChainMismatchError','ChainNotConfiguredError','InvalidChainIdError','InsufficientFundsError']);
  let e: any=error;
  for(let n=0;e&&n<8;n++,e=e.cause)if(names.has(e.name))return true;
  return false;
}
export async function mapBounded<T,R>(items: readonly T[], limit: number, fn: (value:T,index:number)=>Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length); let next=0,failed=false,failure:unknown;
  await Promise.all(Array.from({length: Math.min(limit,items.length)}, async()=>{
    while(!failed){const i=next++;if(i>=items.length)return;try{results[i]=await fn(items[i],i);}catch(error){if(!failed){failed=true;failure=error;}}}
  }));
  // Let already running reads settle; no task or state mutation outlives this call.
  if(failed)throw failure;
  return results;
}

const TRANSFER_ABI = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export function walletReceiptOutput(logs: readonly any[], output: Address, account: Address): bigint {
  let net=0n;
  for(const log of logs){if(!sameAddress(String(log.address),output))continue;try{const e=decodeEventLog({abi:TRANSFER_ABI,data:log.data,topics:log.topics});if(sameAddress(e.args.to,account))net+=e.args.value;if(sameAddress(e.args.from,account))net-=e.args.value;}catch{/* Only the canonical output's standard Transfer events count. */}}
  if(net<0n)throw new Error('Confirmed output could not be reconciled.');
  return net;
}
