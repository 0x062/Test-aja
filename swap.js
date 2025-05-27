const { ethers } = require('ethers');
const chalk = require('chalk');
require('dotenv').config();

// --- Konfigurasi & Validasi ---
const PRIVATE_KEY = (process.env.PRIVATE_KEY || '').trim();
const RPC_URL = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE = process.env.WNATIVE; // Pastikan ini alamat WXOS kamu
const NATIVE_SYMBOL = process.env.NATIVE_SYMBOL || 'ETH';
const AMOUNT_IN_RAW = process.env.AMOUNT_IN;
const SLIPPAGE = parseFloat(process.env.SLIPPAGE || '1') / 100; // Default 1%
const DEADLINE_SEC = parseInt(process.env.DEADLINE_MINUTES || '5', 10) * 60; // Default 5 menit
const GAS_LIMIT = parseInt(process.env.GAS_LIMIT || '250000', 10); // Default 250k
const DELAY_MS = parseInt(process.env.DELAY_MS, 10) || 5000;
const TOKENS_ENV = process.env.TOKENS || '';

console.log(chalk.blue('🔧 Memuat konfigurasi...'));

// Validasi Env Vars
if (!PRIVATE_KEY || !PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length !== 66) {
    console.error(chalk.red('❌ PRIVATE_KEY tidak valid atau hilang di .env'));
    process.exit(1);
}
if (!RPC_URL || !ROUTER_ADDRESS || !WNATIVE || !AMOUNT_IN_RAW || !TOKENS_ENV) {
    console.error(chalk.red('❌ Variabel .env yang wajib diisi hilang: RPC_URL, ROUTER_ADDRESS, WNATIVE, AMOUNT_IN, TOKENS'));
    process.exit(1);
}

const TOKEN_LIST = TOKENS_ENV.split(',').map(t => ethers.utils.getAddress(t.trim())).filter(t => t); // Validasi alamat
if (TOKEN_LIST.length === 0) {
    console.error(chalk.red('❌ Variabel TOKENS harus berisi setidaknya satu alamat token.'));
    process.exit(1);
}

// --- Membuat Pasangan Swap ---
const SWAP_PAIRS = [];
// 1. WNATIVE -> Token
TOKEN_LIST.forEach(token => SWAP_PAIRS.push({ from: WNATIVE, to: token }));
// 2. Token -> Token (Mencoba semua kombinasi unik)
for (let i = 0; i < TOKEN_LIST.length; i++) {
    for (let j = 0; j < TOKEN_LIST.length; j++) {
        if (i !== j) { // Pastikan tidak swap ke token yang sama
           SWAP_PAIRS.push({ from: TOKEN_LIST[i], to: TOKEN_LIST[j] });
        }
    }
}
console.log(chalk.cyan(`   -> Ditemukan ${SWAP_PAIRS.length} pasangan swap awal.`));


// --- Setup Ethers.js ---
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
console.log(chalk.green(`🔌 Terhubung ke RPC: ${RPC_URL}`));
console.log(chalk.yellow(`👤 Menggunakan Wallet: ${wallet.address}`));


// --- ABI (Application Binary Interface) ---
const routerAbi = [
    'function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])',
    'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])',
    'function swapExactTokensForETH(uint256,uint256,address[],address,uint256) returns(uint256[])',
    'function getAmountsOut(uint256,address[]) view returns(uint256[])',
    'function WETH() view returns (address)' // Untuk WNATIVE check
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

// --- Fungsi Helper ---

// Memuat info token (simbol & desimal)
async function loadTokenInfo(addrs) {
    console.log(chalk.blue('ℹ️  Memuat info token...'));
    const info = {};
    for (const addr of addrs) {
        if (!info[addr]) { // Hindari duplikasi
            if (addr.toLowerCase() === WNATIVE.toLowerCase()) {
                info[addr] = { symbol: NATIVE_SYMBOL, decimals: 18 };
            } else {
                const contract = new ethers.Contract(addr, erc20Abi, provider);
                try {
                    const [sym, dec] = await Promise.all([contract.symbol(), contract.decimals()]);
                    info[addr] = { symbol: sym, decimals: dec };
                    console.log(chalk.gray(`   -> ${sym} (${addr}) = ${dec} decimals`));
                } catch (e) {
                    console.warn(chalk.yellow(`   ⚠️ Gagal memuat info untuk ${addr}, menggunakan default (18 desimal).`));
                    info[addr] = { symbol: addr.slice(0, 6) + '…', decimals: 18 };
                }
            }
        }
    }
    return info;
}

// Menangani Approval Token
async function ensureAllowance(tokenAddress, amountIn, tokenInfo) {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
    const allowance = await tokenContract.allowance(wallet.address, ROUTER_ADDRESS);

    if (allowance.lt(amountIn)) {
        process.stdout.write(chalk.magenta(`   🔑 Memberikan approval untuk ${tokenInfo[tokenAddress].symbol}... `));
        try {
            const approveTx = await tokenContract.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256, {
                gasPrice: await provider.getGasPrice(), // Gunakan gas price saat ini
                gasLimit: 80000 // Gas limit kecil cukup untuk approve
            });
            await approveTx.wait();
            console.log(chalk.green('✅'));
            await sleep(1000); // Beri jeda sedikit setelah approval
        } catch (e) {
            console.error(chalk.red('❌ Gagal approval!'), e);
            throw new Error(`Approval failed for ${tokenInfo[tokenAddress].symbol}`);
        }
    } else {
         console.log(chalk.gray(`   ✅ Allowance ${tokenInfo[tokenAddress].symbol} sudah cukup.`));
    }
}

