// AutoSwap Bot in JavaScript using ethers.js
// Enhanced: Check balances of XOS (native), WXOS, and output ERC-20 tokens before swaps.

// Requirements:
// - Node.js
// - ethers.js v5 (npm install ethers@^5)
// - dotenv (npm install dotenv)

// .env example:
// PRIVATE_KEY=your_wallet_private_key
// RPC_URL=https://rpc.freeswap.org
// ROUTER_ADDRESS=0xYourRouterAddress
// WNATIVE=0xWrappedNativeAddress       // e.g. WXOS
// NATIVE_SYMBOL=XOS                    // Human-readable native token name
// AMOUNT_IN=0.001                      // in native units (XOS)
// SLIPPAGE=1                           // in percent
// DEADLINE_MINUTES=10                  // deadline offset in minutes
// GAS_LIMIT=300000

const { ethers } = require('ethers');
require('dotenv').config();

// Load config and validate private key
let pk = (process.env.PRIVATE_KEY || '').trim();
if (!pk.startsWith('0x') || pk.length !== 66) {
  console.error('❌ PRIVATE_KEY invalid. Pastikan format “0x...” dan panjang 66 karakter.');
  process.exit(1);
}
const PRIVATE_KEY     = pk;
const RPC_URL         = process.env.RPC_URL;
const ROUTER_ADDRESS  = process.env.ROUTER_ADDRESS;
const WNATIVE         = process.env.WNATIVE;
const NATIVE_SYMBOL   = process.env.NATIVE_SYMBOL || 'XOS';
const AMOUNT_IN       = ethers.utils.parseUnits(process.env.AMOUNT_IN, 18);
const SLIPPAGE        = parseFloat(process.env.SLIPPAGE) / 100;
const DEADLINE_OFFSET = parseInt(process.env.DEADLINE_MINUTES) * 60;
const GAS_LIMIT       = parseInt(process.env.GAS_LIMIT);

// Hardcoded output tokens (addresses)
const OUTPUT_TOKENS   = [
  '0x2CCDB83a043A32898496c1030880Eb2cB977CAbc',  // USDT
  '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d',  // USDC
];

// ABIs
const ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];
const TOKEN_ABI = [
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address owner) external view returns (uint256)"
];

// Initialize provider, wallet, and router
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const router   = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

/**
 * Check and print balances of native XOS, wrapped XOS, and each output token
 */
async function checkBalances(tokenInfo) {
  console.log(`\n🔍 Checking balances for wallet: ${wallet.address}`);
  // Native balance
  const nativeBal = await provider.getBalance(wallet.address);
  console.log(`💰 ${NATIVE_SYMBOL} Balance: ${ethers.utils.formatEther(nativeBal)}`);

  // Wrapped native (WXOS) and output tokens
  for (const addr of [WNATIVE, ...Object.keys(tokenInfo)]) {
    const { symbol, decimals } = tokenInfo[addr] || {};
    const token = new ethers.Contract(addr, TOKEN_ABI, provider);
    try {
      const bal = await token.balanceOf(wallet.address);
      const label = symbol || addr;
      console.log(`💳 ${label} Balance: ${ethers.utils.formatUnits(bal, decimals)}`);
    } catch (e) {
      console.warn(`⚠️ Gagal fetch balance untuk ${addr}:`, e.message);
    }
  }
}

(async () => {
  // 1. Fetch metadata for tokens
  const tokenInfo = {};
  for (const addr of OUTPUT_TOKENS) {
    const t = new ethers.Contract(addr, TOKEN_ABI, provider);
    try {
      const [sym, dec] = await Promise.all([t.symbol(), t.decimals()]);
      tokenInfo[addr] = { symbol: sym, decimals: dec };
    } catch (e) {
      tokenInfo[addr] = { symbol: addr, decimals: 18 };
    }
  }

  // 2. Display initial balances
  await checkBalances(tokenInfo);

  // 3. Perform swaps
  console.log(`\n🤖 Starting AutoSwap: ${NATIVE_SYMBOL} → ${OUTPUT_TOKENS.map(a => tokenInfo[a].symbol).join(', ')}`);

  for (const addr of OUTPUT_TOKENS) {
    const { symbol, decimals } = tokenInfo[addr];
    const path = [WNATIVE, addr];

    console.log(`\n🔄 Processing ${symbol}...`);
    let amounts;
    try {
      amounts = await router.getAmountsOut(AMOUNT_IN, path);
    } catch (err) {
      console.error(`❌ getAmountsOut gagal untuk ${symbol}:`, err.message);
      continue;
    }

    const rawOutMin = amounts[1]
      .mul(ethers.BigNumber.from(Math.floor((1 - SLIPPAGE) * 1000)))
      .div(ethers.BigNumber.from(1000));
    const formattedIn  = ethers.utils.formatUnits(AMOUNT_IN, 18);
    const formattedOut = ethers.utils.formatUnits(rawOutMin, decimals);
    const deadline     = Math.floor(Date.now() / 1000) + DEADLINE_OFFSET;

    console.log(`➡️ Swapping ${formattedIn} ${NATIVE_SYMBOL} for ≥ ${formattedOut} ${symbol}`);

    let tx;
    try {
      tx = await router.swapExactETHForTokens(
        rawOutMin,
        path,
        wallet.address,
        deadline,
        { value: AMOUNT_IN, gasLimit: GAS_LIMIT }
      );
      console.log(`🚀 Tx sent (${symbol}): ${tx.hash}`);
    } catch (err) {
      console.error(`❌ SwapExactETHForTokens gagal untuk ${symbol}:`, err.message);
      continue;
    }

    try {
      const receipt = await tx.wait();
      console.log(`✅ Swap ${symbol} confirmed in block ${receipt.blockNumber}`);
    } catch (err) {
      console.error(`❌ Konfirmasi gagal untuk ${symbol}:`, err.message);
    }

    // 4. Show balances after each swap
    console.log(`\n🔍 Balances after swapping ${symbol}:`);
    await checkBalances(tokenInfo);
  }

  console.log(`\n🎉 Semua swaps selesai!`);
})();
