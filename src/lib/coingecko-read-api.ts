// Server-side price reads only. The dispatcher owns body limits and atomic D1
// admission; it must admit parsed.cost BEFORE passing credential bindings here.
export const PRICE_PLATFORMS: Readonly<Record<number, string>> = Object.freeze({
  1: 'ethereum', 8453: 'base', 42161: 'arbitrum-one', 10: 'optimistic-ethereum',
  137: 'polygon-pos', 56: 'binance-smart-chain', 43114: 'avalanche',
  534352: 'scroll', 59144: 'linea',
});
export type ParsedPriceRequest = Readonly<{chainId: number; addresses: readonly string[]; cost: 1 | 2}>;
export type CoinGeckoReadEnv = {readonly COINGECKO_API_KEY?: string};
export type PriceReadOptions = {fetchImpl?: typeof fetch; signal?: AbortSignal; budgetMs?: number};
export type ApiResult = {
  status: number;
  data: {prices: Record<string, number>; logs: string[]; found: number; requested: number; code?: string; error?: string};
  headers: Record<string, string>;
};
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_BUDGET_MS = 3500;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value) && !/^0xe{40}$/i.test(value);

/** Strict public JSON shape. Raw count is bounded before deduplication/costing. */
export function parsePriceRequest(body: unknown): ParsedPriceRequest {
  try {
    if (!isObject(body) || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) throw new Error();
    const keys = Reflect.ownKeys(body);
    if (keys.length !== 2 || !keys.includes('chainId') || !keys.includes('addresses')) throw new Error();
    const {chainId, addresses} = body;
    if (typeof chainId !== 'number' || !Number.isSafeInteger(chainId) || !own(PRICE_PLATFORMS, chainId) ||
        !Array.isArray(addresses) || addresses.length < 1 || addresses.length > 100 || !Array.from(addresses).every(address)) throw new Error();
    const unique = Object.freeze([...new Set(addresses.map(value => value.toLowerCase()))]);
    return Object.freeze({chainId, addresses: unique, cost: unique.length <= 50 ? 1 : 2});
  } catch {
    throw new Error('Invalid price request.');
  }
}

function validateParsed(value: unknown): ParsedPriceRequest {
  if (!isObject(value) || Reflect.ownKeys(value).length !== 3 || Reflect.ownKeys(value).some(key => !['chainId', 'addresses', 'cost'].includes(String(key)))) throw new Error();
  const parsed = parsePriceRequest({chainId: value.chainId, addresses: value.addresses});
  if (value.cost !== parsed.cost) throw new Error();
  return parsed;
}

class PriceFailure extends Error {
  readonly code: 'PRICE_TIMEOUT' | 'PRICE_CANCELLED' | 'PRICE_TRANSPORT' | 'PRICE_INVALID_RESPONSE' | 'PRICE_RESPONSE_LIMIT' | 'PRICE_UPSTREAM' | 'PRICE_RATE_LIMITED';
  readonly retryAfter?: string;
  constructor(code: PriceFailure['code'], retryAfter?: string) {
    super(code);
    this.code = code; this.retryAfter = retryAfter;
  }
}
function failure(code: string, requested: number, status = 503, retryAfter?: string): ApiResult {
  return {status, data: {prices: {}, logs: ['coingecko: ' + code], found: 0, requested, code,
    error: status === 400 ? 'Invalid price request.' : status === 429 ? 'Price service limit reached. Retry shortly.' : 'Prices are temporarily unavailable. Retry shortly.'},
  headers: {'cache-control': 'no-store', ...(retryAfter ? {'retry-after': retryAfter} : {})}};
}
function safeRetryAfter(value: string | null): string {
  let seconds: number | undefined;
  if (value && /^\d{1,10}$/.test(value.trim())) seconds = Number(value.trim());
  else if (value) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) seconds = Math.ceil((date - Date.now()) / 1000);
  }
  return String(seconds !== undefined && seconds > 0 ? Math.min(300, seconds) : 30);
}
function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  try { void body?.cancel().catch(() => {}); } catch { /* Fixed errors only. */ }
}
function lifetime(options: PriceReadOptions) {
  const milliseconds = Number.isFinite(options.budgetMs) ? Math.min(MAX_BUDGET_MS, Math.max(1, Math.floor(options.budgetMs!))) : MAX_BUDGET_MS;
  const controller = new AbortController(), expiresAt = Date.now() + milliseconds;
  let reason: 'PRICE_TIMEOUT' | 'PRICE_CANCELLED' | undefined, rejectEnd!: (failure: PriceFailure) => void;
  const ended = new Promise<never>((_, reject) => { rejectEnd = reject; });
  const stop = (next: 'PRICE_TIMEOUT' | 'PRICE_CANCELLED') => {
    if (reason) return;
    reason = next; controller.abort(); rejectEnd(new PriceFailure(next));
  };
  const external = () => stop('PRICE_CANCELLED');
  const timer = setTimeout(() => stop('PRICE_TIMEOUT'), milliseconds);
  options.signal?.addEventListener('abort', external, {once: true});
  // The race handler is attached before dispatching any provider work.
  return {
    signal: controller.signal,
    check: () => { if (reason || Date.now() >= expiresAt) throw new PriceFailure(reason ?? 'PRICE_TIMEOUT'); },
    run: <T>(work: () => Promise<T>) => {
      const raced = Promise.race([Promise.resolve().then(() => {
        if (options.signal?.aborted) stop('PRICE_CANCELLED');
        if (reason) throw new PriceFailure(reason);
        return work();
      }), ended]);
      return raced;
    },
    close: () => { clearTimeout(timer); options.signal?.removeEventListener('abort', external); controller.abort(); },
  };
}

