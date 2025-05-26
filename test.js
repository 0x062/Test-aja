// AutoSwap Bot in JavaScript using ethers.js
// This script automatically swaps tokens or native currency on a DEX (e.g., FreeSwap) based on conditions.

// Requirements:
// - Node.js
// - ethers.js (npm install ethers)
// - dotenv (npm install dotenv)

// Create a .env file with:
// PRIVATE_KEY=your_wallet_private_key
// RPC_URL=https://rpc.freeswap.org  // FreeSwap RPC endpoint
// ROUTER_ADDRESS=0xYourRouterAddress // FreeSwapRouter contract

const { ethers } = require('ethers');
require('dotenv').config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;

// Addresses (replace with real ones)
const WNATIVE = process.env.WNATIVE; // e.g. WXOS
const USDT = process.env.USDT;

// Swap settings:
const AMOUNT_IN = ethers.utils.parseUnits('0.001', 18); // 0.001 XOS
const SLIPPAGE = 0.01; // 1%
const DEADLINE_OFFSET = 60 * 10; // 10 minutes
const GAS_LIMIT = 300000;

const ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

async function swapETHForUSDT() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

  // Build path [WNATIVE -> USDT]
  const path = [WNATIVE, USDT];

  // Get amounts
  const amounts = await router.getAmountsOut(AMOUNT_IN, path);
  const amountOutMin = amounts[1]
    .mul(ethers.BigNumber.from(Math.floor((1 - SLIPPAGE) * 1000)))
    .div(ethers.BigNumber.from(1000));

  // Execute swap
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_OFFSET;
  console.log(`Swapping ${ethers.utils.formatUnits(AMOUNT_IN)} native for minimum ${ethers.utils.formatUnits(amountOutMin)} USDT`);

  const tx = await router.swapExactETHForTokens(
    amountOutMin,
    path,
    wallet.address,
    deadline,
    {
      value: AMOUNT_IN,
      gasLimit: GAS_LIMIT
    }
  );
  console.log('Tx hash:', tx.hash);
  const receipt = await tx.wait();
  console.log('Swap confirmed in block', receipt.blockNumber);
}

// Example for token->token swap
async function swapTokenForToken(tokenIn, tokenOut, amountIn) {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);
  const tokenInContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);

  // Approve router if needed
  const allowance = await tokenInContract.allowance(wallet.address, ROUTER_ADDRESS);
  if (allowance.lt(amountIn)) {
    console.log('Approving token spend...');
    await tokenInContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
  }

  const path = [tokenIn, tokenOut];
  const amounts = await router.getAmountsOut(amountIn, path);
  const amountOutMin = amounts[1]
    .mul(ethers.BigNumber.from(Math.floor((1 - SLIPPAGE) * 1000)))
    .div(ethers.BigNumber.from(1000));
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_OFFSET;

  console.log(`Swapping ${ethers.utils.formatUnits(amountIn)} tokenIn for minimum ${ethers.utils.formatUnits(amountOutMin)} tokenOut`);

  const tx = await router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    path,
    wallet.address,
    deadline,
    { gasLimit: GAS_LIMIT }
  );
  console.log('Tx hash:', tx.hash);
  await tx.wait();
  console.log('Token swap confirmed');
}

// Run examples:
(async () => {
  // Swap native currency (XOS) to USDT:
  await swapETHForUSDT();

  // If you want token->token:
  // await swapTokenForToken('0xTokenIn', '0xTokenOut', ethers.utils.parseUnits('1.0', 18));
})();
