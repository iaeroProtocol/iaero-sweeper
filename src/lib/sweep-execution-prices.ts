import {currentIndependentPrice, type IndependentPrice} from './sweep-value-quality';

export type ExecutionPriceInput = {
  address: string; decimals: number; balance: bigint; symbol: string;
  priceObservation?: IndependentPrice;
};
type PriceResponse = Record<string, {observation?: IndependentPrice}>;

/** Execution-local cache. Renew evidence, never its timestamps or trade consent. */
export function createExecutionPriceReader(options: {
  chainId: number;
  read: (inputs: ExecutionPriceInput[]) => Promise<PriceResponse>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const observations = new Map<string, IndependentPrice>();
  const unavailableAt = new Map<string, number>();
  return async (inputs: readonly ExecutionPriceInput[]) => {
    const unique = [...new Map(inputs.map(input => [input.address.toLowerCase(), input])).values()];
    const missing: ExecutionPriceInput[] = [];
    for (const input of unique) {
      const key = input.address.toLowerCase();
      const cached = currentIndependentPrice(observations.get(key), options.chainId, key, now());
      const supplied = currentIndependentPrice(input.priceObservation, options.chainId, key, now());
      if (cached || supplied) {
        observations.set(key, cached ?? supplied!);
      } else {
        observations.delete(key);
        const attempted = unavailableAt.get(key);
        if (attempted === undefined || now() - attempted >= 30_000) {
          unavailableAt.set(key, now());
          missing.push(input);
        }
      }
    }
    if (missing.length) {
      let prices: PriceResponse = {};
      try { prices = await options.read(missing); } catch { /* Unknown stays unknown; the review guard decides. */ }
      for (const input of missing) {
        const key = input.address.toLowerCase();
        const observation = currentIndependentPrice(prices[key]?.observation, options.chainId, key, now());
        if (observation) {
          observations.set(key, observation);
          unavailableAt.delete(key);
        }
      }
    }
    return new Map(unique.map(input => {
      const key = input.address.toLowerCase();
      return [key, currentIndependentPrice(observations.get(key), options.chainId, key, now())] as const;
    }));
  };
}
