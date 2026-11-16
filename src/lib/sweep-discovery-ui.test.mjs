import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {discoveryFailureMessage,discoveredTokenAddresses} from './sweep-discovery-ui.ts';
test('discovery HTTP failures expose only fixed safe retry information',()=>{
  assert.equal(discoveryFailureMessage(429,'30'),'Token discovery is rate limited. Retry in 30 seconds.');
  const now=Date.parse('2026-11-16T12:00:00Z');
  assert.match(discoveryFailureMessage(503,'Mon, 16 Nov 2026 12:01:00 GMT',now),/Retry in 60 seconds/);
  for(const value of [null,'https://secret.invalid/key','-1','0','9999999999','token=SECRET','Mon, 16 Nov 2026 11:59:00 GMT']){
    assert.equal(discoveryFailureMessage(503,value,now),'Token discovery is temporarily unavailable. Retry the scan shortly.');
  }
});
test('only a valid successful token list can represent an empty wallet',()=>{
  assert.deepEqual(discoveredTokenAddresses({tokens:[]}),[]);
  const token='0x'+'a'.repeat(40);
  assert.deepEqual(discoveredTokenAddresses({tokens:[token,token.toUpperCase().replace('0X','0x')]}),[token]);
  for(const value of [null,{},[],{error:'secret provider payload'},{tokens:[null]},{tokens:['0x123']},{tokens:['https://secret.invalid/key']}])assert.throws(()=>discoveredTokenAddresses(value),/^Error: Token discovery returned an invalid response\. Retry the scan\.$/);
});
test('page preserves displayed rows until discovery succeeds and propagates safe failures',()=>{
  const page=readFileSync(new URL('../app/sweeper/page.tsx',import.meta.url),'utf8');
  const scan=page.slice(page.indexOf('const scanWalletTokens ='),page.indexOf('// Reset scan state'));
  assert.doesNotMatch(scan.slice(0,scan.indexOf('try {')),/setTokens\(\[\]\)/);
  assert.match(page,/if\(!res\.ok\)throw new Error\(discoveryFailureMessage\(res\.status,res\.headers\.get\('Retry-After'\)\)\)/);
  assert.match(page,/const addresses=discoveredTokenAddresses\(data\)/);
  assert.match(page,/return addresses;/);
  assert.match(page,/Token discovery could not be reached\. Retry the scan\./);
});
