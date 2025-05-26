const { ethers } = require('ethers');
require('dotenv').config();

const PRIVATE_KEY   = (process.env.PRIVATE_KEY || '').trim();
if (!PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length !== 66) {
  console.error('❌ PRIVATE_KEY invalid or missing.');
  process.exit(1);
}

const RPC_URL        = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE        = process.env.WNATIVE;
const AMOUNT_IN_RAW  = process.env.AMOUNT_IN;           // e.g. "0.001"
const SLIPPAGE       = parseFloat(process.env.SLIPPAGE) / 100;       // e.g. 1 → 0.01
const DEADLINE_SEC   = parseInt(process.env.DEADLINE_MINUTES, 10) * 60; 
const GAS_LIMIT      = parseInt(process.env.GAS_LIMIT, 10);

if (!RPC_URL || !ROUTER_ADDRESS || !WNATIVE || !AMOUNT_IN_RAW) {
  console.error('❌ RPC_URL, ROUTER_ADDRESS, WNATIVE, or AMOUNT_IN missing in .env');
  process.exit(1);
}

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const router   = new ethers.Contract(
  ROUTER_ADDRESS,
  [
    "function swapExactETHForTokens(uint,uint,address[],address,uint) payable returns(uint[])",
    "function swapExactTokensForTokens(uint,uint,address[],address,uint) returns(uint[])",
    "function getAmountsOut(uint,address[]) view returns(uint[])"
  ],
  wallet
);

const ERC20_ABI = [
  "function decimals() view returns(uint8)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)"
];

async function swapToken(from, to, amountInRaw) {
  // 1. Fetch decimals for input & output
  const decimalsIn  = from === WNATIVE
    ? 18
    : await new ethers.Contract(from, ERC20_ABI, provider).decimals();

  const decimalsOut = to === WNATIVE
    ? 18
    : await new ethers.Contract(to, ERC20_ABI, provider).decimals();

  // 2. Parse amountIn
  const amountIn = ethers.utils.parseUnits(amountInRaw, decimalsIn);
  const path     = from === WNATIVE ? [WNATIVE, to] : [from, WNATIVE, to];

  // 3. Estimate amountsOut & compute minimumOut with slippage
  const amountsOut = await router.getAmountsOut(amountIn, path);
  const estimatedOut = amountsOut[amountsOut.length - 1];
  const rawOutMin    = estimatedOut
    .mul(Math.floor((1 - SLIPPAGE) * 1000))
    .div(1000);

  console.log(`\n🔄 Swapping ${amountInRaw} (${decimalsIn}d) via [${path.join(' → ')}]`);
  console.log(`    estimated out: ${ethers.utils.formatUnits(estimatedOut, decimalsOut)}`);
  console.log(`    minimum out (${(SLIPPAGE*100).toFixed(2)}% slippage): ${ethers.utils.formatUnits(rawOutMin, decimalsOut)}`);

  // 4. Approval if token→token
  if (from !== WNATIVE) {
    const token     = new ethers.Contract(from, ERC20_ABI, wallet);
    const allowance = await token.allowance(wallet.address, router.address);
    if (allowance.lt(amountIn)) {
      console.log('🔑 Approving token...');
      const txApprove = await token.approve(router.address, ethers.constants.MaxUint256);
      await txApprove.wait();
      console.log('✅ Approval confirmed');
    }
  }

  // 5. Balance before
  const beforeBal = await new ethers.Contract(to, ERC20_ABI, provider).balanceOf(wallet.address);

  // 6. Execute swap
  const txOptions = { gasLimit: GAS_LIMIT };
  if (from === WNATIVE) txOptions.value = amountIn;

  let tx;
  if (from === WNATIVE) {
    tx = await router.swapExactETHForTokens(
      rawOutMin, path, wallet.address,
      Math.floor(Date.now() / 1000) + DEADLINE_SEC,
      txOptions
    );
  } else {
    tx = await router.swapExactTokensForTokens(
      amountIn, rawOutMin, path, wallet.address,
      Math.floor(Date.now() / 1000) + DEADLINE_SEC,
      txOptions
    );
  }

  console.log(`🚀 Swap tx hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`📋 Receipt status: ${receipt.status === 1 ? '✅ success' : '❌ failed'}`);

  // 7. Balance after & diff
  const afterBal       = await new ethers.Contract(to, ERC20_ABI, provider).balanceOf(wallet.address);
  const actualReceived = afterBal.sub(beforeBal);
  console.log(`✅ Received: ${ethers.utils.formatUnits(actualReceived, decimalsOut)} tokens`);
}

// === Define your pairs here ===
const SWAP_PAIRS = [
  { from: WNATIVE,                                         to: '0x2CCDB83a043A32898496c1030880Eb2cB977CAbc' }, 
  { from: WNATIVE,                                         to: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d' }, 
  { from: '0x2CCDB83a043A32898496c1030880Eb2cB977CAbc',     to: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d' }
];

(async () => {
  console.log('🤖 Starting swaps...');
  for (const { from, to } of SWAP_PAIRS) {
    try {
      await swapToken(from, to, AMOUNT_IN_RAW);
    } catch (e) {
      console.error(`❌ Error swapping ${from} → ${to}:`, e.message);
    }
  }
  console.log('\n🎉 All done!');
})();
