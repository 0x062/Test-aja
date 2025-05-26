const { ethers } = require('ethers');
const chalk = require('chalk');
require('dotenv').config();

// Load & validate environment variables
const PRIVATE_KEY    = (process.env.PRIVATE_KEY || '').trim();
const RPC_URL        = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE        = process.env.WNATIVE;
const AMOUNT_IN_RAW  = process.env.AMOUNT_IN;
const SLIPPAGE       = parseFloat(process.env.SLIPPAGE) / 100;
const DEADLINE_SEC   = parseInt(process.env.DEADLINE_MINUTES, 10) * 60;
const GAS_LIMIT      = parseInt(process.env.GAS_LIMIT, 10);
const DELAY_MS       = parseInt(process.env.DELAY_MS, 10) || 5000;
const TOKENS_ENV     = process.env.TOKENS || '';

// Basic env checks
if (!PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length !== 66) {
  console.error(chalk.red('❌ PRIVATE_KEY invalid or missing.'));
  process.exit(1);
}
if (!RPC_URL || !ROUTER_ADDRESS || !WNATIVE || !AMOUNT_IN_RAW || !TOKENS_ENV) {
  console.error(chalk.red('❌ Missing required env vars: RPC_URL, ROUTER_ADDRESS, WNATIVE, AMOUNT_IN, TOKENS'));
  process.exit(1);
}

// Parse token list
const TOKEN_LIST = TOKENS_ENV.split(',').map(t => t.trim()).filter(t => t);
if (TOKEN_LIST.length === 0) {
  console.error(chalk.red('❌ TOKENS env var must contain at least one token address.'));
  process.exit(1);
}

// Build swap pairs: WNATIVE -> each token, plus token->token
const SWAP_PAIRS = [];
for (const token of TOKEN_LIST) SWAP_PAIRS.push({ from: WNATIVE, to: token });
for (let i = 0; i < TOKEN_LIST.length; i++) for (let j = i + 1; j < TOKEN_LIST.length; j++) SWAP_PAIRS.push({ from: TOKEN_LIST[i], to: TOKEN_LIST[j] });

// Ethers setup
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

// ABIs
const routerAbi = [
  'function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])',
  'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])',
  'function swapExactTokensForETH(uint256,uint256,address[],address,uint256) returns(uint256[])',
  'function getAmountsOut(uint256,address[]) view returns(uint256[])'
];
const erc20Abi = ['function symbol() view returns(string)', 'function decimals() view returns(uint8)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'];
const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet);
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Load symbol/decimals
async function loadTokenInfo(addrs) {
  const info = {};
  for (const addr of addrs) {
    if (addr === WNATIVE) {
      info[addr] = { symbol: process.env.NATIVE_SYMBOL || 'ETH', decimals: 18 };
    } else {
      const c = new ethers.Contract(addr, erc20Abi, provider);
      try { const [sym, dec] = await Promise.all([c.symbol(), c.decimals()]); info[addr] = { symbol: sym, decimals: dec }; }
      catch { info[addr] = { symbol: addr.slice(0,6)+'…', decimals:18 }; }
    }
  }
  return info;
}