// Mendapatkan Path Swap yang Valid
async function getSwapPath(from, to, amountIn) {
    const pathsToTry = [];
    
    if (from === WNATIVE) {
        pathsToTry.push([WNATIVE, to]);
    } else if (to === WNATIVE) {
        pathsToTry.push([from, WNATIVE]);
    } else {
        // 1. Coba path langsung
        pathsToTry.push([from, to]);
        // 2. Coba path via WNATIVE
        pathsToTry.push([from, WNATIVE, to]);
    }

    for (const path of pathsToTry) {
        try {
            await router.getAmountsOut(amountIn, path);
            console.log(chalk.gray(`   🛣️ Menggunakan path: ${path.map(p => tokenInfo[p].symbol).join(' → ')}`));
            return path; // Path pertama yang berhasil
        } catch (e) {
            console.warn(chalk.yellow(`   ⚠️ Path ${path.map(p => tokenInfo[p]?.symbol || p.slice(0,6)).join(' → ')} tidak valid atau gagal: ${e.reason || e.message}`));
        }
    }
    return null; // Tidak ada path yang ditemukan
}

// Fungsi Swap Utama
async function executeSwap(from, to, amountRaw, tokenInfo) {
    const { symbol: symIn, decimals: decIn } = tokenInfo[from];
    const { symbol: symOut, decimals: decOut } = tokenInfo[to];
    const amountIn = ethers.utils.parseUnits(amountRaw, decIn);

    console.log(chalk.yellow(`\n🔄 Mencoba Swap ${amountRaw} ${symIn} → ${symOut}...`));

    // Cek Saldo Native Token untuk Gas
    const gasPrice = await provider.getGasPrice();
    const ethBal = await provider.getBalance(wallet.address);
    const feeCost = gasPrice.mul(GAS_LIMIT);
    const totalCost = (from === WNATIVE) ? feeCost.add(amountIn) : feeCost;

    if (ethBal.lt(totalCost)) {
        console.error(chalk.red(`   ❌ Skip: Butuh ${ethers.utils.formatEther(totalCost)} ${NATIVE_SYMBOL} (Gas${from === WNATIVE ? '+Value' : ''}), hanya punya ${ethers.utils.formatEther(ethBal)}`));
        return false;
    }

    // Dapatkan Path & Estimasi Output
    const path = await getSwapPath(from, to, amountIn);
    if (!path) {
        console.error(chalk.red(`   ❌ Tidak ditemukan path yang valid untuk ${symIn} → ${symOut}.`));
        return false;
    }
    
    const amountsOut = await router.getAmountsOut(amountIn, path);
    const estOut = amountsOut[amountsOut.length - 1];
    const minOut = estOut.mul(Math.floor((1 - SLIPPAGE) * 10000)).div(10000); // Lebih presisi
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SEC;

    console.log(chalk.cyan(`   💰 Estimasi output: ${ethers.utils.formatUnits(estOut, tokenInfo[path[path.length - 1]].decimals)} ${tokenInfo[path[path.length - 1]].symbol}`));
    console.log(chalk.cyan(`   📉 Min output (slippage ${SLIPPAGE * 100}%): ${ethers.utils.formatUnits(minOut, tokenInfo[path[path.length - 1]].decimals)} ${tokenInfo[path[path.length - 1]].symbol}`));

    // Pastikan Allowance (jika bukan WNATIVE)
    if (from !== WNATIVE) {
        try {
            await ensureAllowance(from, amountIn, tokenInfo);
        } catch (e) {
            return false; // Hentikan jika approval gagal
        }
    }

    // Eksekusi Swap
    let tx;
    try {
        const overrides = { gasLimit: GAS_LIMIT, gasPrice };
        const toAddress = wallet.address; // Kirim ke wallet sendiri

        if (path[0] === WNATIVE) { // swapExactETHForTokens
            overrides.value = amountIn;
            tx = await router.swapExactETHForTokens(minOut, path, toAddress, deadline, overrides);
        } else if (path[path.length - 1] === WNATIVE) { // swapExactTokensForETH
            tx = await router.swapExactTokensForETH(amountIn, minOut, path, toAddress, deadline, overrides);
        } else { // swapExactTokensForTokens
            tx = await router.swapExactTokensForTokens(amountIn, minOut, path, toAddress, deadline, overrides);
        }

        console.log(chalk.blue(`   📋 Mengirim Transaksi: ${tx.hash}`));
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(chalk.green('   ✅ Swap Berhasil!'));
            // Kita bisa dapatkan jumlah aktual dari event 'Transfer', tapi estimasi cukup untuk log ini
            console.log(chalk.green(`   🎉 Perkiraan diterima: ~${ethers.utils.formatUnits(estOut, tokenInfo[path[path.length - 1]].decimals)} ${tokenInfo[path[path.length - 1]].symbol}`));
            return true;
        } else {
            console.error(chalk.red(`   ❌ Swap Gagal! Transaksi revert. Hash: ${tx.hash}`));
            return false;
        }

    } catch (error) {
        console.error(chalk.red(`   💥 TERJADI ERROR SAAT SWAP:`));
        // Coba tampilkan pesan error yang lebih berguna
        if (error.reason) {
            console.error(chalk.red(`      Reason: ${error.reason}`));
        }
        if (error.code) {
             console.error(chalk.red(`      Code: ${error.code}`));
        }
        // Tampilkan error lengkap untuk debugging mendalam
        console.error(error); 
        return false;
    }
}

