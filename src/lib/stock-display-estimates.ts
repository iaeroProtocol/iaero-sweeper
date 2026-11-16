import type {Address} from 'viem';
import {BASE_STOCK_DISPLAY_ADDRESSES} from './sweep-inventory';
import {currentIndependentPrice, type IndependentPrice} from './sweep-value-quality';

// Display only: native net USDC estimates are never independent stock prices,
// trading permission, approval data or executable cached quotes.
export const STOCK_DISPLAY_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const;
const allowed = new Set(BASE_STOCK_DISPLAY_ADDRESSES);
const uint = (value: unknown): value is bigint => typeof value === 'bigint' && value > 0n && value < 2n ** 256n;
const accountAddress = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const units = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 36;
const fresh = (quotedAt: unknown, now: number): quotedAt is number => typeof quotedAt === 'number' && Number.isSafeInteger(quotedAt) && quotedAt > 0 && Number.isSafeInteger(now) && now > 0 && quotedAt <= now + 5000 && now - quotedAt <= 120000;

export type StockDisplayInput = {token: string; decimals: number; unitsVerified: boolean; balance: bigint};
export type StockDisplayQuoteRequest = {account: Address; tokenIn: Address; tokenOut: typeof STOCK_DISPLAY_USDC; amountIn: bigint; decimals: number};
export type StockDisplayQuote = {account: string; tokenIn: string; tokenOut: string; amountIn: bigint; decimals: number | null; netAmountOut: bigint; quotedAt: number};
export type StockDisplayEstimate = Readonly<{
  account: string; chainId: 8453; token: string; decimals: number;
  balance: bigint; usdcAmount: bigint; quotedAt: number;
  usdcPrice?: Readonly<IndependentPrice>;
}>;
export type StockDisplayOptions = {
  chainId: number; account: string; inputs: readonly StockDisplayInput[];
  usdcPrice?: IndependentPrice;
  quote: (request: StockDisplayQuoteRequest) => Promise<StockDisplayQuote | null | undefined>;
  shouldContinue?: () => boolean;
  onEstimate?: (estimate: StockDisplayEstimate) => void;
  now?: () => number;
};

/**
 * At most14 exact catalog tokens and two concurrent injected native reads.
 * The caller supplies ONE verified Base native session shared by all callbacks.
 * Cancellation suppresses queued work and late publication; an in-flight read
 * may finish. No timers, provider APIs, keys, approvals or transaction methods.
 */
export async function runStockDisplayEstimates(options: StockDisplayOptions): Promise<Readonly<Record<string, StockDisplayEstimate>>> {
  const empty = () => Object.freeze({}) as Readonly<Record<string, StockDisplayEstimate>>;
  const active = () => { try { return options.shouldContinue?.() !== false; } catch { return false; } };
  if (options.chainId !== 8453 || !accountAddress(options.account) || !active()) return empty();
  const account = options.account.toLowerCase(), selected = new Map<string, StockDisplayInput>();
  for (const input of options.inputs) {
    if (!active()) return empty();
    if (typeof input?.token !== 'string' || !allowed.has(input.token.toLowerCase()) || input.unitsVerified !== true || !units(input.decimals) || !uint(input.balance)) continue;
    const token = input.token.toLowerCase();
    if (!selected.has(token)) selected.set(token, {token, decimals: input.decimals, unitsVerified: true, balance: input.balance});
    if (selected.size === 14) break;
  }
  const inputs = [...selected.values()], results: Record<string, StockDisplayEstimate> = {};
  const now = options.now ?? Date.now;
  let next = 0;
  await Promise.all(Array.from({length: Math.min(2, inputs.length)}, async () => {
    while (active()) {
      const input = inputs[next++];
      if (!input || !active()) return;
      try {
        const quoted = await options.quote({account: account as Address, tokenIn: input.token as Address, tokenOut: STOCK_DISPLAY_USDC, amountIn: input.balance, decimals: input.decimals});
        if (!active() || !quoted || !same(quoted.account, account) || !same(quoted.tokenIn, input.token) || !same(quoted.tokenOut, STOCK_DISPLAY_USDC) || quoted.amountIn !== input.balance || quoted.decimals !== input.decimals || !uint(quoted.netAmountOut) || !fresh(quoted.quotedAt, now())) continue;
        const conversion = currentIndependentPrice(options.usdcPrice, 8453, STOCK_DISPLAY_USDC, now());
        const estimate: StockDisplayEstimate = Object.freeze({account, chainId: 8453, token: input.token, decimals: input.decimals, balance: input.balance, usdcAmount: quoted.netAmountOut, quotedAt: quoted.quotedAt,
          ...(conversion ? {usdcPrice: Object.freeze({...conversion})} : {})});
        if (!active()) return;
        results[input.token] = estimate;
        if (options.onEstimate && active()) { try { options.onEstimate(estimate); } catch { /* Display callback failure cannot change other estimates. */ } }
      } catch { /* Independent route/read failure leaves this display unknown. */ }
    }
  }));
  return active() ? Object.freeze({...results}) : empty();
}

export type StockDisplayContext = {
  chainId: number; account: string; token: string; decimals: number;
  unitsVerified: boolean; balance: bigint; amount?: bigint;
  now?: number | (() => number);
};
export type StockDisplayValue = Readonly<{usdcUnits: bigint; valueUsd: number | null; priceUsd: number | null}>;

/** Raw6-decimal USDC; optional custom amount is only an indicative pro-rata view. */
export function stockDisplayValue(estimate: StockDisplayEstimate | undefined, context: StockDisplayContext): StockDisplayValue | undefined {
  const now = typeof context.now === 'function' ? context.now() : context.now ?? Date.now();
  if (!estimate || context.chainId !== 8453 || estimate.chainId !== 8453 || !accountAddress(context.account) || !same(estimate.account, context.account) || typeof context.token !== 'string' || !allowed.has(context.token.toLowerCase()) || !same(estimate.token, context.token) || context.unitsVerified !== true || !units(context.decimals) || estimate.decimals !== context.decimals || !uint(context.balance) || estimate.balance !== context.balance || !uint(estimate.usdcAmount) || !fresh(estimate.quotedAt, now)) return;
  const amount = context.amount ?? context.balance;
  if (!uint(amount) || amount > context.balance) return;
  const usdcUnits = estimate.usdcAmount * amount / context.balance;
  if (usdcUnits <= 0n) return;
  const conversion = currentIndependentPrice(estimate.usdcPrice, 8453, STOCK_DISPLAY_USDC, now);
  let valueUsd: number | null = null, priceUsd: number | null = null;
  if (conversion) {
    const value = Number(usdcUnits) / 1e6 * conversion.price;
    const unit = (Number(estimate.usdcAmount) / 1e6 * conversion.price) / (Number(context.balance) / 10 ** context.decimals);
    if (Number.isFinite(value) && value > 0 && Number.isFinite(unit) && unit > 0) { valueUsd = value; priceUsd = unit; }
  }
  return Object.freeze({usdcUnits, valueUsd, priceUsd});
}
