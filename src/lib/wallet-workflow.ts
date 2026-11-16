/** Browser-wide serialization and owned durable markers for wallet workflows. */
export class WalletWorkflowError extends Error {
  readonly stopQueue = true;
  constructor(message: string) { super(message); this.name = 'WalletWorkflowError'; }
}

export type WalletWorkflowLease = {
  readonly journalId: string;
  readonly name: string;
  assertActive(): void;
  release(): void;
};
export type WorkflowLockManager = {
  request<T>(name: string, options: {mode: 'exclusive'; ifAvailable: true},
    callback: (lock: {name: string; mode: string} | null) => Promise<T>): Promise<T>;
};
export type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const validJournalId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function walletWorkflowKey(account: string, network: string | number): string {
  if (!account || account.length > 64 || !/^[a-zA-Z0-9:_-]{1,64}$/.test(String(network)))
    throw new WalletWorkflowError('Wallet coordination scope is unavailable.');
  // Solana addresses are case-sensitive; EVM checksum casing is not a new scope.
  const canonical = /^0x[0-9a-f]{40}$/i.test(account) ? account.toLowerCase() : account;
  return `iaero.sweeper.workflow.v1.${network}.${canonical}`;
}
const makeId = () => {
  const id = globalThis.crypto?.randomUUID?.();
  if (!validJournalId(id)) throw new WalletWorkflowError('Secure wallet coordination is unavailable in this browser.');
  return id;
};

/**
 * Hold one native exclusive Web Lock until explicit release. No queueing of an
 * old reviewed trade and no storage/clock lease fallback. Closing the realm
 * releases the native lock; the durable pending marker remains authoritative.
 */
export async function acquireWalletWorkflow(name: string, options: {
  locks?: WorkflowLockManager; id?: () => string;
} = {}): Promise<WalletWorkflowLease> {
  const locks = options.locks ?? (typeof navigator === 'undefined' ? undefined : navigator.locks);
  if (!locks || typeof locks.request !== 'function')
    throw new WalletWorkflowError('This browser cannot safely coordinate wallet requests across tabs. Use a browser with Web Locks support.');
  if (!name.startsWith('iaero.sweeper.workflow.v1.') || name.length > 200)
    throw new WalletWorkflowError('Wallet coordination scope is unavailable.');
  const journalId = (options.id ?? makeId)();
  if (!validJournalId(journalId)) throw new WalletWorkflowError('Secure wallet coordination is unavailable.');
  let resolveReady!: (lease: WalletWorkflowLease) => void, rejectReady!: (reason: unknown) => void;
  let finish!: () => void, active = false;
  const ready = new Promise<WalletWorkflowLease>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  const lease: WalletWorkflowLease = {
    journalId, name,
    assertActive() { if (!active) throw new WalletWorkflowError('Wallet workflow ownership changed. Check the saved request before retrying.'); },
    release() { if (active) active = false; finish(); },
  };
  void Promise.resolve().then(() => locks.request(name, {mode: 'exclusive', ifAvailable: true}, async lock => {
    if (!lock || lock.name !== name || lock.mode !== 'exclusive')
      throw new WalletWorkflowError('Another tab is handling this wallet. Finish or check that request, then review again.');
    active = true; resolveReady(lease);
    try { await held; } finally { active = false; }
  })).catch(() => {
    active = false;
    rejectReady(new WalletWorkflowError('Another tab is handling this wallet, or wallet coordination is unavailable. Check the saved request before retrying.'));
  });
  return ready;
}

/** Every mutation checks the exact owned snapshot while the native lock is held. */
export function createOwnedJournal<T extends {journalId?: string}>(options: {
  lease: WalletWorkflowLease; storage: JournalStorage; key: string;
  notify?: (record: T | null) => void; id?: () => string;
}) {
  const {lease, storage, key} = options;
  let snapshot: string | null | undefined, owner: string | undefined;
  function assertCurrent() {
    lease.assertActive();
    if (snapshot === undefined || storage.getItem(key) !== snapshot)
      throw new WalletWorkflowError('The saved wallet request changed in another tab. Refresh and check it before retrying.');
  }
  function write(record: T | null) {
    assertCurrent();
    if (record && (!owner || record.journalId !== owner))
      throw new WalletWorkflowError('Wallet request ownership does not match the saved request.');
    const next = record ? JSON.stringify(record) : null;
    if (next === null) storage.removeItem(key); else storage.setItem(key, next);
    snapshot = next;
    options.notify?.(record);
  }
  return {
    begin(record: T, existingRaw?: string): T & {journalId: string} {
      lease.assertActive();
      if (snapshot !== undefined) throw new WalletWorkflowError('This journal owner already has a wallet request.');
      const expected = existingRaw ?? null;
      if (storage.getItem(key) !== expected)
        throw new WalletWorkflowError('A previous wallet request needs to be checked before continuing.');
      if (existingRaw !== undefined && JSON.stringify(record) !== existingRaw)
        throw new WalletWorkflowError('The saved wallet request changed. Refresh before checking it.');
      owner = record.journalId ?? (options.id ?? makeId)();
      if (!validJournalId(owner)) throw new WalletWorkflowError('The saved wallet request has invalid ownership metadata.');
      snapshot = expected;
      const owned = {...record, journalId: owner};
      write(owned); return owned;
    },
    update(record: T) { write(record); },
    clear() { write(null); },
    assertCurrent,
    get snapshot() { return snapshot; },
  };
}
