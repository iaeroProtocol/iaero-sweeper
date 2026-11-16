// Display/review safeguards only. Execution caps, floors and venue proofs live in
// sweep-guards/base-native-sweep and remain independently authoritative.
export const VALUE_REVIEW_LIMIT_PERCENT = 5;
export const INDEPENDENT_PRICE_MAX_AGE_MS = 5 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 60 * 1000;

export type IndependentPrice = {
  chainId: number;
  token: string;
  price: number;
  source: 'defillama' | 'coingecko';
  observedAt: number;
  retrievedAt: number;
  timeBasis: 'provider-time' | 'retrieval-time';
};

export function independentPrice(input: {
  chainId: number; token: string; price: unknown; source: string;
  retrievedAt: number; observedAt?: number;
}, now = Date.now()): IndependentPrice | undefined {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0 ||
      !/^0x[0-9a-f]{40}$/i.test(input.token) ||
      (input.source !== 'defillama' && input.source !== 'coingecko') ||
      typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price <= 0) return;
  const observedAt = input.observedAt ?? input.retrievedAt;
  for (const time of [observedAt, input.retrievedAt]) {
    if (!Number.isSafeInteger(time) || time <= 0 || time > now + FUTURE_TOLERANCE_MS || now - time > INDEPENDENT_PRICE_MAX_AGE_MS) return;
  }
  return {chainId: input.chainId, token: input.token.toLowerCase(), price: input.price,
    source: input.source, observedAt, retrievedAt: input.retrievedAt,
    timeBasis: input.observedAt === undefined ? 'retrieval-time' : 'provider-time'};
}

export function currentIndependentPrice(value: IndependentPrice | undefined, chainId: number, token: string, now = Date.now()): IndependentPrice | undefined {
  if (!value || value.chainId !== chainId || value.token !== token.toLowerCase() ||
      (value.timeBasis !== 'provider-time' && value.timeBasis !== 'retrieval-time')) return;
  // Validate the original observation; reading from cache never restarts its age.
  return independentPrice({...value, observedAt: value.observedAt}, now) ? value : undefined;
}

export type QuoteValueQuality = {
  readonly scopeKey: string;
  reviewKey: string;
  routeCostPercent: number | null;
  inputUsd: number | null;
  outputUsd: number | null;
  independentLossPercent: number | null;
  maximumLossAtMinimumPercent: number | null;
  defaultSelected: boolean;
};
export type ValueRiskConsent = {
  kind: 'independent-loss'; reviewKey: string; maximumLossPercent: number;
} | {
  kind: 'valuation-unavailable'; reviewKey: string;
};

export function assessQuoteValue(input: {
  context: string; chainId: number; tokenIn: string; tokenOut: string;
  inputUnits: number; outputUnits: number; minimumOutputUnits: number;
  inputPrice?: IndependentPrice; outputPrice?: IndependentPrice;
  routeCostPercent: number; now?: number;
}): QuoteValueQuality {
  const now = input.now ?? Date.now();
  const inputPrice = currentIndependentPrice(input.inputPrice, input.chainId, input.tokenIn, now);
  const outputPrice = currentIndependentPrice(input.outputPrice, input.chainId, input.tokenOut, now);
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  const valued = inputPrice && outputPrice && positive(input.inputUnits) && positive(input.outputUnits) &&
    positive(input.minimumOutputUnits) && input.minimumOutputUnits <= input.outputUnits;
  const inputUsd = valued ? input.inputUnits * inputPrice.price : NaN;
  const outputUsd = valued ? input.outputUnits * outputPrice.price : NaN;
  const minimumUsd = valued ? input.minimumOutputUnits * outputPrice.price : NaN;
  const known = positive(inputUsd) && positive(outputUsd) && positive(minimumUsd);
  const loss = known ? Math.max(0, (1 - outputUsd / inputUsd) * 100) : null;
  const minimumLoss = known ? Math.max(0, (1 - minimumUsd / inputUsd) * 100) : null;
  const cost = Number.isFinite(input.routeCostPercent) && input.routeCostPercent >= 0 ? input.routeCostPercent : null;
  const scope = [input.context, input.chainId, input.tokenIn.toLowerCase(), input.tokenOut.toLowerCase()];
  return {
    scopeKey: JSON.stringify(scope),
    reviewKey: JSON.stringify([...scope, inputPrice ?? null, outputPrice ?? null]),
    routeCostPercent: cost, inputUsd: known ? inputUsd : null, outputUsd: known ? outputUsd : null,
    independentLossPercent: loss, maximumLossAtMinimumPercent: minimumLoss,
    defaultSelected: cost !== null && cost <= VALUE_REVIEW_LIMIT_PERCENT && loss !== null && loss <= VALUE_REVIEW_LIMIT_PERCENT,
  };
}

