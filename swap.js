const { ethers } = require('ethers');
require('dotenv').config();

const PRIVATE_KEY    = (process.env.PRIVATE_KEY || '').trim();
if (!PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length !== 66) process.exit(1);
const RPC_URL        = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE        = process.env.WNATIVE;
const NATIVE_SYMBOL  = process.env.NATIVE_SYMBOL || 'NATIVE';
const AMOUNT_IN_RAW  = process.env.AMOUNT_IN;
const SLIPPAGE       = parseFloat(process.env.SLIPPAGE) / 100;
const DEADLINE_SEC   = parseInt(process.env.DEADLINE_MINUTES, 10) * 60;
const GAS_LIMIT      = parseInt(process.env.GAS_LIMIT, 10);

const SWAP_PAIRS = [
  { from: WNATIVE, to: '0x2CCDB83a043A32898496c1030880Eb2cB977CAbc' },
  { from: WNATIVE, to: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d' },
  { from: '0x2CCDB83a043A32898496c1030880Eb2cB977CAbc', to: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d' }
];

const ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin,address[] calldata path,address to,uint deadline) payable external returns (uint[] memory)",
  "function swapExactTokensForTokens(uint amountIn,uint amountOutMin,address[] calldata path,address to,uint deadline) external returns (uint[] memory)",
  "function getAmountsOut(uint amountIn,address[] calldata path) external view returns (uint[] memory)"
];

const ERC20_ABI = [
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) external returns(bool)"
];

const BALANCE_ABI = [
  "function balanceOf(address) view returns(uint256)"
];

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const router   = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

(async () => {
  const { chainId } = await provider.getNetwork();
  console.log(`🌐 Network chainId=${chainId}`);

  const tokenInfo = {};
  for (const { from, to } of SWAP_PAIRS) {
    [from, to].forEach(addr => {
      if (!tokenInfo[addr]) tokenInfo[addr] = {};
    });
  }
  tokenInfo[WNATIVE].symbol   = NATIVE_SYMBOL;
  tokenInfo[WNATIVE].decimals = 18;

  for (const addr of Object.keys(tokenInfo)) {
    if (addr === WNATIVE) continue;
    const t = new ethers.Contract(addr, ERC20_ABI, provider);
    try {
      tokenInfo[addr].symbol   = await t.symbol();
      tokenInfo[addr].decimals = await t.decimals();
    } catch {
      tokenInfo[addr].symbol   = addr;
      tokenInfo[addr].decimals = 18;
    }
  }

  const AMOUNT_IN_GENERIC = AMOUNT_IN_RAW;

  console.log(`\n🔍 Balances for ${wallet.address}`);
  const balETH = await provider.getBalance(wallet.address);
  console.log(`💰 ${NATIVE_SYMBOL}: ${ethers.utils.formatEther(balETH)}`);
  for (const addr of Object.keys(tokenInfo)) {
    if (addr === WNATIVE) continue;
    const t = new ethers.Contract(addr, BALANCE_ABI, provider);
    const b = await t.balanceOf(wallet.address);
    console.log(`💳 ${tokenInfo[addr].symbol}: ${ethers.utils.formatUnits(b, tokenInfo[addr].decimals)}`);
  }

  console.log(`\n🤖 Executing swaps...`);
  for (const { from, to } of SWAP_PAIRS) {
    const infoFrom = tokenInfo[from];
    const infoTo   = tokenInfo[to];
    const amountIn = ethers.utils.parseUnits(AMOUNT_IN_GENERIC, infoFrom.decimals);
    const path     = (from === WNATIVE) ? [WNATIVE, to] : [from, WNATIVE, to];

    console.log(`\n🔄 Swap ${infoFrom.symbol}→${infoTo.symbol}`);

    let amounts;
    try {
      amounts = await router.getAmountsOut(amountIn, path);
    } catch (e) {
      console.error(`❌ estimate failed: ${e.message}`);
      continue;
    }

    const rawOutMin = amounts[amounts.length - 1]
      .mul(ethers.BigNumber.from(Math.floor((1 - SLIPPAGE) * 1000)))
      .div(ethers.BigNumber.from(1000));

    console.log(`➡️ simulate getAmountsOut: ${ethers.utils.formatUnits(amounts[amounts.length - 1], infoTo.decimals)} ${infoTo.symbol}`);

    const before = await new ethers.Contract(to, BALANCE_ABI, provider).balanceOf(wallet.address);

    try {
      const simulate = await router.callStatic.swapExactTokensForTokens(
        amountIn,
        rawOutMin,
        path,
        wallet.address,
        Math.floor(Date.now() / 1000) + DEADLINE_SEC
      );
      console.log(`🔍 simulate output: ${ethers.utils.formatUnits(simulate[simulate.length - 1], infoTo.decimals)} ${infoTo.symbol}`);
    } catch {
      // skip simulation if it's the native swap
    }

    if (from !== WNATIVE) {
      const token     = new ethers.Contract(from, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
      if (allowance.lt(amountIn)) {
        const approveTx = await token.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
        await approveTx.wait();
      }
    }

    const feeData = await provider.getFeeData();
    const maxFee  = feeData.maxFeePerGas.mul(110).div(100);
    const maxPri  = feeData.maxPriorityFeePerGas.mul(110).div(100);

    let tx;
    if (from === WNATIVE) {
      tx = await router.swapExactETHForTokens(
        rawOutMin,
        path,
        wallet.address,
        Math.floor(Date.now() / 1000) + DEADLINE_SEC,
        { value: amountIn, gasLimit: GAS_LIMIT, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPri }
      );
    } else {
      tx = await router.swapExactTokensForTokens(
        amountIn,
        rawOutMin,
        path,
        wallet.address,
        Math.floor(Date.now() / 1000) + DEADLINE_SEC,
        { gasLimit: GAS_LIMIT, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPri }
      );
    }

    console.log(`🚀 tx hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`📋 receipt status: ${receipt.status === 1 ? 'success' : 'failed'}`);

    const after = await new ethers.Contract(to, BALANCE_ABI, provider).balanceOf(wallet.address);
    const diff  = ethers.BigNumber.from(after).sub(before);
    console.log(`✅ actual received: ${ethers.utils.formatUnits(diff, infoTo.decimals)} ${infoTo.symbol}`);
  }

  console.log('\n🎉 All done!');
})();
