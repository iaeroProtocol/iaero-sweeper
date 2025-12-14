// ============================================================================
// JUPITER SWAP INTEGRATION
// ============================================================================
// Uses Jupiter's swap-instructions endpoint to get individual instructions
// that can be bundled into fewer transactions.

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  TransactionInstruction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  JUPITER_API,
  SOLANA_TOKENS,
  SOLANA_BATCH_CONFIG,
  type JupiterQuote,
  type JupiterSwapInstructions,
  type SolanaTokenInfo,
  type SolanaSwapResult,
} from './config';

// ============================================================================
// JUPITER QUOTE FETCHING
// ============================================================================

/**
 * Get a swap quote from Jupiter
 */
export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint,
  slippageBps: number = SOLANA_BATCH_CONFIG.DEFAULT_SLIPPAGE_BPS
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
    // Use ExactIn mode
    swapMode: 'ExactIn',
    // Only direct routes for reliability in batching
    onlyDirectRoutes: 'false',
    // Exclude risky AMMs
    excludeDexes: 'Whirlpool', // Optional: can be adjusted
  });
  
  const response = await fetch(`${JUPITER_API.QUOTE}?${params}`);
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter quote failed: ${response.status} - ${error}`);
  }
  
  return response.json();
}

/**
 * Get swap instructions (not full transaction) from Jupiter
 * This is the key for bundling!
 */
export async function getJupiterSwapInstructions(
  quote: JupiterQuote,
  userPublicKey: string,
  destinationTokenAccount?: string
): Promise<JupiterSwapInstructions> {
  const response = await fetch(JUPITER_API.SWAP_INSTRUCTIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      destinationTokenAccount,
      // Important settings for batching
      wrapAndUnwrapSol: true,
      useSharedAccounts: true, // Reduces account overhead
      asLegacyTransaction: false, // Use versioned transactions
      useTokenLedger: false,
      dynamicComputeUnitLimit: true,
      skipUserAccountsRpcCalls: false,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter swap-instructions failed: ${response.status} - ${error}`);
  }
  
  return response.json();
}

// ============================================================================
// ADDRESS LOOKUP TABLE HANDLING
// ============================================================================

/**
 * Fetch Address Lookup Tables needed for the transaction
 */
export async function getAddressLookupTables(
  connection: Connection,
  addresses: string[]
): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];
  
  const uniqueAddresses = [...new Set(addresses)];
  
  const lookupTableAccounts = await Promise.all(
    uniqueAddresses.map(async (address) => {
      try {
        const pubkey = new PublicKey(address);
        const response = await connection.getAddressLookupTable(pubkey);
        return response.value;
      } catch (e) {
        console.warn(`Failed to fetch ALT ${address}:`, e);
        return null;
      }
    })
  );
  
  return lookupTableAccounts.filter((alt): alt is AddressLookupTableAccount => alt !== null);
}

// ============================================================================
// INSTRUCTION DESERIALIZATION
// ============================================================================

/**
 * Convert Jupiter's instruction format to Solana TransactionInstruction
 */
function deserializeInstruction(instruction: any): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((account: any) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(instruction.data, 'base64'),
  });
}

// ============================================================================
// BATCH TRANSACTION BUILDING
// ============================================================================

interface SwapBundle {
  token: SolanaTokenInfo;
  quote: JupiterQuote;
  instructions: JupiterSwapInstructions;
}

/**
 * Build a versioned transaction from multiple swap instructions
 */
