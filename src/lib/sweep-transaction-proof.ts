import type {Address, Hex} from 'viem';
import {matchesPending, type PendingSweep} from './sweep-guards';

export type SubmittedTransaction = {
  hash: string; from: string; to: string | null; input: string;
  value: bigint; nonce: number; chainId?: number;
};
export type BoundSubmittedSweep = PendingSweep & {
  nonce: number; nonceBaseline?: number; nonceVerified: true;
};
export type TransactionMismatchField = 'hash' | 'sender' | 'target' | 'calldata' | 'value' | 'chain' | 'nonce';

/** Safe queue-stopping diagnostic: field names and a validated saved anchor only. */
export class SubmittedTransactionMismatchError extends Error {
  readonly stopQueue = true;
  readonly fields: readonly TransactionMismatchField[];
  readonly anchorHash?: Hex;
  constructor(fields: TransactionMismatchField[], anchorHash?: Hex) {
    super(`Wallet transaction differs from the reviewed request (${fields.join(', ')}). `
      + (anchorHash ? `Original transaction: ${anchorHash}.` : 'Original transaction hash is unavailable.'));
    this.name = 'SubmittedTransactionMismatchError';
    this.fields = Object.freeze([...fields]);
    this.anchorHash = anchorHash;
  }
}

const hash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const bytes = (v: unknown): v is string => typeof v === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(v);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nonce = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * Bind ONLY the transaction at the already-saved wallet-returned ORIGINAL hash.
 * No receipt/finality claim, storage mutation, suffix removal, smart-wallet
 * wrapper acceptance or resubmission happens here. The caller must still prove
 * the canonical receipt/block before clearing its pending gate or continuing.
 *
 * `expectedHash` defaults to originalHash ?? hash and cannot override that saved
 * anchor. A manually pasted hash cannot give a hashless legacy marker a proof.
 * An unverified public-RPC candidate nonce is a baseline, not the wallet's nonce.
 * Adopt the observed nonce only after every hash/intent check passes; once a
 * nonce is verified for this original hash, it is immutable.
 */
export function bindSubmittedTransaction(
  record: PendingSweep,
  tx: SubmittedTransaction,
  expectedHash?: string,
): BoundSubmittedSweep {
  const candidate = record as PendingSweep & {nonceBaseline?: unknown; nonceVerified?: unknown};
  const anchor = record?.originalHash ?? record?.hash;
  const expected = expectedHash === undefined ? anchor : expectedHash;
  const safeAnchor = hash(anchor) ? anchor.toLowerCase() as Hex : undefined;
  const fields: TransactionMismatchField[] = [];

  if (!hash(anchor) || !hash(expected) || !same(anchor, expected)
    || !hash(tx?.hash) || !same(tx.hash, anchor)
    || record?.hash !== undefined && !hash(record.hash)) fields.push('hash');
  if (!address(record?.account) || !address(tx?.from) || !same(tx.from, record.account)) fields.push('sender');
  if (!address(record?.target) || !address(tx?.to) || !same(tx.to, record.target)) fields.push('target');
  if (!bytes(record?.data) || !bytes(tx?.input) || !same(tx.input, record.data)) fields.push('calldata');
  if (record?.value !== '0' || tx?.value !== 0n) fields.push('value');
  if (!Number.isSafeInteger(record?.chainId) || record.chainId <= 0
    || tx?.chainId !== undefined && tx.chainId !== record.chainId) fields.push('chain');
  if (!nonce(tx?.nonce)
    || candidate?.nonce !== undefined && !nonce(candidate.nonce)
    || candidate?.nonceBaseline !== undefined && !nonce(candidate.nonceBaseline)
    || candidate?.nonceVerified !== undefined && typeof candidate.nonceVerified !== 'boolean'
    || candidate?.nonceVerified === true && (!nonce(candidate.nonce) || tx.nonce !== candidate.nonce)) fields.push('nonce');

  // Reuse the existing full-intent comparison after safe shape checks; never
  // replace it with decoded-argument, prefix or amount-only matching.
  if (!fields.length && !matchesPending(record, tx)) fields.push('calldata');
  if (fields.length) throw new SubmittedTransactionMismatchError(fields, safeAnchor);
  const baseline = nonce(candidate.nonceBaseline) ? candidate.nonceBaseline : candidate.nonce;
  return {...record, nonce: tx.nonce, ...(baseline === undefined ? {} : {nonceBaseline: baseline}), nonceVerified: true};
}

export type SubmittedApprovalProof = {
  spender: Address; reviewedAmount: string; observedAmount: string;
};
export type BoundSubmittedWalletRequest = BoundSubmittedSweep & {approvalProof?: SubmittedApprovalProof};

function standardApproval(input: unknown): {spender: Address; amount: bigint} | undefined {
  // Exactly selector + two ABI words. Address high padding must be canonical;
  // suffixes, alternate functions, wrappers and extra words cannot match.
  if (typeof input !== 'string' || !/^0x[0-9a-fA-F]{136}$/.test(input)
    || input.slice(2, 10).toLowerCase() !== '095ea7b3'
    || !/^0{24}$/.test(input.slice(10, 34))) return undefined;
  return {spender: ('0x' + input.slice(34, 74).toLowerCase()) as Address,
    amount: BigInt('0x' + input.slice(74))};
}

/**
 * Recognize only wallet-edited STANDARD ERC20 approval amounts in an approval
 * workflow. Swaps and every other label retain strict full-byte identity.
 *
 * The same original wallet hash, sender, token target, zero native value,
 * optional chain and immutable verified nonce are still proven by the strict
 * binder. Only the amount word may change: positive review => observed >= review;
 * zero review/reset => observed exactly zero. Spender is byte-exact after strict
 * canonical decoding. The reviewed record.data is never replaced by wallet bytes.
 *
 * approvalProof is transient and reconstructed on EACH call, never trusted from
 * storage. It is NOT receipt/allowance proof: the caller must prove the canonical
 * receipt and freshly read allowance >= reviewedAmount before clearing a journal
 * or continuing. This helper never submits, retries, reads state or mutates input.
 */
export function bindSubmittedWalletRequest(
  record: PendingSweep,
  tx: SubmittedTransaction,
  expectedHash?: string,
): BoundSubmittedWalletRequest {
  const {approvalProof: _persistedProof, ...reviewed} = (record ?? {}) as PendingSweep & {approvalProof?: unknown};
  const approvalRole = typeof reviewed.label === 'string'
    && (reviewed.label.startsWith('Approve ') || reviewed.label.startsWith('Reset '));
  if (!approvalRole) return bindSubmittedTransaction(reviewed, tx, expectedHash);
  const original = standardApproval(reviewed.data), actual = standardApproval(tx?.input);
  if (!original || !actual || original.spender !== actual.spender
    || (original.amount === 0n ? actual.amount !== 0n : actual.amount < original.amount)) {
    const anchor = reviewed.originalHash ?? reviewed.hash;
    throw new SubmittedTransactionMismatchError(['calldata'], hash(anchor) ? anchor.toLowerCase() as Hex : undefined);
  }
  // The sole approved semantic difference was checked above. The strict binder
  // now proves every other field and preserves the ORIGINAL reviewed calldata.
  const bound = bindSubmittedTransaction(reviewed, {...tx, input: reviewed.data}, expectedHash);
  return {...bound, approvalProof: {spender: original.spender,
    reviewedAmount: original.amount.toString(), observedAmount: actual.amount.toString()}};
}
