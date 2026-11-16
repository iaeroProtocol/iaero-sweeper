import {createKeyedApiGateway} from './keyed-api-gateway.mjs';
import {createSolanaApiGateway} from './solana-api-gateway.mjs';

// Keep the original native Request and bindings intact. In particular, never
// manufacture request.cf from a browser-controlled header in this dispatcher.
export function withDiscoveryGuard(nextWorker, helpers) {
  if (typeof nextWorker?.fetch !== 'function') throw new TypeError('A Pages Worker is required');
  const gateway = createKeyedApiGateway(helpers);
  const solanaGateway = createSolanaApiGateway(helpers);
  return {
    ...nextWorker,
    async fetch(request, env, ctx) {
      const solana = await solanaGateway(request, env, ctx);
      if (solana) return solana;
      const guarded = await gateway(request, env, ctx);
      return guarded ?? nextWorker.fetch(request, env, ctx);
    },
  };
}
