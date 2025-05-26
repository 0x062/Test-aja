const { ethers } = require('ethers');
const chalk = require('chalk');
require('dotenv').config();

// Load & validate environment variables
const PRIVATE_KEY    = (process.env.PRIVATE_KEY || '').trim();
const RPC_URL        = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE        = process.env.WNATIVE;
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
if (!RPC_URL || !ROUTER_ADDRESS || !WNATIVE || !TOKENS_ENV) {
  console.error(chalk.red('❌ Missing required env vars: RPC_URL, ROUTER_ADDRESS, WNATIVE, TOKENS'));
  process.exit(1);
}

// Parse token list (ERC-20) to swap back to native
const TOKEN_LIST = TOKENS_ENV.split(',').map(t => t.trim()).filter(t => t);
if (TOKEN_LIST.length === 0) {
  console.error(chalk.red('❌ TOKENS env var must contain at least one token address.'));
  process.exit(1);
}

// Ethers setup
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const routerAbi = [
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

(async () => {
  console.log(chalk.blue('🤖 Starting token balance check and swaps…'));

  // Load token info
  const allAddrs = Array.from(new Set([WNATIVE, ...TOKEN_LIST]));
  const tokenInfo = await loadTokenInfo(allAddrs);

  // Display all balances before swapping
  console.log(chalk.magenta('\n📊 Current token balances:'));
  for (const tokenAddr of TOKEN_LIST) {
    const t = new ethers.Contract(tokenAddr, erc20Abi, provider);
    const balanceBN = await t.balanceOf(wallet.address);
    const { symbol, decimals } = tokenInfo[tokenAddr];
    const bal = parseFloat(ethers.utils.formatUnits(balanceBN, decimals));
    console.log(bal > 0
      ? `   - ${symbol}: ${bal}`
      : `   - ${symbol}: 0 (skipping)`
    );
  }

  // Swap each token with non-zero balance to native
  for (const tokenAddr of TOKEN_LIST) {
    const { symbol, decimals } = tokenInfo[tokenAddr];
    try {
      const tokenContract = new ethers.Contract(tokenAddr, erc20Abi, provider);
      const balanceBN = await tokenContract.balanceOf(wallet.address);
      if (balanceBN.isZero()) continue;
      const amountRaw = ethers.utils.formatUnits(balanceBN, decimals);

      // prepare swap
      const amountIn = ethers.utils.parseUnits(amountRaw, decimals);
      const path = [tokenAddr, WNATIVE];
      const amountsOut = await router.getAmountsOut(amountIn, path);
      const estimatedOut = amountsOut[amountsOut.length - 1];
      const minOut = estimatedOut.mul(Math.floor((1 - SLIPPAGE) * 1000)).div(1000);
      const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SEC;

      console.log(chalk.yellow(`\n🔄 Swapping all ${symbol} → NATIVE (${amountRaw} ${symbol})`));
      console.log(chalk.yellow(`   est out: ${ethers.utils.formatUnits(estimatedOut, 18)} NATIVE`));

      // approve if needed
      const token = new ethers.Contract(tokenAddr, erc20Abi, wallet);
      const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
      if (allowance.lt(amountIn)) {
        process.stdout.write(chalk.magenta(`   🔑 Approving ${symbol}… `));
        await (await token.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();
        console.log(chalk.magenta('✅'));  
      }

      // execute swap
      console.log(chalk.cyan('   🚀 Sending swap txn…'));
      const tx = await router.swapExactTokensForETH(amountIn, minOut, path, wallet.address, deadline, { gasLimit: GAS_LIMIT });
      console.log(chalk.cyan(`   📋 tx hash: ${tx.hash}`));
      const receipt = await tx.wait();
      console.log(receipt.status === 1
        ? chalk.green('   ✅ Swap success')
        : chalk.red('   ❌ Swap failed'));

      console.log(chalk.green(`   🎉 Received: ~${ethers.utils.formatUnits(estimatedOut, 18)} NATIVE`));
    } catch (e) {
      console.error(chalk.red(`❌ Error swapping ${symbol}: ${e.message}`));
    }
    console.log(chalk.gray(`   ⏱ Waiting ${DELAY_MS}ms before next…`));
    await sleep(DELAY_MS);
  }

  console.log(chalk.blue('\n🎉 All done! Tokens swapped to native.'));
})();
