const { ethers } = require('ethers');
const chalk = require('chalk');
require('dotenv').config();

// --- Konfigurasi & Validasi ---
const PRIVATE_KEY = (process.env.PRIVATE_KEY || '').trim();
const RPC_URL = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE = process.env.WNATIVE;
const NATIVE_SYMBOL = process.env.NATIVE_SYMBOL || 'ETH';
const AMOUNT_IN_RAW = process.env.AMOUNT_IN;
const SLIPPAGE = parseFloat(process.env.SLIPPAGE || '1') / 100;
const DEADLINE_SEC = parseInt(process.env.DEADLINE_MINUTES || '5', 10) * 60;
const GAS_LIMIT = parseInt(process.env.GAS_LIMIT || '300000', 10); // Sedikit dinaikkan untuk jaga-jaga
const DELAY_MS = parseInt(process.env.DELAY_MS, 10) || 5000;
const TOKENS_ENV = process.env.TOKENS || '';

if (!PRIVATE_KEY || !PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length !== 66) { console.error(chalk.red('❌ PRIVATE_KEY tidak valid atau hilang di .env')); process.exit(1); }
if (!RPC_URL || !ROUTER_ADDRESS || !WNATIVE || !AMOUNT_IN_RAW || !TOKENS_ENV) { console.error(chalk.red('❌ Variabel .env yang wajib diisi hilang.')); process.exit(1); }
const TOKEN_LIST = TOKENS_ENV.split(',').map(t => ethers.utils.getAddress(t.trim())).filter(t => t);
if (TOKEN_LIST.length === 0) { console.error(chalk.red('❌ Variabel TOKENS harus berisi setidaknya satu alamat token.')); process.exit(1); }

const SWAP_PAIRS = [];
TOKEN_LIST.forEach(token => SWAP_PAIRS.push({ from: WNATIVE, to: token }));
for (let i = 0; i < TOKEN_LIST.length; i++) { for (let j = 0; j < TOKEN_LIST.length; j++) { if (i !== j) { SWAP_PAIRS.push({ from: TOKEN_LIST[i], to: TOKEN_LIST[j] }); } } }

// --- Setup Ethers.js ---
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// --- ABI (Application Binary Interface) ---
const routerAbi = [
    'function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])',
    'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])',
    'function swapExactTokensForETH(uint256,uint256,address[],address,uint256) returns(uint256[])',
    'function getAmountsOut(uint256,address[]) view returns(uint256[])',
    'function WETH() view returns (address)'
];
const erc20Abi = [
    'function symbol() view returns(string)',
    'function decimals() view returns(uint8)',
    'function allowance(address,address) view returns(uint256)',
    'function approve(address,uint256) returns(bool)',
    'function balanceOf(address) view returns(uint256)'
];
const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet);
const sleep = ms => new Promise(res => setTimeout(res, ms));

// --- Fungsi Helper Cantik ---
const logLine = (color = 'blue', length = 70) => console.log(chalk[color]('='.repeat(length)));
const logHeader = (text, color = 'blue') => {
    console.log(''); // Beri spasi sebelum header
    logLine(color);
    console.log(chalk[color].bold(` ${text} `));
    logLine(color);
};
const logInfo = (key, value) => console.log(`  ${chalk.gray(key.padEnd(18, ' '))} ${chalk.cyan(value)}`);
const logStep = (text) => console.log(`\n  ${chalk.yellow.bold('»')} ${chalk.yellow(text)}`);
const logSubStep = (text) => console.log(`    ${chalk.gray('›')} ${chalk.gray(text)}`);
const logSuccess = (text) => console.log(`  ${chalk.green.bold('✔')} ${chalk.green(text)}`);
const logFailure = (text, error = null) => {
    console.error(`  ${chalk.red.bold('✖')} ${chalk.red(text)}`);
    if (error) {
        if (error.reason) console.error(chalk.red.dim(`      Reason: ${error.reason}`));
        if (error.code) console.error(chalk.red.dim(`      Code: ${error.code}`));
    }
}

// --- Fungsi Helper Inti ---
async function loadTokenInfo(addrs) {
    logHeader('1. MEMUAT INFORMASI TOKEN', 'magenta');
    const info = {};
    for (const addr of addrs) {
        if (!info[addr]) {
            if (addr.toLowerCase() === WNATIVE.toLowerCase()) {
                info[addr] = { symbol: NATIVE_SYMBOL, decimals: 18 };
            } else {
                const contract = new ethers.Contract(addr, erc20Abi, provider);
                try {
                    const [sym, dec] = await Promise.all([contract.symbol(), contract.decimals()]);
                    info[addr] = { symbol: sym, decimals: dec };
                } catch (e) {
                    info[addr] = { symbol: addr.slice(0, 6) + '…', decimals: 18 };
                }
            }
             logInfo(info[addr].symbol, `${addr} (${info[addr].decimals} decimals)`);
        }
    }
    return info;
}

