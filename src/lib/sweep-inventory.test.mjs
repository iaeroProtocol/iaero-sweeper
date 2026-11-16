import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STOCK_DISPLAY_ADDRESSES,inventoryHasDisplayPrice,isDisplayStock,sweepInventory} from './sweep-inventory.ts';
const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const token=(n,extra={})=>({address:address(n),symbol:'Token'+n,name:'Holding '+n,balance:1n,price:0,valueUsd:0,priceSource:'unknown',...extra});

test('all14 exact stock holdings remain in the initial50 despite hundreds of preceding unpriced/priced inputs',()=>{
  const unpriced=Array.from({length:120},(_,i)=>token(i+1));
  const priced=Array.from({length:60},(_,i)=>token(i+1000,{price:1,valueUsd:10_000-i,priceSource:'coingecko'}));
  const stocks=BASE_STOCK_DISPLAY_ADDRESSES.map((address,i)=>token(i+2000,{address,symbol:'Stock'+i}));
  const inputs=[...unpriced,...priced,...stocks],before=[...inputs],view=sweepInventory(inputs,{chainId:8453});
  assert.equal(view.rows.length,50);assert.equal(view.totalCount,194);assert.equal(view.unpricedCount,134);
  assert.deepEqual(new Set(view.rows.slice(0,14).map(t=>t.address)),new Set(BASE_STOCK_DISPLAY_ADDRESSES));
  assert.deepEqual(inputs,before,'Ranking does not reorder source holdings');
  for(const row of stocks){assert(view.rows.includes(row));assert.equal(row.price,0);assert.equal(row.priceSource,'unknown');assert.equal(row.balance,1n);}
});
test('arbitraryB20/nonstock and copied ticker do not obtain exact-address stock priority',()=>{
  const fake=token(1,{address:'0xb200'+'0'.repeat(35)+'1',symbol:'NVDAc'}),nonstock=token(2,{address:'0xb2000000000000000000004c27f6523082f41d01',symbol:'Basecat'});
  assert.equal(isDisplayStock(8453,fake.address),false);assert.equal(isDisplayStock(8453,nonstock.address),false);
  assert.equal(isDisplayStock(1,BASE_STOCK_DISPLAY_ADDRESSES[0]),false);
  assert.equal(isDisplayStock(8453,BASE_STOCK_DISPLAY_ADDRESSES[0].toUpperCase()),true);
  const real=token(3,{address:BASE_STOCK_DISPLAY_ADDRESSES[0]});
  assert.equal(sweepInventory([fake,nonstock,real],{chainId:8453,limit:1}).rows[0],real);
  assert.equal(sweepInventory([fake,nonstock],{chainId:8453}).totalCount,2,'Catalog never inserts a filtered/missing stock');
});
test('search runs across every positive holding before pagination, by name, ticker or address',()=>{
  const inputs=Array.from({length:140},(_,i)=>token(i+1));inputs[139]=token(140,{symbol:'RARE',name:'Ordinary unpriced holding'});
  for(const query of ['rare','Ordinary unpriced',address(140).toUpperCase()]){
    const view=sweepInventory(inputs,{chainId:8453,query,limit:50});assert.equal(view.matchingCount,1);assert.equal(view.rows[0],inputs[139]);
  }
  assert.equal(sweepInventory(inputs,{chainId:8453,query:'not-here'}).rows.length,0);
  assert.equal(sweepInventory(inputs,{chainId:8453,limit:100}).rows.length,100);
});
test('unpriced partition never invents zero-dollar estimates, selection, metadata or trade permission',()=>{
  const good=token(1,{price:2,valueUsd:3,priceSource:'defillama'});
  assert.equal(inventoryHasDisplayPrice(good),true);
  for(const change of [{price:0},{price:NaN},{price:Infinity},{valueUsd:NaN},{priceSource:'unknown'},{priceSource:undefined}])assert.equal(inventoryHasDisplayPrice({...good,...change}),false);
  const stock=Object.freeze(token(2,{address:BASE_STOCK_DISPLAY_ADDRESSES[0],decimals:null,unitsVerified:false}));
  const view=sweepInventory([stock,token(3,{balance:0n}),token(4,{balance:-1n})],{chainId:8453});
  assert.deepEqual(view.rows,[stock]);assert.equal(view.rows[0].decimals,null);assert.equal(view.rows[0].unitsVerified,false);assert.equal('selected' in view.rows[0],false);assert.equal(view.unpricedCount,1);
});
