// Fixed user-facing messages only: provider bodies, URLs and raw errors never
// become scan errors. Retry-After is advisory; retries remain user initiated.
export function discoveryFailureMessage(status: number, retryAfter: string | null, now = Date.now()): string {
  let seconds: number | undefined;
  if (retryAfter && /^\d{1,10}$/.test(retryAfter.trim())) seconds = Number(retryAfter.trim());
  else if (retryAfter) {
    const time = Date.parse(retryAfter);
    if (Number.isFinite(time)) seconds = Math.ceil((time - now) / 1000);
  }
  const retry = seconds !== undefined && seconds > 0 && seconds <= 86400 ? ` Retry in ${seconds} second${seconds === 1 ? '' : 's'}.` : ' Retry the scan shortly.';
  return (status === 429 ? 'Token discovery is rate limited.' : 'Token discovery is temporarily unavailable.') + retry;
}

export function discoveredTokenAddresses(data: unknown): `0x${string}`[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as {tokens?: unknown}).tokens)) throw new Error('Token discovery returned an invalid response. Retry the scan.');
  const tokens = (data as {tokens: unknown[]}).tokens;
  if (tokens.some(token => typeof token !== 'string' || !/^0x[0-9a-f]{40}$/i.test(token))) throw new Error('Token discovery returned an invalid response. Retry the scan.');
  return [...new Set(tokens.map(token => (token as string).toLowerCase() as `0x${string}`))];
}
