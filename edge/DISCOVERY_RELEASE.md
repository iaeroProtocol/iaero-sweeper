# Shared provider guard: review candidate; publication HOLD

All three public keyed routes are admitted by the native Cloudflare Pages
Worker before their provider bindings are read. They share one D1 primary
weighted budget:

| Route | Fixed reservation | Maximum keyed calls per request |
| --- | --- | --- |
| GET /api/tokens/discover | 12 units | 10 Alchemy pages + one Moralis + one explorer |
| GET /api/0x/quote | 1 unit | One 0x quote; no retry or redirect |
| POST /api/coingecko/prices | ceil(unique addresses / 50), at most 2 | At most two concurrent calls, no retry or redirect |

Rolling shared client limits are 1024 units/minute, 4096/hour and 8192/day.
Rolling shared global limits are 4096/hour and 16384/day. One atomic primary
INSERT checks and debits every weighted sum using SQLite time. Rotating
wallets, chains or IPs cannot bypass the global totals. Reservation weights
are calculated by the handler; client headers/query fields never set them.
Failures and inner discovery denials keep the reservation. The limits count
maximum keyed calls, not dollars or provider price-plan credits.

Discovery additionally retains its unchanged per-client6/min60/hour,
per-wallet3/min30/hour and global120/hour500/day limits. It therefore makes
two D1 admissions per scan; quotes and price batches make one. No token scan,
quote or admission request is added before connection. Quote fanout remains
four. The existing116-token read workload fits the new shared budget; local
mock timings do not predict public-provider/network latency.

CoinGecko accepts only JSON up to8192 actual streamed bytes, supported integer
chain IDs and1–100 valid ERC20 addresses. Validation precedes admission and key
access; addresses are deduplicated/lowercased and requests with101 raw entries
are rejected even if duplicates. Each upstream batch has at most50 addresses,
a256KiB response cap and one shared3.5-second deadline. Provider429 is returned
without retries. Existing numeric-price provenance limits remain unchanged.

Missing binding/schema/index/native identity, failed or timed-out admission
fails closed before provider work. Excess work returns429/Retry-After60; missing
setup returns503. All THREE plain Next API fallbacks are inert503 handlers
without provider imports, credential access or fetch. An omitted wrapper,
normalized path or plain Next deployment cannot bypass the budgets. Existing
manual token entry and transaction wallet-scope/minimum-output guards remain.

Pass the original native Request. Never manufacture request.cf or trust a
browser-supplied forwarding header as native identity. Origin/CORS is not
authorization. Only domain-separated hashes of canonical IPs are stored; this
is pseudonymous storage, not an anonymity guarantee.

## Build and verify locally

Preserve the existing public WalletConnect project ID and use
`npm run build:pages`, with output `.vercel/output/static`. The builder pins
next-on-pages1.13.16 and Vercel59.1.3, retains patched Next15.5.29 and installs
the canonical v2 entry. `npm run check:pages` verifies12 source inputs, all
three inert fallbacks, the original Next entry and guarded bundle, and rejects
local user paths. `npm run build` alone leaves all keyed APIs unavailable.

For a fully offline adapter rebuild, install the separately supplied pinned
build-support/tool package with `npm ci --offline --ignore-scripts
--legacy-peer-deps --cache <supplied-cache>`. Set PAGES_BUILD_TOOLS to its package
folder and PAGES_BUILD_OFFLINE=1 when running `npm run build:pages`. Application
lockfile dependencies must already be installed/cached separately. The optional
cache is public npm build tooling only, separate from public site output.

Adapter peer metadata ends at Next15.5.2/Vercel47.0.4. The recorded offline build
actually succeeds with patched Next15.5.29 and pinned Vercel59.1.3. This is a
specific build/runtime result, not general upstream support. Do not downgrade
Next to satisfy old peer metadata. The fresh source release retains the npm
normalization that removes three obsolete optional nested React type records;
no existing runtime package version was changed.

## Hosting and independent review gates

The existing public deployment is unchanged. No database, migration, hosted
policy or Pages setting has been deployed by this preparation. Source tests
are not evidence of hosted controls or Claude adjudication.

1. Obtain the outside re-audit and the Auditor repository's required Claude
   adjudication. The OpenAI-origin M02 label remains provisional; source repair
   and internal review cannot issue that adjudication. Accept listed limitations
   and obtain separate owner publication approval.
2. Provision one dedicated `iaero-sweeper-discovery` D1 primary. Do not reuse an
   accounting database or enable replica reads for admission. Apply BOTH
   `edge/discovery-schema.sql` and `edge/provider-budget-schema.sql`. Both tables
   and all five indexes must exist before activation; public requests never
   migrate schema. Applying only the old discovery schema is insufficient.
3. Bind that SAME database as DISCOVERY_DB to all public routes/hostnames,
   including custom domains and pages.dev. Preserve server-only provider keys,
   0x fee configuration and the public WalletConnect ID. No new browser key.
   `edge/wrangler.pages.example.toml` remains an undeployable placeholder.
4. Set the build command to `npm run build:pages`; preserve output directory and
   nodejs_compat settings. Advanced `_worker.js` mode ignores /functions
   middleware, so it cannot supply the required guard.
5. On a separately authorized hosted candidate, verify absent binding/new table
   or index returns503 before ANY keyed quote, price or discovery call. Repeat
   valid requests across clients/regions, confirm weighted shared429 denial and
   zero additional provider calls, and reject101-address/oversized price bodies.
   Prove legitimate reads still work and inspect usage without exposing keys.
6. Record deployment/build/manifest hashes, database/binding/schema identifiers
   and hosted test results for the adjudicator. Only after the above approval
   gates may the candidate replace production. No private preview deployment
   has been authorized or performed by this work.

Primary references:
- https://developers.cloudflare.com/pages/functions/advanced-mode/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- https://developers.cloudflare.com/fundamentals/reference/http-headers/
