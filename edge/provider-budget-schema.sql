-- Apply to the same dedicated DISCOVERY_DB used by every provider route/isolate.
-- Existing discovery schema is separate and unchanged. Never create/migrate this
-- schema from a public request. Missing tables/indices fail admission closed.
CREATE TABLE IF NOT EXISTS provider_usage (
  id INTEGER PRIMARY KEY,
  client_hash TEXT NOT NULL CHECK (
    length(client_hash) = 64 AND client_hash NOT GLOB '*[^0-9a-f]*'
  ),
  route TEXT NOT NULL CHECK (route IN ('discovery', 'quote', 'prices')),
  units INTEGER NOT NULL CHECK (
    (route = 'discovery' AND units = 12)
    OR (route = 'quote' AND units = 1)
    OR (route = 'prices' AND units IN (1, 2))
  ),
  admitted_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (admitted_at >= 0)
) STRICT;

-- Cover weighted sums without reading unrelated identity/route rows.
CREATE INDEX IF NOT EXISTS provider_usage_client_time
  ON provider_usage (client_hash, admitted_at, units);
CREATE INDEX IF NOT EXISTS provider_usage_time
  ON provider_usage (admitted_at, units);

-- Best-effort handler cleanup deletes at most 64 rows older than 48h after each
-- successful reservation with ctx.waitUntil. No refunds or per-route quota
-- partitions: every weighted SUM covers discovery + quote + prices together.
-- Raw IPs, wallets and provider bindings are never stored in this table.
