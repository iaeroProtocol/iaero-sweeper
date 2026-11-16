# Discovery guard: review candidate; publication held

Public discovery is admitted by the native Cloudflare Pages Worker, before any
provider credential binding is read. One shared D1 primary performs an atomic
write that checks all rolling quotas: client 6/minute and 60/hour; wallet across
chains 3/minute and 30/hour; global 120/hour and 500/day. Rotating IPs or wallets
cannot exceed the global budget. A scan can make at most 12 keyed provider calls
(10 Alchemy pages, one Moralis, one explorer); failures retain the admission.
Denials are 429 with Retry-After; missing guards/bindings/schema or a failed
admission are 503, with no provider call. An unavailable scan preserves the
wallet's displayed tokens, and manual entry remains available.

The browser performs no quota requests at startup. A normal connected-wallet
discovery adds one D1 write; there is no per-token admission fanout. Provider
work retains its existing 7.8-second bound. Only hashes of canonical client IPs
are stored. The hash is pseudonymous, not an anonymity guarantee.

The Next discovery route always returns 503 without loading discovery or keys.
Consequently an omitted Worker wrapper, a normalized alternate path or an
alternate plain Next deployment cannot bypass admission. The production
dispatcher must receive the original native Request: it must never construct
request.cf or CF-Connecting-IP from an untrusted forwarding header. Public
Origin/CORS headers are not authorization.

## Build and verify locally

Install the lockfile, preserve the existing public WalletConnect project ID,
then use `npm run build:pages`. This retains the existing next-on-pages adapter
and adds the required guarded entry. `npm run check:pages` verifies the wrapper,
bundle and original entry against their hashes, ties the bundle to its source,
and rejects local user paths. `npm run build` alone is a plain Next build with
discovery unavailable. Do not publish its output as a complete release.

The adapter is pinned at 1.13.16. Its declared Next peer range ends at 15.5.2;
this application deliberately retains patched Next 15.5.29. A successful actual
adapter build/runtime check is required; do not downgrade to bypass that gate.

## Owner-approved hosting steps, after outside review

No database has been provisioned and no hosted configuration has been changed
by this preparation. Local tests do not prove the current site's controls.

1. Provision a dedicated `iaero-sweeper-discovery` D1 database. Do not reuse an
   accounting/rewards database. Keep admission on its primary; no read replicas.
2. Apply `edge/discovery-schema.sql` to that database. Tables and all three
   indexes must exist before activation. Schema is never created by a request.
3. Bind that same database as `DISCOVERY_DB` on the Pages project and every
   public deployment/hostname serving this endpoint. Preserve the working
   server-side provider and 0x configuration. No new browser API key is needed.
   `edge/wrangler.pages.example.toml` is a placeholder reference, not deployable.
4. Change the Pages build command to `npm run build:pages`, preserving output
   `.vercel/output/static`, current nodejs_compat settings, and public
   WalletConnect project ID. Never use /functions middleware to guard advanced
   `_worker.js` mode: Cloudflare does not run it there.
5. On a separately authorized hosted candidate, prove missing binding/schema
   returns 503 and starts zero keyed calls. With the binding, observe admitted
   requests, then 429/Retry-After across concurrent clients sharing the database.
   Check the custom domain and pages.dev paths; examine provider usage without
   exposing credentials. Confirm cached-token/manual-entry behavior on denial.
6. Capture deployment ID, build/manifest hashes, binding/database ID, schema
   indexes and hosted test results for the auditor. Only after outside review
   and the owner's publication approval may the candidate replace production.

The existing production deployment is unchanged. Open outside findings are not
declared closed by source preparation or local tests.

Primary references:
- https://developers.cloudflare.com/pages/functions/advanced-mode/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- https://developers.cloudflare.com/fundamentals/reference/http-headers/
