const { ethers } = require('ethers');
require('dotenv').config();

const PRIVATE_KEY   = (process.env.PRIVATE_KEY||'').trim();
if (!PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length!==66) {
  console.error('❌ PRIVATE_KEY invalid.');
  process.exit(1);
}

const RPC_URL        = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE        = process.env.WNATIVE;
const AMOUNT_IN_RAW  = process.env.AMOUNT_IN;           
const SLIPPAGE       = parseFloat(process.env.SLIPPAGE)/100;  
const DEADLINE_SEC   = parseInt(process.env.DEADLINE_MINUTES,10)*60;
const GAS_LIMIT      = parseInt(process.env.GAS_LIMIT,10);

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const router   = new ethers.Contract(
  ROUTER_ADDRESS,
  [
    "function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])",
    "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])",
    "function getAmountsOut(uint256,address[]) view returns(uint256[])"
  ],
  wallet
);

const ERC20_ABI = [
  "function decimals() view returns(uint8)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)"
];

async function swapToken(from, to, amountRaw) {
  const decimalsIn  = from===WNATIVE ? 18 : await new ethers.Contract(from, ERC20_ABI, provider).decimals();
  const decimalsOut = to  ===WNATIVE ? 18 : await new ethers.Contract(to,   ERC20_ABI, provider).decimals();

  const amountIn = ethers.utils.parseUnits(amountRaw, decimalsIn);
  const path     = from===WNATIVE ? [WNATIVE,to] : [from,WNATIVE,to];

  const amountsOut    = await router.getAmountsOut(amountIn, path);
  const estimatedOut  = amountsOut[amountsOut.length-1];
  const minOut        = estimatedOut.mul(Math.floor((1-SLIPPAGE)*1000)).div(1000);
  const deadline      = Math.floor(Date.now()/1000) + DEADLINE_SEC;

  console.log(`\n🔄 Swap ${amountRaw} (${decimalsIn}d) via [${path.join('→')}]`);
  console.log(`   est out: ${ethers.utils.formatUnits(estimatedOut,  decimalsOut)}`);
  console.log(`   min out: ${ethers.utils.formatUnits(minOut,        decimalsOut)}`);

  if (from !== WNATIVE) {
    const token     = new ethers.Contract(from, ERC20_ABI, wallet);
    const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
    if (allowance.lt(amountIn)) {
      console.log('🔑 Approving...');
      await (await token.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();
      console.log('   Approved');
    }
  }

  const before = await new ethers.Contract(to, ERC20_ABI, provider).balanceOf(wallet.address);

  let tx;
  if (from === WNATIVE) {
    tx = await router[
      "swapExactETHForTokens(uint256,address[],address,uint256)"
    ](minOut, path, wallet.address, deadline, {
      value: amountIn,
      gasLimit: GAS_LIMIT
    });
  } else {
    tx = await router[
      "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
    ](
      amountIn,
      minOut,
      path,
      wallet.address,
      deadline,
      { gasLimit: GAS_LIMIT }
    );
  }

  console.log('🚀 tx hash:', tx.hash);
  const receipt = await tx.wait();
  console.log('📋 status:', receipt.status===1 ? '✅' : '❌');

  const after = await new ethers.Contract(to, ERC20_ABI, provider).balanceOf(wallet.address);
  console.log('✅ received:', ethers.utils.formatUnits(after.sub(before), decimalsOut));
}

const SWAP_PAIRS = [
  { from: WNATIVE, to: "0x2CCDB83a043A32898496c1030880Eb2cB977CAbc" },
  { from: WNATIVE, to: "0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d" },
  { from: "0x2CCDB83a043A32898496c1030880Eb2cB977CAbc",
    to: "0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d" }
];

(async()=>{
  for(const {from,to} of SWAP_PAIRS) {
    try { await swapToken(from,to,AMOUNT_IN_RAW); }
    catch(e){ console.error('❌ swap error',e.message); }
  }
  console.log('\n🎉 Done!');
})();
