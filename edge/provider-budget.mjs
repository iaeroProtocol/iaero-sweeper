/**
 * Shared, weighted provider admission for the direct Cloudflare edge dispatcher.
 *
 * await admitProviderUsage(nativeRequest, env, ctx, {route, units}) returns null
 * ONLY after a completed atomic D1 reservation. Otherwise it returns a safe
 * 429/503 Response. The caller must return that Response before reading provider
 * keys or starting work. This module never invokes a callback/provider and reads
 * only env.DISCOVERY_DB. Pass the original trusted edge Request, never cf/IP
 * reconstructed from an untrusted header. Origin/CORS are not authorization.
 *
 * Apply provider-budget-schema.sql to the SAME shared DISCOVERY_DB used by all
 * routes/isolate instances. Schema/index/binding/identity/query/deadline failure
 * is closed. No request-time schema creation, memory quotas, cache or retry.
 * D1's primary performs one INSERT ... SELECT with all weighted SUM checks and
 * DB unixepoch() time; there is no separate read/check/write race.
 *
 * Fixed reservation weights: discovery=12; quote=1; prices=1 or 2. The dispatcher
 * validates inputs first and calculates prices as ceil(unique addresses / 50),
 * capped at 2. All three routes share the client and global unit totals. Credits
 * are never refunded, including inner discovery denials or provider failures.
 * A timed-out/cancelled write can finish later and debit credits, but cannot turn
 * the already-returned failure into permission to start work.
 *
 * Rolling client units: 1024/minute, 4096/hour, 8192/day.
 * Rolling global units: 4096/hour, 16384/day. These are reservations, not a claim
 * that providers always make that many calls. The caller must retain all helper
 * page/batch bounds. All gates share one dedicated production D1 database.
 *
 * Optional ctx.waitUntil performs bounded best-effort cleanup: at most 64 rows
 * older than 48h, with its own 1s deadline. Without traffic, expired rows can
 * remain until later cleanup; quota queries ignore them. Raw IPs are canonicalized
 * (IPv4/IPv6/mapped IPv4) then domain-separated SHA-256 hashed; never stored or
 * reflected. No secrets, identities, raw errors or counters enter responses.
 *
 * Failure headers: X-Provider-Budget=d1-v1, X-Provider-Budget-State=
 * denied|unavailable, Retry-After=60 and Cache-Control=no-store. On null, the
 * dispatcher can add the same version header and State=admitted to its response.
 *
 * Primary references:
 * https://developers.cloudflare.com/d1/worker-api/prepared-statements/
 * https://developers.cloudflare.com/d1/best-practices/read-replication/
 * https://developers.cloudflare.com/workers/runtime-apis/request/
 * https://developers.cloudflare.com/fundamentals/reference/http-headers/
 */

export const PROVIDER_BUDGET_LIMITS = Object.freeze({
  clientMinute: 1024,
  clientHour: 4096,
  clientDay: 8192,
  globalHour: 4096,
  globalDay: 16384,
  gateTimeoutMs: 1000,
  retentionSeconds: 172800,
  cleanupRows: 64,
});

const ADMIT_SQL = `
INSERT INTO provider_usage (client_hash, route, units, admitted_at)
SELECT ?1, ?2, ?3, unixepoch()
WHERE
  coalesce((SELECT sum(units) FROM provider_usage INDEXED BY provider_usage_client_time
    WHERE client_hash = ?1 AND admitted_at >= unixepoch() - 60), 0) + ?3 <= 1024
  AND coalesce((SELECT sum(units) FROM provider_usage INDEXED BY provider_usage_client_time
    WHERE client_hash = ?1 AND admitted_at >= unixepoch() - 3600), 0) + ?3 <= 4096
  AND coalesce((SELECT sum(units) FROM provider_usage INDEXED BY provider_usage_client_time
    WHERE client_hash = ?1 AND admitted_at >= unixepoch() - 86400), 0) + ?3 <= 8192
  AND coalesce((SELECT sum(units) FROM provider_usage INDEXED BY provider_usage_time
    WHERE admitted_at >= unixepoch() - 3600), 0) + ?3 <= 4096
  AND coalesce((SELECT sum(units) FROM provider_usage INDEXED BY provider_usage_time
    WHERE admitted_at >= unixepoch() - 86400), 0) + ?3 <= 16384
RETURNING id`;

const CLEANUP_SQL = `
DELETE FROM provider_usage WHERE id IN (
  SELECT id FROM provider_usage INDEXED BY provider_usage_time
  WHERE admitted_at < unixepoch() - 172800 ORDER BY admitted_at, id LIMIT 64
)`;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function failure(status) {
  const denied = status === 429;
  return new Response(JSON.stringify({
    code: denied ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_BUDGET_UNAVAILABLE',
    error: denied ? 'Service rate limit reached. Retry shortly.'
      : 'Service request admission is temporarily unavailable. Retry shortly.',
  }), {status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-provider-budget': 'd1-v1',
    'x-provider-budget-state': denied ? 'denied' : 'unavailable',
    'retry-after': '60',
  }});
}

function validUsage(route, units) {
  return Number.isSafeInteger(units) && (
    route === 'discovery' && units === 12
    || route === 'quote' && units === 1
    || route === 'prices' && (units === 1 || units === 2)
  );
}

function canonicalIp(value) {
  if (typeof value !== 'string' || value.length > 45) return null;
  if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value)) {
    return value.split('.').every(part => Number(part) <= 255) ? value : null;
  }
  if (!value.includes(':') || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  try {
    const host = new URL(`https://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const a = parseInt(mapped[1], 16), b = parseInt(mapped[2], 16);
      return [a >> 8, a & 255, b >> 8, b & 255].join('.');
    }
    return host;
  } catch { return null; }
}

async function clientHash(ip) {
  const digest = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode('iaero-provider-budget-client-v1\0' + ip));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function deadline(work, externalSignal) {
  const controller = new AbortController();
  let timer, cancel;
  try {
    const stopped = new Promise((_, reject) => {
      cancel = () => { controller.abort(); reject(new Error('Provider admission stopped')); };
      timer = setTimeout(cancel, PROVIDER_BUDGET_LIMITS.gateTimeoutMs);
      externalSignal?.addEventListener('abort', cancel, {once: true});
      if (externalSignal?.aborted) cancel();
    });
    const operation = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Provider admission cancelled');
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
  try {
    if (typeof ctx?.waitUntil !== 'function') return;
    const work = deadline(() => db.prepare(CLEANUP_SQL).run()).catch(() => {});
    ctx.waitUntil(work);
  } catch { /* Best effort only; never remove a valid reservation. */ }
}

export async function admitProviderUsage(request, env, ctx, usage) {
  try {
    const {route, units} = usage ?? {};
    if (!validUsage(route, units)) return failure(503);
    const db = env?.DISCOVERY_DB;
    if (!db || typeof db.prepare !== 'function' || !object(request.cf)
      || request.signal?.aborted) return failure(503);
    const ip = canonicalIp(request.headers.get('CF-Connecting-IP'));
    if (!ip) return failure(503);
    const admitted = await deadline(async signal => {
      const hash = await clientHash(ip);
      if (signal.aborted) throw new Error('Provider admission cancelled');
      return db.prepare(ADMIT_SQL).bind(hash, route, units).first();
    }, request.signal);
    if (request.signal?.aborted) return failure(503);
    if (admitted === null) return failure(429);
    if (!object(admitted) || !Number.isSafeInteger(admitted.id) || admitted.id <= 0) return failure(503);
    cleanup(db, ctx);
    return null;
  } catch { return failure(503); }
}
