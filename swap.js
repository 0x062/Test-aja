// AutoSwap Bot in JavaScript using ethers.js
// Extended: support both native→token and token→token (multi-hop via WNATIVE)

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
// AMOUNT_IN=0.001                      // in native units or token units
// SLIPPAGE=1                           // in percent
// DEADLINE_MINUTES=10                  // deadline offset in minutes
// GAS_LIMIT=210000                     // lowered gasLimit

const { ethers } = require('ethers');
require('dotenv').config();

// Validate & load config
const PRIVATE_KEY = (process.env.PRIVATE_KEY||'').trim();
if (!PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length!==66) {
  console.error('❌ PRIVATE_KEY invalid.'); process.exit(1);
}
const RPC_URL        = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE        = process.env.WNATIVE;
const NATIVE_SYMBOL  = process.env.NATIVE_SYMBOL||'NATIVE';
const AMOUNT_IN_RAW  = process.env.AMOUNT_IN;
const SLIPPAGE       = parseFloat(process.env.SLIPPAGE)/100;
const DEADLINE_SEC   = parseInt(process.env.DEADLINE_MINUTES,10)*60;
const GAS_LIMIT      = parseInt(process.env.GAS_LIMIT,10);

// Define swap pairs: use WNATIVE for native→token or multi-hop
// Example includes native→USDT, native→USDC, and USDT→USDC
const SWAP_PAIRS = [
  { from: WNATIVE, to: '0x2CCDB83a043A32898496c1030880Eb2cB977CAbc' }, // XOS→USDT
  { from: WNATIVE, to: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d' }, // XOS→USDC
  { from: '0x2CCDB83a043A32898496c1030880Eb2cB977CAbc', to: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d' } // USDT→USDC
];

// ABIs
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

(async()=>{
  // get network
  const { chainId } = await provider.getNetwork();
  console.log(`🌐 Network chainId=${chainId}`);

  // gather metadata and parse raw amount
  const tokenInfo = {};
  for(const {from,to} of SWAP_PAIRS){
    [from,to].forEach(addr=>{ if(!tokenInfo[addr]) tokenInfo[addr]={}; });
  }
  tokenInfo[WNATIVE].symbol = NATIVE_SYMBOL; tokenInfo[WNATIVE].decimals = 18;

  for(const addr of Object.keys(tokenInfo)){
    if(addr===WNATIVE) continue;
    const t = new ethers.Contract(addr, ERC20_ABI, provider);
    try{
      tokenInfo[addr].symbol = await t.symbol();
      tokenInfo[addr].decimals = await t.decimals();
    }catch{
      tokenInfo[addr].symbol = addr;
      tokenInfo[addr].decimals = 18;
    }
  }

  // parse amount in
  const AMOUNT_IN = ethers.utils.parseUnits(AMOUNT_IN_RAW, 18);

  // initial balances
  console.log(`\n🔍 Balances for ${wallet.address}`);
  const balETH = await provider.getBalance(wallet.address);
  console.log(`💰 ${NATIVE_SYMBOL}: ${ethers.utils.formatEther(balETH)}`);
  for(const addr of Object.keys(tokenInfo)){
    if(addr===WNATIVE) continue;
    const t = new ethers.Contract(addr, BALANCE_ABI, provider);
    const b = await t.balanceOf(wallet.address);
    console.log(`💳 ${tokenInfo[addr].symbol}: ${ethers.utils.formatUnits(b, tokenInfo[addr].decimals)}`);
  }

  // perform swaps
  console.log(`\n🤖 Executing swaps...`);
  for(const {from,to} of SWAP_PAIRS){
    const infoFrom = tokenInfo[from], infoTo = tokenInfo[to];
    const isNative = (from===WNATIVE);
    // build path: if input and output neither native only token->token route via WNATIVE
    const path = isNative ? [WNATIVE,to] : [from,WNATIVE,to];

    console.log(`\n🔄 Swap ${infoFrom.symbol}→${infoTo.symbol}`);
    // estimate
    let amounts;
    try{ amounts = await router.getAmountsOut(AMOUNT_IN, path); }
    catch(e){ console.error(`❌ estimate failed: ${e.message}`); continue; }

    const rawOutMin = amounts[amounts.length-1]
      .mul(ethers.BigNumber.from(Math.floor((1-SLIPPAGE)*1000)))
      .div(ethers.BigNumber.from(1000));
    const fmtIn  = ethers.utils.formatUnits(AMOUNT_IN, infoFrom.decimals);
    const fmtOut = ethers.utils.formatUnits(rawOutMin, infoTo.decimals);
    console.log(`➡️ ${fmtIn} ${infoFrom.symbol} → ≥ ${fmtOut} ${infoTo.symbol}`);

    // approval if needed
    if(!isNative){
      const token = new ethers.Contract(from, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
      if(allowance.lt(AMOUNT_IN)){
        console.log(`🔑 Approving ${infoFrom.symbol}...`);
        await token.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256);
      }
    }

    // gas fees
    const feeData = await provider.getFeeData();
    const maxFee = feeData.maxFeePerGas.mul(110).div(100);
    const maxPri = feeData.maxPriorityFeePerGas.mul(110).div(100);

    // execute txn
    try{
      let tx;
      if(isNative){
        tx = await router.swapExactETHForTokens(rawOutMin, path, wallet.address, Math.floor(Date.now()/1000)+DEADLINE_SEC,
          { value: AMOUNT_IN, gasLimit:GAS_LIMIT, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPri });
      } else {
        tx = await router.swapExactTokensForTokens(AMOUNT_IN, rawOutMin, path, wallet.address, Math.floor(Date.now()/1000)+DEADLINE_SEC,
          { gasLimit:GAS_LIMIT, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPri });
      }
      console.log(`🚀 Tx (${infoTo.symbol}): ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`✅ Confirmed in block ${rc.blockNumber}`);
    } catch(e){
      console.error(`❌ Swap failed: ${e.message}`);
    }
  }

  console.log('\n🎉 All done!');
})();