async function ensureAllowance(tokenAddress, amountIn, tokenInfo) {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
    const allowance = await tokenContract.allowance(wallet.address, ROUTER_ADDRESS);
    const sym = tokenInfo[tokenAddress].symbol;

    if (allowance.lt(amountIn)) {
        process.stdout.write(`    ${chalk.magenta('🔑 Memberikan approval untuk')} ${chalk.magenta.bold(sym)}... `);
        try {
            const approveTx = await tokenContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256, { gasPrice: await provider.getGasPrice(), gasLimit: 80000 });
            await approveTx.wait();
            console.log(chalk.green('✅'));
            await sleep(1000);
        } catch (e) {
            console.log(chalk.red('❌'));
            logFailure(`Gagal approval untuk ${sym}`, e);
            throw new Error(`Approval failed for ${sym}`);
        }
    } else {
         logSubStep(`Allowance ${sym} sudah cukup.`);
    }
}

async function getSwapPath(from, to, amountIn, tokenInfo) {
    const pathsToTry = [];
    if (from.toLowerCase() === WNATIVE.toLowerCase()) pathsToTry.push([WNATIVE, to]);
    else if (to.toLowerCase() === WNATIVE.toLowerCase()) pathsToTry.push([from, WNATIVE]);
    else { pathsToTry.push([from, to]); pathsToTry.push([from, WNATIVE, to]); }

    for (const path of pathsToTry) {
        try {
            await router.getAmountsOut(amountIn, path);
            logSubStep(`Path ditemukan: ${chalk.cyan(path.map(p => tokenInfo[p].symbol).join(' → '))}`);
            return path;
        } catch (e) { /* Abaikan */ }
    }
    return null;
}

async function showBalances(allAddrs, tkInfo) {
    logHeader('📊 SALDO SAAT INI', 'magenta');
    const balanceData = [];

    const nativeBal = await provider.getBalance(wallet.address);
    balanceData.push({ Token: NATIVE_SYMBOL, Alamat: 'N/A', Saldo: ethers.utils.formatEther(nativeBal), Color: 'yellow' });

    for (const addr of allAddrs) {
        const contract = new ethers.Contract(addr, erc20Abi, provider);
        const balance = await contract.balanceOf(wallet.address);
        if (!balance.isZero() || addr.toLowerCase() === WNATIVE.toLowerCase()) {
             balanceData.push({ Token: tkInfo[addr].symbol, Alamat: addr, Saldo: ethers.utils.formatUnits(balance, tkInfo[addr].decimals), Color: 'cyan' });
        }
    }

    const maxTokenLen = Math.max(...balanceData.map(b => b.Token.length), 'Token'.length);
    const maxAddrLen = Math.max(...balanceData.map(b => b.Alamat.length), 'Alamat'.length);
    const maxBalLen = Math.max(...balanceData.map(b => b.Saldo.length), 'Saldo'.length);
    const line = `  +-${'-'.repeat(maxTokenLen)}-+-${'-'.repeat(maxAddrLen)}-+-${'-'.repeat(maxBalLen)}-+`;

    console.log(chalk.gray(line));
    console.log(`  | ${chalk.bold('Token'.padEnd(maxTokenLen))} | ${chalk.bold('Alamat'.padEnd(maxAddrLen))} | ${chalk.bold('Saldo'.padEnd(maxBalLen))} |`);
    console.log(chalk.gray(line));
    balanceData.forEach(item => {
        const token = chalk[item.Color].bold(item.Token.padEnd(maxTokenLen));
        const alamat = chalk.gray(item.Alamat.padEnd(maxAddrLen));
        const saldo = chalk.white(item.Saldo.padEnd(maxBalLen));
        console.log(`  | ${token} | ${alamat} | ${saldo} |`);
    });
    console.log(chalk.gray(line));
}