export async function buildBatchTransaction(
  connection: Connection,
  userPublicKey: PublicKey,
  swapBundles: SwapBundle[]
): Promise<VersionedTransaction> {
  console.log(`\n🔧 Building batch transaction for ${swapBundles.length} swaps...`);
  
  const allInstructions: TransactionInstruction[] = [];
  const allAltAddresses: string[] = [];
  
  // Calculate total compute units needed
  const totalComputeUnits = swapBundles.length * SOLANA_BATCH_CONFIG.COMPUTE_UNITS_PER_SWAP;
  
  // Add compute budget instructions FIRST
  allInstructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: Math.min(totalComputeUnits, 1_400_000), // Max 1.4M
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: SOLANA_BATCH_CONFIG.PRIORITY_FEE_MICROLAMPORTS,
    })
  );
  
  // Add instructions from each swap
  for (const { token, instructions } of swapBundles) {
    console.log(`  Adding ${token.symbol} instructions...`);
    
    // Collect ALT addresses
    allAltAddresses.push(...(instructions.addressLookupTableAddresses || []));
    
    // Add setup instructions (token account creation, etc.)
    for (const ix of instructions.setupInstructions || []) {
      allInstructions.push(deserializeInstruction(ix));
    }
    
    // Add the main swap instruction
    allInstructions.push(deserializeInstruction(instructions.swapInstruction));
    
    // Add cleanup instruction if present
    if (instructions.cleanupInstruction) {
      allInstructions.push(deserializeInstruction(instructions.cleanupInstruction));
    }
  }
  
  console.log(`  📋 Total instructions: ${allInstructions.length}`);
  console.log(`  📋 ALT addresses: ${allAltAddresses.length}`);
  
  // Fetch address lookup tables
  const addressLookupTables = await getAddressLookupTables(connection, allAltAddresses);
  console.log(`  📋 Loaded ${addressLookupTables.length} lookup tables`);
  
  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  
  // Build the versioned transaction message
  const messageV0 = new TransactionMessage({
    payerKey: userPublicKey,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message(addressLookupTables);
  
  // Create versioned transaction
  const transaction = new VersionedTransaction(messageV0);
  
  // Check transaction size
  const serialized = transaction.serialize();
  console.log(`  📦 Transaction size: ${serialized.length} bytes (limit: 1232)`);
  
  if (serialized.length > 1232) {
    throw new Error(`Transaction too large: ${serialized.length} bytes. Try fewer swaps.`);
  }
  
  return transaction;
}

// ============================================================================
// MAIN BATCH SWAP EXECUTION
// ============================================================================

export interface BatchSwapOptions {
  connection: Connection;
  userPublicKey: PublicKey;
  tokens: SolanaTokenInfo[];
  outputMint?: string;
  slippageBps?: number;
  onProgress?: (message: string) => void;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}

/**
 * Execute batch swap for multiple Solana tokens
 */
export async function executeSolanaBatchSwap({
  connection,
  userPublicKey,
  tokens,
  outputMint = SOLANA_TOKENS.USDC,
  slippageBps = SOLANA_BATCH_CONFIG.DEFAULT_SLIPPAGE_BPS,
  onProgress,
  signTransaction,
}: BatchSwapOptions): Promise<SolanaSwapResult[]> {
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚀 SOLANA BATCH SWAP`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Tokens: ${tokens.length}`);
  console.log(`Output: ${outputMint}`);
  console.log(`Slippage: ${slippageBps} bps`);
  
  const results: SolanaSwapResult[] = [];
  
  // Filter out the output token if present
  const tokensToSwap = tokens.filter(t => 
    t.mint.toLowerCase() !== outputMint.toLowerCase()
  );
  
  if (tokensToSwap.length === 0) {
    console.log('No tokens to swap');
    return results;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 1: FETCH ALL QUOTES
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n📊 PHASE 1: Fetching ${tokensToSwap.length} quotes...`);
  onProgress?.(`Fetching ${tokensToSwap.length} quotes...`);
  
  const quotesWithTokens: Array<{ token: SolanaTokenInfo; quote: JupiterQuote }> = [];
  
  // Fetch quotes in parallel (Jupiter can handle it)
  const quotePromises = tokensToSwap.map(async (token) => {
    try {
      const quote = await getJupiterQuote(
        token.mint,
        outputMint,
        token.balance,
        slippageBps
      );
      
      const outAmount = Number(quote.outAmount) / 1e6; // USDC decimals
      console.log(`  ✅ ${token.symbol}: ${token.balanceFormatted} → ${outAmount.toFixed(2)} USDC`);
      
      return { token, quote, error: null };
    } catch (e: any) {
      console.log(`  ❌ ${token.symbol}: ${e.message}`);
      return { token, quote: null, error: e.message };
    }
  });
  
  const quoteResults = await Promise.all(quotePromises);
  
  // Separate successful and failed quotes
  for (const result of quoteResults) {
    if (result.quote) {
      quotesWithTokens.push({ token: result.token, quote: result.quote });
    } else {
      results.push({
        mint: result.token.mint,
        symbol: result.token.symbol,
        status: 'failed',
        inputAmount: result.token.balance,
        error: result.error || 'Quote failed',
      });
    }
  }
  
  if (quotesWithTokens.length === 0) {
    console.log('❌ All quotes failed');
    return results;
  }
  
  console.log(`✅ Got ${quotesWithTokens.length} quotes`);
  
  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 2: FETCH SWAP INSTRUCTIONS
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n📋 PHASE 2: Fetching swap instructions...`);
  onProgress?.('Fetching swap instructions...');
  
  const swapBundles: SwapBundle[] = [];
  
  for (const { token, quote } of quotesWithTokens) {
    try {
      const instructions = await getJupiterSwapInstructions(
        quote,
        userPublicKey.toString()
      );
      
      swapBundles.push({ token, quote, instructions });
      console.log(`  ✅ ${token.symbol}: Got instructions`);
      
    } catch (e: any) {
      console.log(`  ❌ ${token.symbol}: ${e.message}`);
      results.push({
        mint: token.mint,
        symbol: token.symbol,
        status: 'failed',
        inputAmount: token.balance,
        error: e.message,
      });
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  if (swapBundles.length === 0) {
    console.log('❌ All instruction fetches failed');
    return results;
  }
  
  console.log(`✅ Got ${swapBundles.length} swap bundles`);
  
  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 3: BUILD AND EXECUTE BATCHED TRANSACTIONS
  // ─────────────────────────────────────────────────────────────────────────
  const batchSize = SOLANA_BATCH_CONFIG.MAX_SWAPS_PER_TX;
  const numBatches = Math.ceil(swapBundles.length / batchSize);
  
  console.log(`\n🚀 PHASE 3: Executing ${numBatches} batched transaction(s)...`);
  
  for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
    const batchStart = batchIdx * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, swapBundles.length);
    const batch = swapBundles.slice(batchStart, batchEnd);
    
    const batchNum = batchIdx + 1;
    const batchSymbols = batch.map(b => b.token.symbol).join(', ');
    
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📦 BATCH ${batchNum}/${numBatches}: ${batchSymbols}`);
    console.log(`${'─'.repeat(50)}`);
    
    onProgress?.(`Batch ${batchNum}/${numBatches}: ${batchSymbols}`);
    
    try {
      // Build the batched transaction
      const transaction = await buildBatchTransaction(
        connection,
        userPublicKey,
        batch
      );
      
      // Sign the transaction
      console.log('  ✍️ Requesting signature...');
      const signedTx = await signTransaction(transaction);
      
      // Send the transaction
      console.log('  📤 Sending transaction...');
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      
      console.log(`  ⏳ Confirming... ${signature.slice(0, 20)}...`);
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: transaction.message.recentBlockhash,
          lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
        },
        'confirmed'
      );
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log(`  ✅ BATCH ${batchNum} CONFIRMED!`);
      console.log(`     Signature: ${signature}`);
      
      // Mark all tokens in this batch as successful
      for (const { token, quote } of batch) {
        results.push({
          mint: token.mint,
          symbol: token.symbol,
          status: 'success',
          signature,
          inputAmount: token.balance,
          outputAmount: BigInt(quote.outAmount),
        });
      }
      
    } catch (e: any) {
      console.error(`  ❌ BATCH ${batchNum} FAILED:`, e.message);
      
      // Check if user rejected
      if (e.message?.includes('User rejected') || e.message?.includes('cancelled')) {
        console.log('  User cancelled transaction');
        // Mark remaining as skipped
        for (const { token } of batch) {
          results.push({
            mint: token.mint,
            symbol: token.symbol,
            status: 'skipped',
            inputAmount: token.balance,
            error: 'User cancelled',
          });
        }
        break; // Stop processing further batches
      }
      
      // Transaction failed - try individual execution as fallback
      console.log(`  🔄 Trying individual execution for batch ${batchNum}...`);
      
      for (const { token, quote } of batch) {
        try {
          const singleResult = await executeSingleSwap({
            connection,
            userPublicKey,
            token,
            quote,
            signTransaction,
          });
          results.push(singleResult);
        } catch (singleError: any) {
          results.push({
            mint: token.mint,
            symbol: token.symbol,
            status: 'failed',
            inputAmount: token.balance,
            error: singleError.message,
          });
        }
      }
    }
    
    // Delay between batches
    if (batchIdx < numBatches - 1) {
      await new Promise(r => setTimeout(r, SOLANA_BATCH_CONFIG.INTER_BATCH_DELAY_MS));
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ SOLANA BATCH SWAP COMPLETE`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`${'═'.repeat(60)}`);
  
  return results;
}

