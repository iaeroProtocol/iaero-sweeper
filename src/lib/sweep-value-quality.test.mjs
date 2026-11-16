import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {independentPrice,currentIndependentPrice,assessQuoteValue,acceptValueRisk,quoteValueExecutable,assertRefreshedQuoteValue,INDEPENDENT_PRICE_MAX_AGE_MS} from './sweep-value-quality.ts';

const now=1_800_000_000_000;
const tokenIn='0x1111111111111111111111111111111111111111';
const tokenOut='0x2222222222222222222222222222222222222222';
const price=(token,value=1,extra={})=>independentPrice({chainId:8453,token,price:value,source:'defillama',retrievedAt:now,observedAt:now-1000,...extra},now);
const input={context:'8453:account:100:995',chainId:8453,tokenIn,tokenOut,inputUnits:100,outputUnits:99.9,minimumOutputUnits:99.5,inputPrice:price(tokenIn),outputPrice:price(tokenOut),routeCostPercent:0.1,now};

test('low native pool impact cannot hide a 90% independent value loss',()=>{
  const quote=assessQuoteValue({...input,outputUnits:10,minimumOutputUnits:9.95});
  assert.equal(quote.routeCostPercent,0.1);
  assert.equal(quote.independentLossPercent,90);
  assert.equal(quote.defaultSelected,false);
  assert.equal(quoteValueExecutable(quote),false);
  const consent=acceptValueRisk(quote);
  assert.equal(consent.kind,'independent-loss');
  assert.equal(consent.maximumLossPercent,90.05);
  assert.equal(quoteValueExecutable(quote,consent),true);
});

test('a fairly priced quote defaults only when both independent value and route cost pass',()=>{
  const fair=assessQuoteValue(input);
  assert.equal(fair.defaultSelected,true);
  assert.equal(quoteValueExecutable(fair),true);
  const expensiveRoute=assessQuoteValue({...input,routeCostPercent:5.01});
  assert.equal(expensiveRoute.defaultSelected,false);
  assert.equal(quoteValueExecutable(expensiveRoute,acceptValueRisk(expensiveRoute)),false);
});

test('unknown valuation is amber/unselected and needs its own review-bound consent',()=>{
  const unknown=assessQuoteValue({...input,inputPrice:undefined});
  assert.equal(unknown.inputUsd,null);
  assert.equal(unknown.independentLossPercent,null);
  assert.equal(unknown.defaultSelected,false);
  assert.equal(quoteValueExecutable(unknown),false);
  const consent=acceptValueRisk(unknown);
  assert.equal(consent.kind,'valuation-unavailable');
  assert.equal(quoteValueExecutable(unknown,consent),true);
  const severe=assessQuoteValue({...input,outputUnits:10,minimumOutputUnits:9.95});
  assert.equal(quoteValueExecutable(severe,consent),false);
  assert.throws(()=>assertRefreshedQuoteValue(unknown,severe,consent),/Review a new quote/);
});

test('old, future, nonfinite, wrong-chain/token, quote prices and pegs never become independent',()=>{
  for(const extra of [
    {source:'stablecoin'},{source:'zerox'},{source:'native'},
    {price:0},{price:-1},{price:Infinity},{price:NaN},{price:'1'},
    {observedAt:now-INDEPENDENT_PRICE_MAX_AGE_MS-1},
    {retrievedAt:now-INDEPENDENT_PRICE_MAX_AGE_MS-1},
    {observedAt:now+60_001},{observedAt:NaN},
  ])assert.equal(price(tokenIn,1,extra),undefined);
  const wrongChain=price(tokenIn,1,{chainId:1});
  assert.equal(currentIndependentPrice(wrongChain,8453,tokenIn,now),undefined);
  assert.equal(currentIndependentPrice(price(tokenOut),8453,tokenIn,now),undefined);
  assert.equal(assessQuoteValue({...input,inputPrice:wrongChain}).defaultSelected,false);
});

test('retrieval-time fallback is explicit, bounded, and cache reads never restart original age',()=>{
  const retrieved=independentPrice({chainId:8453,token:tokenIn,price:1,source:'coingecko',retrievedAt:now},now);
  assert.equal(retrieved.timeBasis,'retrieval-time');
  assert.equal(retrieved.observedAt,now);
  assert.equal(currentIndependentPrice(retrieved,8453,tokenIn,now+INDEPENDENT_PRICE_MAX_AGE_MS).retrievedAt,now);
  assert.equal(currentIndependentPrice(retrieved,8453,tokenIn,now+INDEPENDENT_PRICE_MAX_AGE_MS+1),undefined);
  assert.equal(assessQuoteValue({...input,inputPrice:retrieved,now:now+INDEPENDENT_PRICE_MAX_AGE_MS+1}).defaultSelected,false);
});

test('refresh allows harmless movement inside accepted bands but holds severe independent loss',()=>{
  const original=assessQuoteValue(input);
  assert.doesNotThrow(()=>assertRefreshedQuoteValue(original,assessQuoteValue({...input,outputUnits:99.7,routeCostPercent:0.3})));
  const collapsed=assessQuoteValue({...input,outputUnits:10,minimumOutputUnits:9.95,routeCostPercent:0.1});
  assert.throws(()=>assertRefreshedQuoteValue(original,collapsed),/Review a new quote/);
  const costIncreased=assessQuoteValue({...input,routeCostPercent:5.01});
  assert.throws(()=>assertRefreshedQuoteValue(original,costIncreased),/Review a new quote/);
});

test('high-loss consent allows only its displayed minimum and original price/scope observations',()=>{
  const base={...input,outputUnits:10,minimumOutputUnits:9.95};
  const original=assessQuoteValue(base),consent=acceptValueRisk(original);
  assert.doesNotThrow(()=>assertRefreshedQuoteValue(original,assessQuoteValue({...base,outputUnits:9.96}),consent));
  assert.throws(()=>assertRefreshedQuoteValue(original,assessQuoteValue({...base,outputUnits:9.94,minimumOutputUnits:9.94}),consent));
  for(const change of [{context:'different wallet/cap/floor'},{inputPrice:price(tokenIn,2)},{outputPrice:price(tokenOut,1,{observedAt:now-2000})},{inputPrice:undefined},{now:now+INDEPENDENT_PRICE_MAX_AGE_MS+1}]){
    assert.throws(()=>assertRefreshedQuoteValue(original,assessQuoteValue({...base,...change}),consent));
  }
});

test('page ties default, rendering, consent and every refresh to independent assessment',()=>{
  const page=readFileSync(new URL('../app/sweeper/page.tsx',import.meta.url),'utf8');
  assert.match(page,/selected:quality\.defaultSelected/);
  assert.match(page,/assertRefreshedQuoteValue\(q\.quality,quality,q\.riskConsent\)/);
  assert.match(page,/preserveMinimum\(q\.quote\.minimum,fresh\.buyAmount\)/);
  assert.match(page,/minimums:rows\.map\(q=>q\.quote\.minimum\)/);
  assert.match(page,/Independent value unavailable/);
  assert.match(page,/trade without independent valuation/);
  assert.match(page,/Pool cost/);
  assert.match(page,/Independent loss:/);
  assert.doesNotMatch(page,/forceHighSlippage|toggleForceSlippage/);
  assert.doesNotMatch(page,/outputPrice=outputToken==='USDC'\?1/);
});