async function readBatch(fetcher: typeof fetch, chainId: number, addresses: readonly string[], key: string, signal: AbortSignal): Promise<Record<string, number>> {
  if (signal.aborted) throw new PriceFailure('PRICE_CANCELLED');
  const url = new URL('https://pro-api.coingecko.com/api/v3/simple/token_price/' + PRICE_PLATFORMS[chainId]);
  url.search = new URLSearchParams({contract_addresses: addresses.join(','), vs_currencies: 'usd'}).toString();
  let response: Response;
  try { response = await fetcher(url.href, {headers: {Accept: 'application/json', 'x-cg-pro-api-key': key}, signal, redirect: 'manual', cache: 'no-store'}); }
  catch { throw new PriceFailure(signal.aborted ? 'PRICE_CANCELLED' : 'PRICE_TRANSPORT'); }
  if (signal.aborted) { cancelBody(response.body); throw new PriceFailure('PRICE_CANCELLED'); }
  if (!response.ok || response.redirected) {
    cancelBody(response.body);
    if (response.status === 429) throw new PriceFailure('PRICE_RATE_LIMITED', safeRetryAfter(response.headers.get('retry-after')));
    throw new PriceFailure('PRICE_UPSTREAM');
  }
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) { cancelBody(response.body); throw new PriceFailure('PRICE_RESPONSE_LIMIT'); }
  const reader = response.body?.getReader();
  if (!reader) throw new PriceFailure('PRICE_INVALID_RESPONSE');
  const abortRead = () => { try { void reader.cancel().catch(() => {}); } catch { /* Fixed errors only. */ } };
  signal.addEventListener('abort', abortRead, {once: true});
  let text = '', bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      if (signal.aborted) throw new PriceFailure('PRICE_CANCELLED');
      const part = await reader.read();
      if (signal.aborted) throw new PriceFailure('PRICE_CANCELLED');
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { abortRead(); throw new PriceFailure('PRICE_RESPONSE_LIMIT'); }
      text += decoder.decode(part.value, {stream: true});
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof PriceFailure) throw error;
    throw new PriceFailure(signal.aborted ? 'PRICE_CANCELLED' : 'PRICE_INVALID_RESPONSE');
  } finally { signal.removeEventListener('abort', abortRead); reader.releaseLock(); }
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new PriceFailure('PRICE_INVALID_RESPONSE'); }
  if (!isObject(data) || own(data, 'error') || own(data, 'status')) throw new PriceFailure('PRICE_INVALID_RESPONSE');
  const requested = new Set(addresses), prices: Record<string, number> = {};
  for (const [token, record] of Object.entries(data)) {
    const lower = token.toLowerCase();
    if (requested.has(lower) && isObject(record) && typeof record.usd === 'number' && Number.isFinite(record.usd) && record.usd > 0) prices[lower] = record.usd;
  }
  return prices;
}

/** Call only after dispatcher admission. No retry, redirect, partial result or sleep. */
export async function handlePriceRequest(value: unknown, env: CoinGeckoReadEnv, options: PriceReadOptions = {}): Promise<ApiResult> {
  let parsed: ParsedPriceRequest;
  try { parsed = validateParsed(value); } catch { return failure('INVALID_PRICE_REQUEST', 0, 400); }
  const requested = parsed.addresses.length;
  if (options.signal?.aborted) return failure('PRICE_CANCELLED', requested);
  let key: string | undefined;
  try { key = env.COINGECKO_API_KEY; } catch { return failure('PRICE_UNAVAILABLE', requested); }
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(key)) return failure('PRICE_UNAVAILABLE', requested);
  const life = lifetime(options), fetcher = options.fetchImpl ?? fetch;
  try {
    const batches = [parsed.addresses.slice(0, 50), ...(parsed.addresses.length > 50 ? [parsed.addresses.slice(50)] : [])];
    const values = await life.run(() => Promise.all(batches.map(batch => readBatch(fetcher, parsed.chainId, batch, key!, life.signal))));
    life.check();
    const prices = Object.assign({}, ...values) as Record<string, number>, found = Object.keys(prices).length;
    return {status: 200, data: {prices, logs: [`coingecko: complete; ${found} of ${requested} prices.`], found, requested}, headers: {'cache-control': 'no-store'}};
  } catch (error) {
    const problem = error instanceof PriceFailure ? error : new PriceFailure('PRICE_INVALID_RESPONSE');
    return failure(problem.code, requested, problem.code === 'PRICE_RATE_LIMITED' ? 429 : 503, problem.retryAfter);
  } finally { life.close(); }
}
