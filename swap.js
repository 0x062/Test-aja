const { ethers } = require('ethers');
const chalk = require('chalk');
require('dotenv').config();

// Load & validate environment variables
const PRIVATE_KEY    = (process.env.PRIVATE_KEY || '').trim();
const RPC_URL        = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE        = process.env.WNATIVE;
const AMOUNT_IN_RAW  = process.env.AMOUNT_IN;             // e.g. "0.001"
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

// Build swap pairs: WNATIVE -> each token, plus each token_i -> token_j (i<j)
const SWAP_PAIRS = [];
for (const token of TOKEN_LIST) {
  SWAP_PAIRS.push({ from: WNATIVE, to: token });
}
for (let i = 0; i < TOKEN_LIST.length; i++) {
  for (let j = i + 1; j < TOKEN_LIST.length; j++) {
    SWAP_PAIRS.push({ from: TOKEN_LIST[i], to: TOKEN_LIST[j] });
  }
}

// Ethers setup
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

// ABIs
const routerAbi = [
  "function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])",
  "function swapExactTokensForETH(uint256,uint256,address[],address,uint256) returns(uint256[])",
  "function getAmountsOut(uint256,address[]) view returns(uint256[])"
];
const erc20Abi = [
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)"
];
const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet);
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Load symbol/decimals for tokens & native
async function loadTokenInfo(addresses) {
  const info = {};
  for (const addr of addresses) {
    if (addr === WNATIVE) {
      info[addr] = { symbol: process.env.NATIVE_SYMBOL || 'NATIVE', decimals: 18 };
    } else {
      const t = new ethers.Contract(addr, erc20Abi, provider);
      try {
        const [sym, dec] = await Promise.all([t.symbol(), t.decimals()]);
        info[addr] = { symbol: sym, decimals: dec };
      } catch {
        info[addr] = { symbol: addr.slice(0,6) + '…', decimals: 18 };
      }
    }
  }
  return info;
}

// Generic swap function
async function swap(from, to, amountRaw, tokenInfo) {
  const { symbol: symIn, decimals: decIn } = tokenInfo[from];
  const { symbol: symOut, decimals: decOut } = tokenInfo[to];
  const amountIn = ethers.utils.parseUnits(amountRaw, decIn);
  const path = from === WNATIVE
    ? [WNATIVE, to]
    : to === WNATIVE
      ? [from, WNATIVE]
      : [from, WNATIVE, to];

  const amountsOut = await router.getAmountsOut(amountIn, path);
  const estimatedOut = amountsOut[amountsOut.length - 1];
  const minOut = estimatedOut.mul(Math.floor((1 - SLIPPAGE) * 1000)).div(1000);
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SEC;

  console.log(chalk.yellow(`\n🔄 Swap ${amountRaw} ${symIn} → ${symOut}`));
  console.log(chalk.yellow(`   est out: ${ethers.utils.formatUnits(estimatedOut, to===WNATIVE?18:decOut)} ${symOut}`));

  // Approve if needed
  if (from !== WNATIVE) {
    const token = new ethers.Contract(from, erc20Abi, wallet);
    const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
    if (allowance.lt(amountIn)) {
      process.stdout.write(chalk.magenta(`   🔑 Approving ${symIn}… `));
      await (await token.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();
      console.log(chalk.magenta('✅'));
    }
  }

  // Execute swap
  const tx = await (from === WNATIVE
    ? router.swapExactETHForTokens(minOut, path, wallet.address, deadline, { value: amountIn, gasLimit: GAS_LIMIT })
    : to === WNATIVE
      ? router.swapExactTokensForETH(amountIn, minOut, path, wallet.address, deadline, { gasLimit: GAS_LIMIT })
      : router.swapExactTokensForTokens(amountIn, minOut, path, wallet.address, deadline, { gasLimit: GAS_LIMIT })
  );
  console.log(chalk.cyan(`   📋 tx hash: ${tx.hash}`));
  const receipt = await tx.wait();
  console.log(receipt.status === 1
    ? chalk.green('   ✅ Swap success')
    : chalk.red('   ❌ Swap failed'));

  console.log(chalk.green(`   🎉 Received: ${ethers.utils.formatUnits(estimatedOut, to===WNATIVE?18:decOut)} ${symOut}`));
}

(async () => {
  console.log(chalk.blue('🤖 Starting swaps…'));

  const allAddrs = Array.from(new Set([WNATIVE, ...TOKEN_LIST]));
  const tokenInfo = await loadTokenInfo(allAddrs);

  // 1. Execute defined token pairs swaps
  for (const { from, to } of SWAP_PAIRS) {
    try {
      await swap(from, to, AMOUNT_IN_RAW, tokenInfo);
    } catch (e) {
      console.error(chalk.red(`❌ Error swapping ${tokenInfo[from].symbol}→${tokenInfo[to].symbol}: ${e.message}`));
    }
    console.log(chalk.gray(`   ⏱ Waiting ${DELAY_MS}ms before next…`));
    await sleep(DELAY_MS);
  }

  // 2. Display balances: native, WNATIVE, then tokens
  console.log(chalk.magenta('\n📊 Balances after swaps:'));
  // Native ETH balance
  const ethBal = await provider.getBalance(wallet.address);
  console.log(`   - ETH: ${parseFloat(ethers.utils.formatEther(ethBal))}`);
  // WNATIVE token balance
  const wToken = new ethers.Contract(WNATIVE, erc20Abi, provider);
  const wBalBN = await wToken.balanceOf(wallet.address);
  console.log(`   - ${tokenInfo[WNATIVE].symbol}: ${parseFloat(ethers.utils.formatUnits(wBalBN, tokenInfo[WNATIVE].decimals))}`);
  // Other tokens
  for (const tokenAddr of TOKEN_LIST) {
    const balBN = await new ethers.Contract(tokenAddr, erc20Abi, provider).balanceOf(wallet.address);
    console.log(`   - ${tokenInfo[tokenAddr].symbol}: ${parseFloat(ethers.utils.formatUnits(balBN, tokenInfo[tokenAddr].decimals))}`);
  }

  // 3. Swap all remaining tokens back to native
  console.log(chalk.blue('\n🔄 Swapping all remaining tokens back to NATIVE…'));
  for (const tokenAddr of TOKEN_LIST) {
    try {
      const balBN = await new ethers.Contract(tokenAddr, erc20Abi, provider).balanceOf(wallet.address);
      if (balBN.isZero()) continue;
      const amountRaw = ethers.utils.formatUnits(balBN, tokenInfo[tokenAddr].decimals);
      await swap(tokenAddr, WNATIVE, amountRaw, tokenInfo);
    } catch (e) {
      console.error(chalk.red(`❌ Error swapping back ${tokenInfo[tokenAddr].symbol}: ${e.message}`));
    }
    console.log(chalk.gray(`   ⏱ Waiting ${DELAY_MS}ms before next…`));
    await sleep(DELAY_MS);
  }

  console.log(chalk.blue('\n🎉 All done!'));
})();
