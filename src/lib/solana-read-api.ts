import {PublicKey} from '@solana/web3.js';
import {associatedToken, base64Bytes, object, rawU64, solanaAddress, solanaSignature, validateSolanaQuote, validateJupiterRoute, validateSolanaAccountProofs, assertSolanaReview,
  solanaFinalizedProof,solanaSignatureProof,assertSolanaStatusAgreement,
  SOLANA_USDC, SOLANA_WSOL, SOLANA_MAINNET, SPL_TOKEN, JUPITER_PROGRAM, SOLANA_FEE_WALLET, type SolanaQuote} from './solana-intent';

type ApiResult = {status: number; data: Record<string, any>; headers?: Record<string, string>};
type Options = {fetchImpl?: typeof fetch; signal?: AbortSignal; now?: () => number};
export type SolanaOperation = 'status' | 'discover' | 'quote' | 'construct' | 'reconcile';
const OUTPUTS = [SOLANA_USDC, SOLANA_WSOL];
const exactKeys = (o: Record<string, any>, keys: string[]) => Object.keys(o).every(k => keys.includes(k)) && keys.every(k => Object.prototype.hasOwnProperty.call(o, k));
const safeInteger = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
export function parseSolanaRequest(operation: SolanaOperation, body: unknown): Record<string, any> | null {
  try {
    if (!object(body)) return null;
    if (operation === 'status') return exactKeys(body, []) ? {} : null;
    if (operation === 'discover') return exactKeys(body, ['wallet']) ? {wallet: solanaAddress(body.wallet)} : null;
    if (operation === 'quote') {
      if (!exactKeys(body, ['wallet','inputMint','outputMint','amount','slippageBps']) || !safeInteger(body.slippageBps, 10, 500)) return null;
      const p = {wallet: solanaAddress(body.wallet), inputMint: solanaAddress(body.inputMint), outputMint: solanaAddress(body.outputMint), amount: rawU64(body.amount).toString(), slippageBps: body.slippageBps};
      if (p.inputMint === p.outputMint || !OUTPUTS.includes(p.outputMint)) return null; return p;
    }
    if (operation === 'construct') {
      if (!exactKeys(body, ['intent','quote']) || !object(body.intent) || !object(body.quote)) return null;
      const i = body.intent;
      if (!exactKeys(i, ['version','network','account','inputMint','outputMint','inputAmount','inputDecimals','outputDecimals','minimumOut','reviewedOut','reviewedImpact','forceConsent','reviewedAt','slippageBps'])
        || i.version !== 1 || i.network !== SOLANA_MAINNET || !OUTPUTS.includes(solanaAddress(i.outputMint)) || !safeInteger(i.slippageBps,10,500)
        || !safeInteger(i.inputDecimals,0,18) || i.outputDecimals !== (i.outputMint === SOLANA_USDC ? 6 : 9)
        || typeof i.forceConsent !== 'boolean' || !safeInteger(i.reviewedAt,1,Number.MAX_SAFE_INTEGER)
        || typeof i.reviewedImpact !== 'number' || !Number.isFinite(i.reviewedImpact) || i.reviewedImpact < 0 || i.reviewedImpact > 100) return null;
      solanaAddress(i.account); solanaAddress(i.inputMint); rawU64(i.inputAmount); rawU64(i.minimumOut); rawU64(i.reviewedOut);
      // Structural/identity validation before admission; age is checked again during work.
      validateSolanaQuote(body.quote, {inputMint:i.inputMint,outputMint:i.outputMint,amount:i.inputAmount,slippageBps:i.slippageBps}, body.quote.quotedAt);
      assertSolanaReview(i as any,i.account,body.quote as any);
      return {intent: {...i}, quote: JSON.parse(JSON.stringify(body.quote))};
    }
    if (operation === 'reconcile') {
      if (!exactKeys(body, ['account','signature','blockhash','lastValidBlockHeight']) || !safeInteger(body.lastValidBlockHeight,1,Number.MAX_SAFE_INTEGER)
        || typeof body.signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(body.signature)) return null;
      return {account: solanaAddress(body.account), signature: solanaSignature(body.signature), blockhash: solanaAddress(body.blockhash), lastValidBlockHeight: body.lastValidBlockHeight};
    }
  } catch { return null; }
  return null;
}
const fail = (status: number, code: string, error: string): ApiResult => ({status, data:{code,error}});
class ReadFailure extends Error {status: number; code: string; constructor(status: number, code: string) {super(code); this.status=status; this.code=code;}}
async function boundedJson(response: Response, maxBytes = 512_000): Promise<any> {
  if (response.status === 429) {try {await response.body?.cancel();} catch {} throw new ReadFailure(429,'SOLANA_PROVIDER_RATE_LIMITED');}
  if (!response.ok) {try {await response.body?.cancel();} catch {} throw new ReadFailure(503,'SOLANA_PROVIDER_UNAVAILABLE');}
  const reader=response.body?.getReader(); if (!reader) throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');
  const chunks: Uint8Array[]=[]; let bytes=0;
  try {while (true) {const r=await reader.read(); if(r.done)break; bytes+=r.value.length;if(bytes>maxBytes)throw new Error('size');chunks.push(r.value);}
    const all=new Uint8Array(bytes);let p=0;for(const c of chunks){all.set(c,p);p+=c.length;}return JSON.parse(new TextDecoder().decode(all));
  } catch {try {await reader.cancel();} catch {} throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');} finally {reader.releaseLock();}
}
export function verifyClassicAccount(value: any, mint: string, owner: string): {amount: string} {
  if (!object(value) || value.owner !== SPL_TOKEN || value.executable || !Array.isArray(value.data) || value.data[1] !== 'base64') throw new Error('Classic token account required');
  const d=base64Bytes(value.data[0],165);
  if(d.length!==165 || new PublicKey(d.slice(0,32)).toBase58()!==mint || new PublicKey(d.slice(32,64)).toBase58()!==owner || d[108]!==1) throw new Error('Token account binding differs');
  return {amount: new DataView(d.buffer,d.byteOffset).getBigUint64(64,true).toString()};
}
function verifyMint(value:any, decimals?:number):number {
  if(!object(value)||value.owner!==SPL_TOKEN||value.executable||!Array.isArray(value.data)||value.data[1]!=='base64')throw new Error('Classic SPL mint required');
  const d=base64Bytes(value.data[0],82);if(d.length!==82||d[45]!==1||d[44]>18||decimals!==undefined&&d[44]!==decimals)throw new Error('Mint units differ');return d[44];
}
export async function handleSolanaRequest(operation: SolanaOperation, parsed: unknown, env: Record<string, any>, options: Options = {}): Promise<ApiResult> {
  const p=parseSolanaRequest(operation,parsed); if(!p)return fail(400,'SOLANA_INVALID_REQUEST','Invalid Solana request.');
  const now=options.now??Date.now, fetchImpl=options.fetchImpl??fetch;
  const controller=new AbortController(); let timer: ReturnType<typeof setTimeout>; let abort:()=>void;
  const work=async():Promise<ApiResult>=>{
    // These bindings are read only after the outer shared D1 admission and pure parsing.
    const key=env.HELIUS_API_KEY;
    const feeWallet=env.SOLANA_PLATFORM_FEE_WALLET || env.NEXT_PUBLIC_PLATFORM_FEE_WALLET;
    if(typeof key!=='string'||!key||feeWallet!==SOLANA_FEE_WALLET)return fail(503,'SOLANA_CONFIG_UNAVAILABLE','Solana is disabled until the existing server RPC and5bps fee wallet are configured.');
    const rpcUrl=new URL('https://mainnet.helius-rpc.com/');rpcUrl.searchParams.set('api-key',key);
    const safeFetch=async(url:string,init:RequestInit):Promise<Response>=>{try{return await fetchImpl(url,init);}catch{throw new ReadFailure(503,'SOLANA_PROVIDER_UNAVAILABLE');}};
    const rpc=async(calls:{method:string;params:any}[]):Promise<any[]>=>{
      if(controller.signal.aborted)throw new ReadFailure(503,'SOLANA_READ_TIMEOUT');
      const response=await safeFetch(rpcUrl.toString(),{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(calls.map((c,i)=>({jsonrpc:'2.0',id:i+1,...c}))),redirect:'manual',signal:controller.signal});
      const data=await boundedJson(response);if(!Array.isArray(data)||data.length!==calls.length)throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');
      return calls.map((_,i)=>{const rows=data.filter((v:any)=>object(v)&&v.id===i+1);if(rows.length!==1||rows[0].error||!Object.prototype.hasOwnProperty.call(rows[0],'result'))throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');return rows[0].result;});
    };
    const postJupiter=async(path:string,init:RequestInit):Promise<any>=>{if(controller.signal.aborted)throw new ReadFailure(503,'SOLANA_READ_TIMEOUT');return boundedJson(await safeFetch('https://lite-api.jup.ag/swap/v1/'+path,{...init,redirect:'manual',signal:controller.signal,headers:{'accept':'application/json','content-type':'application/json'}}),192_000);};
    if(operation==='status') {
      const atas=OUTPUTS.map(m=>associatedToken(feeWallet,m));
      const [genesis,state]=await rpc([{method:'getGenesisHash',params:[]},{method:'getMultipleAccounts',params:[[...OUTPUTS,...atas],{encoding:'base64',commitment:'confirmed'}]}]);
      if(genesis!==SOLANA_MAINNET||!object(state)||!Array.isArray(state.value)||state.value.length!==4)throw new ReadFailure(503,'SOLANA_NETWORK_INVALID');
      const outputs=OUTPUTS.map((mint,i)=>{try{verifyMint(state.value[i],i===0?6:9);verifyClassicAccount(state.value[i+2],mint,feeWallet);return {mint,ready:true};}catch{return {mint,ready:false,reason:'Existing5bps fee token account is missing or invalid. Initialization requires separate operator review.'};}});
      return {status:200,data:{ready:outputs.some(x=>x.ready),network:SOLANA_MAINNET,feeBps:5,outputs,reason:outputs.some(x=>x.ready)?null:'Solana is disabled: no verified existing fee token account. No account will be created by this app.'}};
    }
    if(operation==='discover') {
      const tokens:any[]=[];let partial=false;
      for(let page=1;page<=3;page++){
        const [data]=await rpc([{method:'searchAssets',params:{ownerAddress:p.wallet,tokenType:'fungible',page,limit:100,displayOptions:{showNativeBalance:false}}}]);
        if(!object(data)||!Array.isArray(data.items)||data.items.length>100)throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');
        const mints:string[]=[];
        for(const item of data.items){try{if(item?.ownership?.owner===p.wallet){const mint=solanaAddress(item.id);if(!mints.includes(mint))mints.push(mint);}}catch{/* No unverified address enters RPC. */}}
        const balances=new Map<string,string>();
        if(mints.length){
          const [state]=await rpc([{method:'getMultipleAccounts',params:[mints.map(m=>associatedToken(p.wallet,m)),{encoding:'base64',commitment:'confirmed'}]}]);
          if(!Array.isArray(state?.value)||state.value.length!==mints.length)throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');
          mints.forEach((mint,i)=>{try{balances.set(mint,verifyClassicAccount(state.value[i],mint,p.wallet).amount);}catch{/* Unsupported/non-ATA holdings are not assigned guessed units. */}});
        }
        for(const item of data.items){try{
          if(!object(item)||!object(item.token_info)||!object(item.ownership)||item.ownership.owner!==p.wallet)continue;
          const t=item.token_info,mint=solanaAddress(item.id),amount=rawU64(balances.get(mint));if(!safeInteger(t.decimals,0,18))continue;
          const metadata=object(item.content?.metadata)?item.content.metadata:{};
          const price=typeof t.price_info?.price_per_token==='number'&&Number.isFinite(t.price_info.price_per_token)&&t.price_info.price_per_token>0?t.price_info.price_per_token:0;
          tokens.push({mint,symbol:typeof t.symbol==='string'?t.symbol.slice(0,32):typeof metadata.symbol==='string'?metadata.symbol.slice(0,32):mint.slice(0,6),name:typeof metadata.name==='string'?metadata.name.slice(0,96):'Token',decimals:t.decimals,balance:amount.toString(),price,valueUsd:price*Number(amount)/10**t.decimals,tradeable:true,priceSource:price?'helius':'unknown'});
        }catch{/* Malformed metadata is not a holding proof. */}}
        if(data.items.length<100)break;if(page===3)partial=true;
      }
      return {status:200,data:{tokens:Array.from(new Map(tokens.map(t=>[t.mint,t])).values()),partial,network:SOLANA_MAINNET,notice:'Classic SPL balances are reverified before signing. Native SOL is preserved.'}};
    }
    if(operation==='quote') {
      const params=new URLSearchParams({inputMint:p.inputMint,outputMint:p.outputMint,amount:p.amount,slippageBps:String(p.slippageBps),swapMode:'ExactIn',platformFeeBps:'5',onlyDirectRoutes:'true',asLegacyTransaction:'true',maxAccounts:'32',dexes:'Whirlpool,Meteora DLMM',instructionVersion:'V1'});
      const data=await postJupiter('quote?'+params,{method:'GET'});
      const quote=validateSolanaQuote({...data,quotedAt:now()},{inputMint:p.inputMint,outputMint:p.outputMint,amount:p.amount,slippageBps:p.slippageBps},now());return {status:200,data:{quote}};
    }
    if(operation==='construct') {
      const {intent,quote}=p;assertSolanaReview(intent,intent.account,quote,now());
      const data=await postJupiter('swap-instructions',{method:'POST',body:JSON.stringify({quoteResponse:quote,userPublicKey:intent.account,feeAccount:associatedToken(feeWallet,intent.outputMint),wrapAndUnwrapSol:false,useSharedAccounts:false,useTokenLedger:false,asLegacyTransaction:true,dynamicComputeUnitLimit:false,skipUserAccountsRpcCalls:false})});
      if(!object(data)||data.tokenLedgerInstruction||data.cleanupInstruction||(data.otherInstructions?.length??0)>0)throw new ReadFailure(422,'SOLANA_ROUTE_UNSUPPORTED');
      const swapInstruction=validateJupiterRoute(data.swapInstruction,intent,quote,feeWallet,now());
      // Provider setup/compute/ALTs are never compiled. Our client constructs the only permitted setup.
      const source=associatedToken(intent.account,intent.inputMint),dest=associatedToken(intent.account,intent.outputMint);
      const routeKeys=[...new Set(swapInstruction.accounts.map(a=>a.pubkey))];
      const [genesis,accounts,block,routeAccounts]=await rpc([{method:'getGenesisHash',params:[]},{method:'getMultipleAccounts',params:[[source,dest,associatedToken(feeWallet,intent.outputMint),intent.inputMint,intent.outputMint,JUPITER_PROGRAM],{encoding:'base64',commitment:'confirmed',minContextSlot:quote.contextSlot}]},{method:'getLatestBlockhash',params:[{commitment:'confirmed',minContextSlot:quote.contextSlot}]},{method:'getMultipleAccounts',params:[routeKeys,{encoding:'base64',commitment:'confirmed',minContextSlot:quote.contextSlot}]}]);
      if(genesis!==SOLANA_MAINNET||!Array.isArray(accounts?.value)||accounts.value.length!==6||!object(block?.value)||!Array.isArray(routeAccounts?.value)||routeAccounts.value.length!==routeKeys.length)throw new ReadFailure(503,'SOLANA_NETWORK_INVALID');
      const a=accounts.value;const sourceAccount=verifyClassicAccount(a[0],intent.inputMint,intent.account);
      if(BigInt(sourceAccount.amount)<rawU64(intent.inputAmount))throw new ReadFailure(422,'SOLANA_BALANCE_CHANGED');
      const createOutputAta=a[1]===null;if(!createOutputAta)verifyClassicAccount(a[1],intent.outputMint,intent.account);
      verifyClassicAccount(a[2],intent.outputMint,feeWallet);verifyMint(a[3],intent.inputDecimals);verifyMint(a[4],intent.outputDecimals);
      if(!a[5]?.executable||!safeInteger(block.value.lastValidBlockHeight,1,Number.MAX_SAFE_INTEGER))throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');
      solanaAddress(block.value.blockhash);
      const accountProofs=routeKeys.map((pubkey,index)=>{const account=routeAccounts.value[index];
        if(account===null)return {pubkey,exists:false,owner:null,executable:false};
        if(!object(account)||typeof account.owner!=='string'||typeof account.executable!=='boolean')throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');
        if(account.owner===SPL_TOKEN&&Array.isArray(account.data)){const bytes=base64Bytes(account.data[0],165);if(bytes.length===165&&new PublicKey(bytes.slice(32,64)).toBase58()===intent.account&&pubkey!==source&&pubkey!==dest)throw new ReadFailure(422,'SOLANA_EXTRA_OWNED_ACCOUNT');}
        return {pubkey,exists:true,owner:account.owner,executable:account.executable};});
      validateSolanaAccountProofs(swapInstruction,quote,accountProofs);
      return {status:200,data:{network:SOLANA_MAINNET,account:intent.account,feeWallet,quote,swapInstruction,accountProofs,blockhash:block.value.blockhash,lastValidBlockHeight:block.value.lastValidBlockHeight,constructedAt:now(),createOutputAta}};
    }
    const [genesis,status,transaction,height,valid]=await rpc([{method:'getGenesisHash',params:[]},{method:'getSignatureStatuses',params:[[p.signature],{searchTransactionHistory:true}]},{method:'getTransaction',params:[p.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]},{method:'getBlockHeight',params:[{commitment:'finalized'}]},{method:'isBlockhashValid',params:[p.blockhash,{commitment:'finalized'}]}]);
    if(genesis!==SOLANA_MAINNET||!Array.isArray(status?.value)||status.value.length!==1||!safeInteger(height,1,Number.MAX_SAFE_INTEGER)||typeof valid?.value!=='boolean')throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');
    let signatureStatus,finalized;
    try{
      signatureStatus=solanaSignatureProof(status.value[0]);
      if(transaction!==null){
        if(!object(transaction)||!Array.isArray(transaction.transaction)||transaction.transaction[1]!=='base64'||!safeInteger(transaction.slot,1,Number.MAX_SAFE_INTEGER)||!object(transaction.meta))throw new Error('Invalid transaction');
        base64Bytes(transaction.transaction[0],1232);finalized=solanaFinalizedProof(transaction.meta,transaction.slot);
        assertSolanaStatusAgreement(finalized,signatureStatus);
      }
    }catch{throw new ReadFailure(503,'SOLANA_RESPONSE_INVALID');}
    return {status:200,data:{network:SOLANA_MAINNET,signature:p.signature,status:signatureStatus,transaction:transaction===null?null:{...finalized,wire:transaction.transaction[0],preTokenBalances:transaction.meta.preTokenBalances,postTokenBalances:transaction.meta.postTokenBalances},finalizedHeight:height,blockhashValid:valid.value}};
  };
  try {
    const deadline=new Promise<never>((_,reject)=>{abort=()=>{controller.abort();reject(new ReadFailure(503,'SOLANA_READ_TIMEOUT'));};timer=setTimeout(abort,8_000);options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();});
    return await Promise.race([work(),deadline]);
  }catch(error){const known=error instanceof ReadFailure;return fail(known?error.status:422,known?error.code:'SOLANA_ROUTE_UNSUPPORTED',known?'Solana read service is unavailable. Retry or reconcile the original pending transaction.':'This route or token account cannot be safely verified. Review a supported route.');}
  finally{clearTimeout(timer!);options.signal?.removeEventListener('abort',abort!);controller.abort();}
}
