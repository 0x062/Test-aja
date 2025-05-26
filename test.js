// AutoSwap Bot in JavaScript using ethers.js
// Initial balance check only; dynamic EIP-1559 gas fees to reduce costs

// Requirements:
// - Node.js
// - ethers.js v5 (npm install ethers@^5)
// - dotenv (npm install dotenv)

// .env example:
// PRIVATE_KEY=your_wallet_private_key
// RPC_URL=https://rpc.freeswap.org
// ROUTER_ADDRESS=0xYourRouterAddress
// WNATIVE=0xWrappedNativeAddress       // e.g. WXOS contract
// NATIVE_SYMBOL=XOS                    // Human-readable native token name
// AMOUNT_IN=0.001                      // in native units (XOS)
// SLIPPAGE=1                           // in percent
// DEADLINE_MINUTES=10                  // deadline offset in minutes
// GAS_LIMIT=210000                     // lowered gasLimit

const { ethers } = require('ethers');
require('dotenv').config();

// Validate private key
const PRIVATE_KEY_ENV = (process.env.PRIVATE_KEY || '').trim();
if (!PRIVATE_KEY_ENV.startsWith('0x') || PRIVATE_KEY_ENV.length !== 66) {
  console.error('❌ PRIVATE_KEY invalid. Pastikan format “0x...” dan panjang 66 karakter.');
  process.exit(1);
}
const PRIVATE_KEY     = PRIVATE_KEY_ENV;
const RPC_URL         = process.env.RPC_URL;
const ROUTER_ADDRESS  = process.env.ROUTER_ADDRESS;
const WNATIVE         = process.env.WNATIVE;
const NATIVE_SYMBOL   = process.env.NATIVE_SYMBOL || 'NATIVE';
const AMOUNT_IN       = ethers.utils.parseUnits(process.env.AMOUNT_IN, 18);
const SLIPPAGE        = parseFloat(process.env.SLIPPAGE) / 100;
const DEADLINE_OFFSET = parseInt(process.env.DEADLINE_MINUTES, 10) * 60;
const GAS_LIMIT       = parseInt(process.env.GAS_LIMIT, 10);

// Hardcoded output tokens
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

(async () => {
  // Fetch chainId and token metadata
  const network = await provider.getNetwork();
  console.log(`🌐 Network: chainId=${network.chainId}`);

  const ALL_TOKENS = [WNATIVE, ...OUTPUT_TOKENS];
  const tokenInfo = {};

  for (const addr of ALL_TOKENS) {
    const t = new ethers.Contract(addr, TOKEN_ABI, provider);
    try {
      const [sym, dec] = await Promise.all([t.symbol(), t.decimals()]);
      tokenInfo[addr] = { symbol: sym, decimals: dec };
    } catch {
      console.warn(`⚠️ Metadata fetch failed for ${addr}, using defaults.`);
      tokenInfo[addr] = { symbol: addr, decimals: 18 };
    }
  }

  // Initial balance check
  console.log(`\n🔍 Initial Balances for ${wallet.address}`);
  const nativeBal = await provider.getBalance(wallet.address);
  console.log(`💰 ${NATIVE_SYMBOL}: ${ethers.utils.formatEther(nativeBal)}`);
  for (const addr of ALL_TOKENS) {
    const { symbol, decimals } = tokenInfo[addr];
    const bal = await (new ethers.Contract(addr, TOKEN_ABI, provider)).balanceOf(wallet.address);
    console.log(`💳 ${symbol}: ${ethers.utils.formatUnits(bal, decimals)}`);
  }

  // Perform swaps
  console.log(`\n🤖 AutoSwap: ${NATIVE_SYMBOL} → ${OUTPUT_TOKENS.map(a => tokenInfo[a].symbol).join(', ')}`);

  for (const addr of OUTPUT_TOKENS) {
    const { symbol, decimals } = tokenInfo[addr];
    console.log(`\n🔄 Swapping to ${symbol}`);

    // Estimate output
    let amounts;
    try {
      amounts = await router.getAmountsOut(AMOUNT_IN, [WNATIVE, addr]);
    } catch (e) {
      console.error(`❌ Cannot estimate for ${symbol}:`, e.message);
      continue;
    }

    const rawOutMin = amounts[1]
      .mul(ethers.BigNumber.from(Math.floor((1 - SLIPPAGE) * 1000)))
      .div(ethers.BigNumber.from(1000));
    const formattedIn  = ethers.utils.formatUnits(AMOUNT_IN, 18);
    const formattedOut = ethers.utils.formatUnits(rawOutMin, decimals);
    console.log(`➡️ ${formattedIn} ${NATIVE_SYMBOL} → ≥ ${formattedOut} ${symbol}`);

    // Dynamic gas fee estimates (EIP-1559)
    const feeData             = await provider.getFeeData();
    const maxFeePerGas        = feeData.maxFeePerGas.mul(110).div(100);
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.mul(110).div(100);

    // Execute swap
    let tx;
    try {
      tx = await router.swapExactETHForTokens(
        rawOutMin,
        [WNATIVE, addr],
        wallet.address,
        Math.floor(Date.now() / 1000) + DEADLINE_OFFSET,
        {
          value: AMOUNT_IN,
          gasLimit: GAS_LIMIT,
          maxFeePerGas,
          maxPriorityFeePerGas
        }
      );
      console.log(`🚀 Tx (${symbol}): ${tx.hash}`);
    } catch (e) {
      console.error(`❌ Swap failed for ${symbol}:`, e.message);
      continue;
    }

    // Await confirmation
    try {
      const receipt = await tx.wait();
      console.log(`✅ Confirmed ${symbol} in block ${receipt.blockNumber}`);
    } catch (e) {
      console.error(`❌ Confirmation failed for ${symbol}:`, e.message);
    }
  }

  console.log('\n🎉 Done!');
})();
