// Public runtime bytes are real; pool/getter/balance/AMM responses below are synthetic.
// This is offline control-flow/ABI coverage, not a live liquidity or execution claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodeAbiParameters,decodeFunctionData,encodeAbiParameters,encodeEventTopics,encodeFunctionResult,keccak256,parseAbi,stringToHex} from 'viem';
import {BASE_NATIVE,NATIVE_ABI,NATIVE_SWAP_PARAMS,NATIVE_FEE_PARAMS,createBaseNativeSweepSession,buildBaseNativeBatch,simulateBaseNativeBatch,recheckBaseNativeBatch} from './base-native-sweep.ts';
const fixtureBytes=await readFile(new URL('./base-native-runtime.fixture.json',import.meta.url));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'),'091faf69b0ac17987fe511a6e320241d4f4c8a969212bf720355db3834ce0c5a');
const fixture=JSON.parse(fixtureBytes),user='0x1111111111111111111111111111111111111111',token='0xb20000000000000000000078ee7ce2fe4908108c',pool='0x2222222222222222222222222222222222222222',out=BASE_NATIVE.usdc,factory=Object.keys(fixture.config.factoryRuntimePins)[0],zero='0x'+'0'.repeat(40);
const MC_ABI=parseAbi(['struct Call3 {address target;bool allowFailure;bytes callData;}','struct Result {bool success;bytes returnData;}','function aggregate3(Call3[] calls) payable returns(Result[] returnData)']);
const EVENT=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const same=(a,b)=>a.toLowerCase()===b.toLowerCase(),key=(t,a)=>t.toLowerCase()+':'+a.toLowerCase();
const transfer=(address,from,to,value)=>({address,topics:encodeEventTopics({abi:EVENT,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value])});
function environment(){
 const mode={routerBalance:0n,badRuntime:false,wrongPoolLinks:false,badPostBalance:false,corruptFee:false,wrongHeader:false},timestamp=BigInt(Math.floor(Date.now()/1000)),block={number:12345n,hash:'0x'+'99'.repeat(32),timestamp},balances=new Map([[key(token,user),200000000n],[key(out,user),1000000n],[key(out,BASE_NATIVE.feeRecipient),123n]]),recorded=[];
 const balance=(t,a,map=balances)=>same(a,BASE_NATIVE.router)?mode.routerBalance:map.get(key(t,a))??0n;
 const read=r=>{
  if(r.functionName==='FACTORY_REGISTRY')return BASE_NATIVE.registry;
  if(r.functionName==='isMetaRouterApproved')return true;
  if(r.functionName==='targetFactories')return[factory];
  if(r.functionName==='tickSpacings')throw Error('V2 factory has no CL spacings');
  if(r.functionName==='getPool')return r.args.map(x=>String(x).toLowerCase()).sort().join()===[token,out].sort().join()?pool:zero;
  if(r.functionName==='factory')return factory;
  if(r.functionName==='POOL_TYPE')return stringToHex('V2_VOLATILE',{size:32});
  if(r.functionName==='token0')return token;
  if(r.functionName==='token1')return mode.wrongPoolLinks?BASE_NATIVE.weth:out;
  if(r.functionName==='metadata')return[100000000n,1000000n,1000000000000n,10000000000n,token,mode.wrongPoolLinks?BASE_NATIVE.weth:out];
  if(r.functionName==='quoteExactInput')return[1000000n,[],[]];
  if(r.functionName==='balanceOf')return balance(r.address,r.args[0]);
  if(r.functionName==='allowance')return 0n;
  throw Error('Unsupported fixture getter '+r.functionName);
 };
 const client={getChainId:async()=>8453,getBlock:async request=>mode.wrongHeader&&request?.blockNumber?{...block,hash:'0x'+'00'.repeat(32)}:block,getCode:async request=>{recorded.push({kind:'code',...request});if(mode.badRuntime&&same(request.address,BASE_NATIVE.paymentsLibrary))return'0x6000';if(same(request.address,token))return'0x60006001';if(same(request.address,pool))return'0x60006000';return fixture.raw[request.address.toLowerCase()];},readContract:async request=>{recorded.push({kind:'read',...request});return read(request);},multicall:async request=>{recorded.push({kind:'multicall',...request});return request.contracts.map(r=>{try{return{status:'success',result:read(r)};}catch{return{status:'failure'};}});},simulateBlocks:async request=>{
  recorded.push({kind:'simulate',request});assert.equal(request.validation,false);assert.equal(request.blockNumber,block.number);assert.equal(request.blocks.length,1);assert(!('stateOverride'in request)&&!('stateOverrides'in request.blocks[0]));
  const simulated=new Map(balances),calls=[],allowance=new Map();let logs=[];
  for(const c of request.blocks[0].calls){
   if(same(c.to,BASE_NATIVE.multicall)){
    const decoded=decodeFunctionData({abi:MC_ABI,data:c.data});const result=decoded.args[0].map(r=>{const d=decodeFunctionData({abi:NATIVE_ABI,data:r.callData});let v=balance(r.target,d.args[0],simulated);if(mode.badPostBalance&&same(r.target,out)&&same(d.args[0],user))v-=1n;return{success:true,returnData:encodeFunctionResult({abi:NATIVE_ABI,functionName:'balanceOf',result:v})};});calls.push({status:'success',data:encodeFunctionResult({abi:MC_ABI,functionName:'aggregate3',result}),logs:[]});continue;
   }
   const decoded=decodeFunctionData({abi:NATIVE_ABI,data:c.data});
   if(decoded.functionName==='approve'){assert.equal(decoded.args[0].toLowerCase(),BASE_NATIVE.router);allowance.set(c.to.toLowerCase(),decoded.args[1]);calls.push({status:'success',data:encodeFunctionResult({abi:NATIVE_ABI,functionName:'approve',result:true}),logs:[]});continue;}
   assert.equal(decoded.functionName,'execute');assert.equal(c.account,user);assert.equal(c.value,0n);assert.equal(decoded.args[0],'0x080504');const [swap]=decodeAbiParameters(NATIVE_SWAP_PARAMS,decoded.args[1][0]),[feeToken,feeRecipient,portion]=decodeAbiParameters(NATIVE_FEE_PARAMS,decoded.args[1][1]),[sweepToken,recipient,netFloor]=decodeAbiParameters([{type:'address'},{type:'address'},{type:'uint256'}],decoded.args[1][2]);assert.equal(swap.amountIn.value,100000000n);assert.equal(swap.recipient.toLowerCase(),BASE_NATIVE.router);assert(allowance.get(token)>=swap.amountIn.value);const gross=1000000n,fee=gross*portion.value/1000000n,net=gross-fee;assert(gross>=swap.minAmountOut&&net>=netFloor);assert(same(feeToken,out)&&same(sweepToken,out));
   simulated.set(key(token,user),simulated.get(key(token,user))-swap.amountIn.value);simulated.set(key(out,recipient),simulated.get(key(out,recipient))+net);simulated.set(key(out,feeRecipient),simulated.get(key(out,feeRecipient))+fee);
   logs=[transfer(out,pool,BASE_NATIVE.router,gross),transfer(token,user,pool,swap.amountIn.value),transfer(out,BASE_NATIVE.router,mode.corruptFee?user:feeRecipient,fee),transfer(out,BASE_NATIVE.router,recipient,net)];calls.push({status:'success',data:'0x',logs});
  }
  return[{calls}];
 }};
 return{client,mode,recorded,balances};
}
const request={account:user,tokenIn:token,tokenOut:out,amountIn:100000000n,decimals:8,slippageBps:100};
test('real pinned runtime fixtures authenticate successful B20 discovery and complete exact-approval/fee/net simulation',async()=>{
 for(const[address,code]of Object.entries(fixture.raw))assert.equal(keccak256(code),fixture.hashes[address]);const e=environment(),session=createBaseNativeSweepSession(e.client,fixture.config),q=await session.quote(request);assert(q);assert.equal(q.amountIn,100000000n);assert.equal(q.decimals,8);assert.equal(q.grossAmountOut,1000000n);assert.equal(q.protocolFee,500n);assert.equal(q.netAmountOut,999500n);assert.equal(q.route.pools[0].factory,factory);const b=buildBaseNativeBatch([q],{account:user,deadline:BigInt(Math.floor(Date.now()/1000)+250)}),result=await simulateBaseNativeBatch(e.client,b,{account:user,withApprovals:true});assert.equal(result.netOutput,999500n);assert.equal(result.protocolFee,500n);assert.equal(result.syntheticStateOverrides,false);assert.equal(e.balances.get(key(token,user)),200000000n,'Simulation did not mutate real baseline');assert(e.recorded.filter(r=>r.kind==='code').every(r=>r.blockNumber===12345n));
});
test('fresh zero-custody, immutable runtime and actual post-state failures hold rather than submit',async()=>{
 const e=environment(),q=await createBaseNativeSweepSession(e.client,fixture.config).quote(request),b=buildBaseNativeBatch([q],{account:user,deadline:BigInt(Math.floor(Date.now()/1000)+250)});e.mode.routerBalance=1n;await assert.rejects(recheckBaseNativeBatch(e.client,b,user),/Pre-existing router custody/);e.mode.routerBalance=0n;e.mode.badRuntime=true;await assert.rejects(recheckBaseNativeBatch(e.client,b,user),/runtime changed/);e.mode.badRuntime=false;e.mode.badPostBalance=true;await assert.rejects(simulateBaseNativeBatch(e.client,b,{account:user,withApprovals:true}),/actual wallet\/fee balance/);e.mode.badPostBalance=false;e.mode.corruptFee=true;await assert.rejects(simulateBaseNativeBatch(e.client,b,{account:user,withApprovals:true}),/protocol fee mismatch/);
});
test('pool pair corruption and canonical header changes never produce an eligible quote',async()=>{
 const e=environment();e.mode.wrongPoolLinks=true;await assert.rejects(createBaseNativeSweepSession(e.client,fixture.config).quote(request),/No verified native route/);e.mode.wrongPoolLinks=false;e.mode.wrongHeader=true;await assert.rejects(createBaseNativeSweepSession(e.client,fixture.config).quote(request),/snapshot changed/);
});
