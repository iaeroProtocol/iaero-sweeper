-- Apply to the ONE shared production D1 binding DISCOVERY_DB before enabling the
-- direct edge handler. Never auto-create this schema during a public request.
-- A missing table/index causes admission to fail closed, before provider access.
-- No IP addresses or provider credentials are stored here.
CREATE TABLE IF NOT EXISTS discovery_attempts (
  id INTEGER PRIMARY KEY,
  client_hash TEXT NOT NULL CHECK (
    length(client_hash) = 64 AND client_hash NOT GLOB '*[^0-9a-f]*'
  ),
  wallet TEXT NOT NULL CHECK (
    length(wallet) = 42 AND substr(wallet, 1, 2) = '0x'
    AND substr(wallet, 3) NOT GLOB '*[^0-9a-f]*'
    AND wallet <> '0x0000000000000000000000000000000000000000'
    AND wallet <> '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  ),
  chain_id INTEGER NOT NULL CHECK (
    chain_id IN (1, 8453, 42161, 10, 137, 56, 43114, 534352, 59144)
  ),
  admitted_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (admitted_at >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS discovery_attempts_client_time
  ON discovery_attempts (client_hash, admitted_at);
CREATE INDEX IF NOT EXISTS discovery_attempts_wallet_time
  ON discovery_attempts (wallet, admitted_at);
CREATE INDEX IF NOT EXISTS discovery_attempts_time
  ON discovery_attempts (admitted_at);

-- Handler cleanup is best effort: one DELETE of at most 64 rows older than 48h
-- per admitted request when ctx.waitUntil is available. Low/no traffic can leave
-- expired rows until a later admission. Quotas themselves only inspect the last
-- minute/hour/day, using DB unixepoch() exclusively; expired rows cannot deny
-- access. No separate SELECT-then-INSERT admission or per-isolate counters.