async function executeSwap(from, to, amountRaw, tokenInfo) {
    const { symbol: symIn, decimals: decIn } = tokenInfo[from];
    const amountIn = ethers.utils.parseUnits(amountRaw, decIn);
    const symOut = tokenInfo[to].symbol; // Ambil symOut lebih awal

    logStep(`Swap ${chalk.bold(amountRaw)} ${chalk.bold(symIn)} → ${chalk.bold(symOut)}`);

    const gasPrice = await provider.getGasPrice();
    const ethBal = await provider.getBalance(wallet.address);
    const feeCost = gasPrice.mul(GAS_LIMIT);
    const totalCost = (from.toLowerCase() === WNATIVE.toLowerCase()) ? feeCost.add(amountIn) : feeCost;

    if (ethBal.lt(totalCost)) {
        logFailure(`Saldo ${NATIVE_SYMBOL} tidak cukup (Butuh: ~${ethers.utils.formatEther(totalCost)})`);
        return false;
    }

    const path = await getSwapPath(from, to, amountIn, tokenInfo);
    if (!path) {
        logFailure(`Tidak ditemukan path yang valid.`);
        return false;
    }

    const amountsOut = await router.getAmountsOut(amountIn, path);
    const estOut = amountsOut[amountsOut.length - 1];
    const minOut = estOut.mul(Math.floor((1 - SLIPPAGE) * 10000)).div(10000);
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SEC;
    const finalTokenAddress = path[path.length - 1];
    const finalSymOut = tokenInfo[finalTokenAddress].symbol;
    const finalDecOut = tokenInfo[finalTokenAddress].decimals;

    logSubStep(`Est. Out   : ${chalk.green(ethers.utils.formatUnits(estOut, finalDecOut))} ${finalSymOut}`);
    logSubStep(`Min. Out   : ${chalk.yellow(ethers.utils.formatUnits(minOut, finalDecOut))} ${finalSymOut}`);

    if (from.toLowerCase() !== WNATIVE.toLowerCase()) { try { await ensureAllowance(from, amountIn, tokenInfo); } catch (e) { return false; } }

    let tx;
    try {
        const overrides = { gasLimit: GAS_LIMIT, gasPrice };
        if (path[0].toLowerCase() === WNATIVE.toLowerCase()) {
            overrides.value = amountIn;
            tx = await router.swapExactETHForTokens(minOut, path, wallet.address, deadline, overrides);
        } else if (path[path.length - 1].toLowerCase() === WNATIVE.toLowerCase()) {
            tx = await router.swapExactTokensForETH(amountIn, minOut, path, wallet.address, deadline, overrides);
        } else {
            tx = await router.swapExactTokensForTokens(amountIn, minOut, path, wallet.address, deadline, overrides);
        }

        const shortHash = `${tx.hash.slice(0, 6)}...${tx.hash.slice(-4)}`;
        logSubStep(`Tx Hash    : ${chalk.blue(shortHash)}`);
        logSubStep(`⏳ Menunggu konfirmasi...`);
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            logSuccess(`Transaksi ${shortHash} terkonfirmasi!`);
            return true;
        } else {
            logFailure(`Transaksi ${shortHash} revert (Status 0).`);
            return false;
        }

    } catch (error) {
         logFailure(`Panggilan transaksi gagal.`, error);
         return false;
    }
}

// --- Fungsi Utama (Main) ---
let tokenInfo = {};
(async () => {
    logHeader('🚀 MEMULAI BOT SWAP 🚀', 'green');
    logInfo('RPC URL', RPC_URL);
    logInfo('Wallet', wallet.address);
    logInfo('Router', ROUTER_ADDRESS);
    logInfo('WNATIVE', WNATIVE);
    logInfo('Jumlah Swap Awal', `${AMOUNT_IN_RAW}`);
    logInfo('Slippage', `${SLIPPAGE * 100}%`);

    const allTokenAddresses = Array.from(new Set([WNATIVE, ...TOKEN_LIST]));
    tokenInfo = await loadTokenInfo(allTokenAddresses);

    logHeader('2. SWAP AWAL', 'blue');
    for (const pair of SWAP_PAIRS) {
        await executeSwap(pair.from, pair.to, AMOUNT_IN_RAW, tokenInfo);
        logSubStep(chalk.gray(`⏱️  Menunggu ${DELAY_MS / 1000} detik...`));
        await sleep(DELAY_MS);
    }

    await showBalances(allTokenAddresses, tokenInfo);

    logHeader('3. SWAP KEMBALI KE NATIVE', 'blue');
    for (const tokenAddr of TOKEN_LIST) {
        const contract = new ethers.Contract(tokenAddr, erc20Abi, provider);
        const balance = await contract.balanceOf(wallet.address);

        if (!balance.isZero()) {
            const balanceFormatted = ethers.utils.formatUnits(balance, tokenInfo[tokenAddr].decimals);
            await executeSwap(tokenAddr, WNATIVE, balanceFormatted, tokenInfo);
            logSubStep(chalk.gray(`⏱️  Menunggu ${DELAY_MS / 1000} detik...`));
            await sleep(DELAY_MS);
        } else {
            logStep(`${tokenInfo[tokenAddr].symbol} saldo 0, swap dilewati.`);
        }
    }

    await showBalances(allTokenAddresses, tokenInfo);
    logHeader('🎉 SELESAI 🎉', 'green');

})().catch(error => {
    logHeader('💥 ERROR FATAL 💥', 'red');
    console.error(error);
    process.exit(1);
});
