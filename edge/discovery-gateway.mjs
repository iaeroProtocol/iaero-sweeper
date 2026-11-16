/**
 * Direct Cloudflare edge gate, before the existing bounded discoverTokens helper.
 *
 * API: createDiscoveryGateway(discoverTokens)(nativeRequest, env, ctx?) returns
 * Response, or null for a different pathname. Pass the original edge Request;
 * never synthesize request.cf or copy an untrusted forwarding header into it.
 * No Origin/CORS/header secret is treated as authorization.
 *
 * env.DISCOVERY_DB: mandatory D1Database with discovery-schema.sql applied.
 * DISCOVERY_PROVIDER_KEYS below: optional existing server bindings, read ONLY
 * after atomic admission. No process.env, remote limiter, dependency or cache.
 * ctx.waitUntil: optional native ExecutionContext for bounded best-effort cleanup.
 * All production requests require native request.cf AND CF-Connecting-IP. There
 * is deliberately no development flag that can disable either requirement.
 *
 * Rolling limits, shared globally through one primary INSERT ... SELECT:
 * client 6/60s + 60/3600s; wallet across chains 3/60s + 30/3600s;
 * global 120/3600s + 500/86400s. All time comes from SQLite unixepoch().
 * A failed/timed-out admission never calls the helper or reads its key bindings.
 * A late D1 write may consume a credit, conservatively; it cannot start providers.
 * Provider failures also consume their credit. There are no refunds/retries.
 *
 * Existing helper budget: 7800ms; gateway hard provider deadline: 8000ms.
 * Maximum keyed requests per scan: Alchemy 10 + Moralis 1 + explorer 1 = 12;
 * therefore at most 1440/hour and 6000/day, independent of IP/wallet rotation.
 * The helper must keep those page bounds; unkeyed sources retain its own bounds.
 *
 * One D1 admission statement is authoritative. Optional background cleanup
 * deletes at most 64 rows older than 48h per admitted request, with a 1s timeout.
 * It never removes rows relevant to any quota. Cleanup failure is ignored.
 * No raw client IP is stored/logged/reflected; only a domain-separated SHA-256.
 * Response headers: X-Discovery-Guard=d1-v1 and X-Discovery-Budget=
 * admitted|denied|unavailable|invalid; no identity/counters/credentials are exposed.
 *
 * Primary references:
 * https://developers.cloudflare.com/d1/worker-api/prepared-statements/
 * https://developers.cloudflare.com/d1/best-practices/read-replication/
 * https://developers.cloudflare.com/workers/runtime-apis/request/
 * https://developers.cloudflare.com/fundamentals/reference/http-headers/
 */

export const DISCOVERY_PROVIDER_KEYS = Object.freeze([
  'ALCHEMY_API_KEY', 'ALCHEMY_KEY', 'NEXT_PUBLIC_ALCHEMY_KEY', 'MORALIS_API_KEY',
  'ETHERSCAN_API_KEY', 'BSCSCAN_API_KEY', 'POLYGONSCAN_API_KEY',
  'SNOWTRACE_API_KEY', 'ARBISCAN_API_KEY', 'OPTIMISM_API_KEY',
  'BASESCAN_API_KEY', 'SCROLLSCAN_API_KEY', 'LINEASCAN_API_KEY',
]);

export const DISCOVERY_LIMITS = Object.freeze({
  clientMinute: 6, clientHour: 60, walletMinute: 3, walletHour: 30,
  globalHour: 120, globalDay: 500, retentionSeconds: 172800,
  gateTimeoutMs: 1000, providerTimeoutMs: 8000, helperBudgetMs: 7800,
});

const CHAINS = new Set(['1', '8453', '42161', '10', '137', '56', '43114', '534352', '59144']);
const ADMIT_SQL = `
INSERT INTO discovery_attempts (client_hash, wallet, chain_id, admitted_at)
SELECT ?1, ?2, ?3, unixepoch()
WHERE
  (SELECT count(*) FROM discovery_attempts INDEXED BY discovery_attempts_client_time
    WHERE client_hash = ?1 AND admitted_at >= unixepoch() - 60) < 6
  AND (SELECT count(*) FROM discovery_attempts INDEXED BY discovery_attempts_client_time
    WHERE client_hash = ?1 AND admitted_at >= unixepoch() - 3600) < 60
  AND (SELECT count(*) FROM discovery_attempts INDEXED BY discovery_attempts_wallet_time
    WHERE wallet = ?2 AND admitted_at >= unixepoch() - 60) < 3
  AND (SELECT count(*) FROM discovery_attempts INDEXED BY discovery_attempts_wallet_time
    WHERE wallet = ?2 AND admitted_at >= unixepoch() - 3600) < 30
  AND (SELECT count(*) FROM discovery_attempts INDEXED BY discovery_attempts_time
    WHERE admitted_at >= unixepoch() - 3600) < 120
  AND (SELECT count(*) FROM discovery_attempts INDEXED BY discovery_attempts_time
    WHERE admitted_at >= unixepoch() - 86400) < 500
RETURNING id`;

const CLEANUP_SQL = `
DELETE FROM discovery_attempts WHERE id IN (
  SELECT id FROM discovery_attempts INDEXED BY discovery_attempts_time
  WHERE admitted_at < unixepoch() - 172800 ORDER BY admitted_at, id LIMIT 64
)`;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function json(status, data, state, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-discovery-guard': 'd1-v1',
    'x-discovery-budget': state,
    ...extraHeaders,
  }});
}