// Menampilkan Saldo
async function showBalances(allAddrs, tkInfo) {
    console.log(chalk.magenta('\n📊 Saldo Saat Ini:'));
    const nativeBal = await provider.getBalance(wallet.address);
    console.log(`   - ${NATIVE_SYMBOL}: ${ethers.utils.formatEther(nativeBal)}`);

    for (const addr of allAddrs) {
        const contract = new ethers.Contract(addr, erc20Abi, provider);
        const balance = await contract.balanceOf(wallet.address);
        if (!balance.isZero()) {
            console.log(`   - ${tkInfo[addr].symbol}: ${ethers.utils.formatUnits(balance, tkInfo[addr].decimals)}`);
        }
    }
}

// --- Fungsi Utama (Main) ---
let tokenInfo = {}; // Global scope untuk info token

(async () => {
    console.log(chalk.bold.inverse('\n===== MEMULAI BOT SWAP =====\n'));

    // Verifikasi WNATIVE di Router (opsional tapi bagus)
    try {
        const wnativeCheck = await router.WETH();
        if (wnativeCheck.toLowerCase() !== WNATIVE.toLowerCase()) {
            console.warn(chalk.yellow(`   ⚠️ Peringatan: WNATIVE di .env (${WNATIVE}) berbeda dengan WETH() di router (${wnativeCheck}). Pastikan WNATIVE sudah benar!`));
        }
    } catch(e) {
         console.warn(chalk.yellow(`   ⚠️ Tidak bisa memverifikasi WETH() di router.`));
    }


    const allTokenAddresses = Array.from(new Set([WNATIVE, ...TOKEN_LIST]));
    tokenInfo = await loadTokenInfo(allTokenAddresses); // Muat info token

    console.log(chalk.blue('\n🤖 Memulai Swap Awal...'));
    for (const pair of SWAP_PAIRS) {
        await executeSwap(pair.from, pair.to, AMOUNT_IN_RAW, tokenInfo);
        console.log(chalk.gray(`   ⏱️ Menunggu ${DELAY_MS / 1000} detik...`));
        await sleep(DELAY_MS);
    }

    await showBalances(allTokenAddresses, tokenInfo);

    console.log(chalk.blue('\n🔄 Memulai Swap Kembali ke Native...'));
    for (const tokenAddr of TOKEN_LIST) {
        const contract = new ethers.Contract(tokenAddr, erc20Abi, provider);
        const balance = await contract.balanceOf(wallet.address);

        if (!balance.isZero()) {
            const balanceFormatted = ethers.utils.formatUnits(balance, tokenInfo[tokenAddr].decimals);
            await executeSwap(tokenAddr, WNATIVE, balanceFormatted, tokenInfo);
            console.log(chalk.gray(`   ⏱️ Menunggu ${DELAY_MS / 1000} detik...`));
            await sleep(DELAY_MS);
        }
    }

    await showBalances(allTokenAddresses, tokenInfo);

    console.log(chalk.bold.inverse('\n===== SELESAI =====\n'));
})().catch(error => {
    console.error(chalk.red('\n💥 ERROR FATAL PADA SKRIP:'));
    console.error(error);
    process.exit(1);
});
