// Shared by the builder and verifier: every provider implementation, admission
// rule, schema and inert fallback is bound into the compiled release manifest.
export const guardInputs = Object.freeze([
  'edge/discovery-gateway.mjs', 'edge/discovery-schema.sql',
  'edge/provider-budget.mjs', 'edge/provider-budget-schema.sql',
  'edge/keyed-api-gateway.mjs', 'edge/pages-dispatch.mjs',
  'src/lib/sweeper-read-api.ts', 'src/lib/coingecko-read-api.ts',
  'src/app/api/tokens/discover/route.ts', 'src/app/api/0x/quote/route.ts',
  'src/app/api/coingecko/prices/route.ts', 'scripts/pages-guard-contract.mjs',
]);
export const guardVersion = 'shared-d1-v2';
export const guardEntry = `// IAERO_KEYED_API_GUARD_V2 — mandatory shared admission before every keyed read.
import nextWorker from './iaero-next.mjs';
import {guardPages} from './iaero-discovery.mjs';
export default guardPages(nextWorker);
`;
