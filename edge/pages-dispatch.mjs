import {createDiscoveryGateway} from './discovery-gateway.mjs';

// Keep the original native Request and bindings intact. In particular, never
// manufacture request.cf from a browser-controlled header in this dispatcher.
export function withDiscoveryGuard(nextWorker, discoverTokens) {
  if (typeof nextWorker?.fetch !== 'function') throw new TypeError('A Pages Worker is required');
  const gateway = createDiscoveryGateway(discoverTokens);
  return {
    ...nextWorker,
    async fetch(request, env, ctx) {
      const guarded = await gateway(request, env, ctx);
      return guarded ?? nextWorker.fetch(request, env, ctx);
    },
  };
}
