// Display ordering only. These exact Base stock addresses were positive,
// units-verified holdings in STOCK_INVENTORY_C18.json (2026-11-16). This list
// adds no token, metadata, price, spam exemption or execution permission.
export const BASE_STOCK_DISPLAY_ADDRESSES: readonly string[] = Object.freeze([
  '0xb2000000000000000000000d8ce462e99ee7a47b', // AMDc
  '0xb200000000000000000000187f7071d6e321a7d2', // SKHYc
  '0xb2000000000000000000001e800a7f5189430cd0', // TSLAc
  '0xb2000000000000000000002d0ba3164cc74f58b7', // GOOGLc
  '0xb200000000000000000000397293cb8cda9a10c5', // SNDKc
  '0xb2000000000000000000004884b426556b92883d', // MSTRc
  '0xb20000000000000000000078ee7ce2fe4908108c', // NVDAc
  '0xb2000000000000000000007b9fcbd005511acbd5', // SPCXc
  '0xb2000000000000000000007d16372840df4dabbe', // PLTRc
  '0xb2000000000000000000008bc8786b856e61707c', // METAc
  '0xb200000000000000000000ab99cfa739e253872b', // MSFTc
  '0xb200000000000000000000c2e324d24d7eecd1fb', // AAPLc
  '0xb200000000000000000000d9192b6b456483c2e8', // AMZNc
  '0xb200000000000000000000fd2f87532b90095211', // MUc
]);
const stockAddresses = new Set(BASE_STOCK_DISPLAY_ADDRESSES);
export type SweepInventoryToken = {address: string; symbol: string; name: string; balance: bigint; price: number; valueUsd: number; priceSource?: string};
export function inventoryHasDisplayPrice(token: SweepInventoryToken): boolean {
  return token.priceSource !== undefined && token.priceSource !== 'unknown' && Number.isFinite(token.price) && token.price > 0 && Number.isFinite(token.valueUsd) && token.valueUsd >= 0;
}
export function isDisplayStock(chainId: number, address: string): boolean {
  return chainId === 8453 && stockAddresses.has(address.toLowerCase());
}
/** Search all positive holdings before slicing. No network, selection or mutation. */
export function sweepInventory<T extends SweepInventoryToken>(tokens: readonly T[], options: {chainId: number; query?: string; limit?: number}) {
  const query = (options.query ?? '').trim().toLowerCase().slice(0, 128);
  const positive = tokens.filter(token => token.balance > 0n);
  const matching = positive.filter(token => !query || [token.symbol, token.name, token.address].some(value => value.toLowerCase().includes(query)));
  const ranked = [...matching].sort((a, b) => {
    const stockA = isDisplayStock(options.chainId, a.address), stockB = isDisplayStock(options.chainId, b.address);
    if (stockA !== stockB) return stockA ? -1 : 1;
    const pricedA = inventoryHasDisplayPrice(a), pricedB = inventoryHasDisplayPrice(b);
    if (pricedA !== pricedB) return pricedA ? -1 : 1;
    if (pricedA && a.valueUsd !== b.valueUsd) return a.valueUsd > b.valueUsd ? -1 : 1;
    return a.symbol.localeCompare(b.symbol) || a.address.toLowerCase().localeCompare(b.address.toLowerCase());
  });
  const limit = Number.isSafeInteger(options.limit) && options.limit! > 0 ? Math.min(10000, options.limit!) : 50;
  return {rows: ranked.slice(0, limit), matchingCount: matching.length, totalCount: positive.length, unpricedCount: positive.filter(token => !inventoryHasDisplayPrice(token)).length};
}
