// AutoSwap Bot in JavaScript using ethers.js
// Hardcoded list of output token pairs and improved console output with emojis

// Requirements:
// - Node.js
// - ethers.js v5 (npm install ethers@^5)
// - dotenv (npm install dotenv)

// .env example:
// PRIVATE_KEY=your_wallet_private_key
// RPC_URL=https://rpc.freeswap.org
// ROUTER_ADDRESS=0xYourRouterAddress
// WNATIVE=0xWrappedNativeAddress       // e.g. WXOS
// AMOUNT_IN=0.001                      // in native units (XOS)
// SLIPPAGE=1                           // in percent
// DEADLINE_MINUTES=10                  // deadline offset in minutes
// GAS_LIMIT=300000

const { ethers } = require('ethers');
require('dotenv').config();

// Load config from env
const PRIVATE_KEY     = process.env.PRIVATE_KEY;
const RPC_URL         = process.env.RPC_URL;
const ROUTER_ADDRESS  = process.env.ROUTER_ADDRESS;
const WNATIVE         = process.env.WNATIVE;
const AMOUNT_IN       = ethers.utils.parseUnits(process.env.AMOUNT_IN, 18);
const SLIPPAGE        = parseFloat(process.env.SLIPPAGE) / 100;
const DEADLINE_OFFSET = parseInt(process.env.DEADLINE_MINUTES) * 60;
const GAS_LIMIT       = parseInt(process.env.GAS_LIMIT);

// Hardcoded output tokens array (add more addresses as needed)
const OUTPUT_TOKENS = [
  '0xUSDTContractAddress',
  '0xUSDCContractAddress',
  // '0xAnotherTokenAddress',
];

// ABIs
const ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

// Initialize provider, wallet, and router once
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const router   = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

/**
 * Swap native XOS to specified ERC-20 token
 */
async function swapNativeTo(tokenOut) {
  try {
    const path = [WNATIVE, tokenOut];
    const amounts = await router.getAmountsOut(AMOUNT_IN, path);
    const amountOutMin = amounts[1]
      .mul(ethers.BigNumber.from(Math.floor((1 - SLIPPAGE) * 1000)))
      .div(ethers.BigNumber.from(1000));
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_OFFSET;

    console.log(`🔄 Swapping ${ethers.utils.formatUnits(AMOUNT_IN)} native for ≥ ${ethers.utils.formatUnits(amountOutMin)} of ${tokenOut}`);
    const tx = await router.swapExactETHForTokens(
      amountOutMin,
      path,
      wallet.address,
      deadline,
      { value: AMOUNT_IN, gasLimit: GAS_LIMIT }
    );
    console.log(`🚀 Tx sent for ${tokenOut}: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Swap to ${tokenOut} confirmed in block ${receipt.blockNumber}\n`);
  } catch (err) {
    console.error(`❌ Error swapping to ${tokenOut}:`, err);
  }
}

(async () => {
  console.log(`🤖 Starting AutoSwap for tokens: ${OUTPUT_TOKENS.join(', ')}`);
  for (const tokenOut of OUTPUT_TOKENS) {
    await swapNativeTo(tokenOut.trim());
  }
  console.log('🎉 All swaps completed!');
})();