export function acceptValueRisk(quality: QuoteValueQuality): ValueRiskConsent {
  if (quality.independentLossPercent === null) return {kind: 'valuation-unavailable', reviewKey: quality.reviewKey};
  if (quality.maximumLossAtMinimumPercent === null) throw new Error('Independent valuation must be reviewed again.');
  return {kind: 'independent-loss', reviewKey: quality.reviewKey, maximumLossPercent: quality.maximumLossAtMinimumPercent};
}

export function quoteValueExecutable(quality: QuoteValueQuality, consent?: ValueRiskConsent): boolean {
  if (quality.routeCostPercent === null || quality.routeCostPercent > VALUE_REVIEW_LIMIT_PERCENT) return false;
  if (quality.defaultSelected) return true;
  if (!consent || consent.reviewKey !== quality.reviewKey) return false;
  if (quality.independentLossPercent === null) return consent.kind === 'valuation-unavailable';
  return consent.kind === 'independent-loss' && Number.isFinite(consent.maximumLossPercent) &&
    quality.independentLossPercent <= consent.maximumLossPercent;
}

export function assertRefreshedQuoteValue(original: QuoteValueQuality, fresh: QuoteValueQuality, consent?: ValueRiskConsent): void {
  // Scope stays wallet/raw-cap/original-floor/chain/asset bound while CURRENT
  // independent observations may renew. Consent still belongs exclusively to
  // the ORIGINAL price-bound reviewKey and its exact displayed floor-derived
  // ceiling; a renewed observation never creates or rewrites consent.
  const percent = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
  const originalConsent = consent === undefined || consent.reviewKey === original.reviewKey && (
    original.independentLossPercent === null
      ? consent.kind === 'valuation-unavailable'
      : consent.kind === 'independent-loss' && percent(original.maximumLossAtMinimumPercent)
        && consent.maximumLossPercent === original.maximumLossAtMinimumPercent
  );
  const sameScope = typeof original.scopeKey === 'string' && original.scopeKey.length > 0
    && original.scopeKey === fresh.scopeKey;
  const freshCostAllowed = percent(fresh.routeCostPercent) && fresh.routeCostPercent <= VALUE_REVIEW_LIMIT_PERCENT;
  const freshFair = percent(fresh.independentLossPercent) && fresh.independentLossPercent <= VALUE_REVIEW_LIMIT_PERCENT;
  let valueAllowed = false;
  if (original.independentLossPercent === null) {
    // Explicitly accepted unknown risk may remain unknown or improve to a fair
    // known estimate. It cannot authorize newly discovered severe known loss.
    valueAllowed = consent?.kind === 'valuation-unavailable'
      && (fresh.independentLossPercent === null || freshFair);
  } else if (percent(original.independentLossPercent) && original.independentLossPercent <= VALUE_REVIEW_LIMIT_PERCENT) {
    // A fair review retains its existing5% band, rather than freezing the exact
    // original displayed percentage. Raw execution floors remain independent.
    valueAllowed = freshFair;
  } else if (percent(original.independentLossPercent) && consent?.kind === 'independent-loss'
    && percent(original.maximumLossAtMinimumPercent)) {
    // Both the new quote AND the already-reviewed raw minimum must stay inside
    // the original explicit maximum under current independent prices.
    valueAllowed = percent(fresh.independentLossPercent) && percent(fresh.maximumLossAtMinimumPercent)
      && fresh.independentLossPercent <= original.maximumLossAtMinimumPercent
      && fresh.maximumLossAtMinimumPercent <= original.maximumLossAtMinimumPercent;
  }
  if (!sameScope || !originalConsent || !quoteValueExecutable(original, consent) || !freshCostAllowed || !valueAllowed) {
    throw new Error('Independent value or route cost changed beyond this review. Review a new quote.');
  }
}