function failure(status, code, message, state, extraHeaders) {
  return json(status, {
    tokens: [], count: 0, logs: [], partial: true, complete: false,
    providers: [], budgetMs: 0,
    limitations: ['Discovery is unavailable for this request. Manual token entry remains available.'],
    code, error: message,
  }, state, extraHeaders);
}

function unavailable() {
  return failure(503, 'DISCOVERY_GUARD_UNAVAILABLE',
    'Token discovery is temporarily unavailable. Retry shortly or enter tokens manually.',
    'unavailable', {'retry-after': '60'});
}

function parameters(url) {
  const seen = new Set();
  for (const name of url.searchParams.keys()) {
    if (!['chainId', 'wallet'].includes(name) || seen.has(name)) return null;
    seen.add(name);
  }
  const chainId = url.searchParams.get('chainId') ?? '';
  const wallet = url.searchParams.get('wallet') ?? '';
  if (!CHAINS.has(chainId) || !/^0x[0-9a-fA-F]{40}$/.test(wallet)
    || /^0x(?:0{40}|e{40})$/i.test(wallet)) return null;
  return new URLSearchParams({chainId, wallet: wallet.toLowerCase()});
}

function canonicalIp(value) {
  if (typeof value !== 'string' || value.length > 45) return null;
  if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value)) {
    return value.split('.').every(part => Number(part) <= 255) ? value : null;
  }
  if (!value.includes(':') || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  try {
    const host = new URL(`https://[${value}]/`).hostname.slice(1, -1);
    // Normalize IPv4-mapped IPv6 into the same client bucket as IPv4.
    if (host.startsWith('::ffff:')) {
      const parts = host.slice(7).split(':');
      if (parts.length !== 2) return null;
      const a = parseInt(parts[0], 16), b = parseInt(parts[1], 16);
      return [a >> 8, a & 255, b >> 8, b & 255].join('.');
    }
    return host;
  } catch { return null; }
}

async function hashClient(ip) {
  const digest = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode('iaero-discovery-client-v1\0' + ip));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function deadline(work, milliseconds, externalSignal) {
  const controller = new AbortController();
  let timer, cancel;
  try {
    const stopped = new Promise((_, reject) => {
      cancel = () => { controller.abort(); reject(new Error('Discovery deadline or cancellation')); };
      timer = setTimeout(cancel, milliseconds);
      externalSignal?.addEventListener('abort', cancel, {once: true});
      if (externalSignal?.aborted) cancel();
    });
    const operation = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Discovery cancelled');
      return work(controller.signal);
    });
    return await Promise.race([operation, stopped]);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

function cleanup(db, ctx) {
  if (typeof ctx?.waitUntil !== 'function') return;
  const work = deadline(() => db.prepare(CLEANUP_SQL).run(), 1000).catch(() => {});
  try { ctx.waitUntil(work); } catch { /* Best effort; admission already succeeded. */ }
}

export function createDiscoveryGateway(discoverTokens) {
  if (typeof discoverTokens !== 'function') throw new TypeError('A discovery helper is required');
  return async function discoveryGateway(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/tokens/discover') return null;
    if (request.method !== 'GET') return failure(405, 'INVALID_DISCOVERY_METHOD',
      'Token discovery requires GET.', 'invalid', {allow: 'GET'});
    const params = parameters(url);
    if (!params) return failure(400, 'INVALID_DISCOVERY_REQUEST',
      'Invalid supported chain or wallet address.', 'invalid');
    try {
      const db = env?.DISCOVERY_DB;
      if (!db || typeof db.prepare !== 'function' || !object(request.cf)
        || request.signal?.aborted) return unavailable();
      const ip = canonicalIp(request.headers.get('CF-Connecting-IP'));
      if (!ip) return unavailable();
      const admitted = await deadline(async () => {
        const hash = await hashClient(ip);
        return db.prepare(ADMIT_SQL)
          .bind(hash, params.get('wallet'), Number(params.get('chainId'))).first();
      }, DISCOVERY_LIMITS.gateTimeoutMs, request.signal);
      if (admitted === null) return failure(429, 'DISCOVERY_RATE_LIMITED',
        'Token discovery limit reached. Retry shortly or enter tokens manually.',
        'denied', {'retry-after': '60'});
      if (!object(admitted) || !Number.isSafeInteger(admitted.id) || admitted.id <= 0
        || request.signal?.aborted) return unavailable();
      cleanup(db, ctx);
      // Deliberately after the completed admission, including all alias lookups.
      const providerEnv = {};
      for (const key of DISCOVERY_PROVIDER_KEYS) {
        const value = env[key];
        if (value !== undefined && typeof value !== 'string') return unavailable();
        if (value !== undefined) providerEnv[key] = value;
      }
      const reply = await deadline(signal => discoverTokens(params, providerEnv,
        {signal, budgetMs: DISCOVERY_LIMITS.helperBudgetMs}),
      DISCOVERY_LIMITS.providerTimeoutMs, request.signal);
      if (!object(reply) || !Number.isInteger(reply.status) || reply.status < 200
        || reply.status > 599 || !object(reply.data)) return unavailable();
      // Existing helper owns the safe JSON contract; never forward arbitrary
      // helper/provider headers (especially cache/CORS/credential headers).
      return json(reply.status, reply.data, 'admitted');
    } catch { return unavailable(); }
  };
}