/**
 * Execute a single swap (fallback when batching fails)
 */
async function executeSingleSwap({
  connection,
  userPublicKey,
  token,
  quote,
  signTransaction,
}: {
  connection: Connection;
  userPublicKey: PublicKey;
  token: SolanaTokenInfo;
  quote: JupiterQuote;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}): Promise<SolanaSwapResult> {
  console.log(`    🔄 ${token.symbol}: Trying individual swap...`);
  
  try {
    // Get fresh quote (original may be stale)
    const freshQuote = await getJupiterQuote(
      token.mint,
      quote.outputMint,
      token.balance,
      SOLANA_BATCH_CONFIG.DEFAULT_SLIPPAGE_BPS + 50 // Slightly higher slippage for retry
    );
    
    // Get swap instructions
    const instructions = await getJupiterSwapInstructions(
      freshQuote,
      userPublicKey.toString()
    );
    
    // Build single-swap transaction
    const transaction = await buildBatchTransaction(
      connection,
      userPublicKey,
      [{ token, quote: freshQuote, instructions }]
    );
    
    // Sign and send
    const signedTx = await signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    // Confirm
    await connection.confirmTransaction(signature, 'confirmed');
    
    console.log(`    ✅ ${token.symbol}: Success! ${signature.slice(0, 20)}...`);
    
    return {
      mint: token.mint,
      symbol: token.symbol,
      status: 'success',
      signature,
      inputAmount: token.balance,
      outputAmount: BigInt(freshQuote.outAmount),
    };
    
  } catch (e: any) {
    console.log(`    ❌ ${token.symbol}: ${e.message}`);
    return {
      mint: token.mint,
      symbol: token.symbol,
      status: 'failed',
      inputAmount: token.balance,
      error: e.message,
    };
  }
}