// Generic swap with gas check
async function swap(from, to, amountRaw, tokenInfo) {
  const { symbol: symIn, decimals: decIn } = tokenInfo[from];
  const { symbol: symOut, decimals: decOut } = tokenInfo[to];
  const amountIn = ethers.utils.parseUnits(amountRaw, decIn);
  const path = from === WNATIVE ? [WNATIVE, to] : to === WNATIVE ? [from, WNATIVE] : [from, WNATIVE, to];

  const gasPrice = await provider.getGasPrice();
  const ethBal   = await provider.getBalance(wallet.address);
  const feeCost  = gasPrice.mul(GAS_LIMIT);
  const totalCost = from === WNATIVE ? feeCost.add(amountIn) : feeCost;
  if (ethBal.lt(totalCost)) {
    console.error(chalk.red(`❌ Skip ${symIn}->${symOut}: need ${(ethers.utils.formatEther(totalCost))} ETH for gas${from===WNATIVE?'+value':''}, have ${ethers.utils.formatEther(ethBal)}`));
    return;
  }

  const amountsOut = await router.getAmountsOut(amountIn, path);
  const estOut = amountsOut[amountsOut.length-1];
  const minOut = estOut.mul(Math.floor((1-SLIPPAGE)*1000)).div(1000);
  const dl = Math.floor(Date.now()/1000)+DEADLINE_SEC;

  console.log(chalk.yellow(`\n🔄 Swap ${amountRaw} ${symIn} → ${symOut}`));
  console.log(chalk.yellow(`   est out: ${ethers.utils.formatUnits(estOut, to===WNATIVE?18:decOut)} ${symOut}`));

  if (from!==WNATIVE) {
    const t = new ethers.Contract(from, erc20Abi, wallet);
    const al = await t.allowance(wallet.address, ROUTER_ADDRESS);
    if (al.lt(amountIn)) { process.stdout.write(chalk.magenta(`   🔑 Approving ${symIn}… `)); await (await t.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait(); console.log('✅'); }
  }

  // Execute
  const tx = from===WNATIVE
    ? await router.swapExactETHForTokens(minOut, path, wallet.address, dl, { value: amountIn, gasLimit:GAS_LIMIT, gasPrice })
    : to===WNATIVE
      ? await router.swapExactTokensForETH(amountIn, minOut, path, wallet.address, dl, { gasLimit:GAS_LIMIT, gasPrice })
      : await router.swapExactTokensForTokens(amountIn, minOut, path, wallet.address, dl, { gasLimit:GAS_LIMIT, gasPrice });

  console.log(chalk.cyan(`   📋 tx hash: ${tx.hash}`));
  const rec = await tx.wait();
  console.log(rec.status===1?chalk.green('   ✅ Swap success'):chalk.red('   ❌ Swap failed'));
  console.log(chalk.green(`   🎉 Received: ${ethers.utils.formatUnits(estOut, to===WNATIVE?18:decOut)} ${symOut}`));
}

(async () => {
  console.log(chalk.blue('🤖 Starting swaps…'));
  const addrs = Array.from(new Set([WNATIVE, ...TOKEN_LIST]));
  const info = await loadTokenInfo(addrs);

  // 1. defined pairs
  for(const {from,to} of SWAP_PAIRS){ try{ await swap(from,to,AMOUNT_IN_RAW,info);}catch(e){console.error(chalk.red(e.message));} console.log(chalk.gray(`⏱ Waiting ${DELAY_MS}ms`)); await sleep(DELAY_MS);}  

  // 2. balances
  console.log(chalk.magenta('\n📊 Balances after swaps:'));
  const ethB = await provider.getBalance(wallet.address);
  console.log(`   - XOS: ${parseFloat(ethers.utils.formatEther(ethB))}`);
  const wB = await new ethers.Contract(WNATIVE,erc20Abi,provider).balanceOf(wallet.address);
  console.log(`   - ${info[WNATIVE].symbol}: ${parseFloat(ethers.utils.formatUnits(wB,info[WNATIVE].decimals))}`);
  for(const tk of TOKEN_LIST){ const b=await new ethers.Contract(tk,erc20Abi,provider).balanceOf(wallet.address); console.log(`   - ${info[tk].symbol}: ${parseFloat(ethers.utils.formatUnits(b,info[tk].decimals))}`);} 

  // 3. swap back
  console.log(chalk.blue('\n🔄 Swapping remaining tokens to XOS…'));
  for(const tk of TOKEN_LIST){ const bn=await new ethers.Contract(tk,erc20Abi,provider).balanceOf(wallet.address); if(bn.isZero())continue; await swap(tk,WNATIVE,ethers.utils.formatUnits(bn,info[tk].decimals),info); console.log(chalk.gray(`⏱ Waiting ${DELAY_MS}ms`)); await sleep(DELAY_MS);}  
  console.log(chalk.blue('\n🎉 All done!'));
})();
