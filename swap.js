import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS, TARGET_TOKENS } from './config.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ================== PENGATURAN UTAMA ==================
const SWAP_AMOUNT_IN_ETHER = '0.01'; // Jumlah XOS yang digunakan untuk membeli setiap token
const SLIPPAGE_PERCENTAGE = 1; // Toleransi slippage 1%
// ====================================================

/**
 * Fungsi helper untuk mencari fee tier yang valid antara dua token.
 * @param {ethers.Contract} factoryContract - Instance dari kontrak Uniswap V3 Factory.
 * @param {string} tokenA - Alamat token pertama.
 * @param {string} tokenB - Alamat token kedua.
 * @returns {Promise<number|null>} Fee tier yang valid atau null jika tidak ditemukan.
 */
async function findValidFeeTier(factoryContract, tokenA, tokenB) {
    console.log(`🕵️  Mencari fee tier yang valid untuk pasangan ${tokenA.slice(0,6)}.../${tokenB.slice(0,6)}...`);
    const feesToCheck = [500, 3000, 10000];

    for (const fee of feesToCheck) {
        const poolAddress = await factoryContract.getPool(tokenA, tokenB, fee);
        if (poolAddress !== ethers.ZeroAddress) {
            console.log(`✅ Fee tier ditemukan: ${fee}`);
            return fee;
        }
    }
    console.log("❌ Tidak ada pool yang ditemukan untuk pasangan ini di fee tier standar.");
    return null;
}

/**
 * Menjalankan swap dari token native (via WXOS) ke token target (ERC20).
 * @param {ethers.Wallet} wallet - Instance wallet.
 * @param {ethers.Provider} provider - Instance provider.
 * @param {object} targetToken - Objek token target dari config.
 * @param {number} fee - Fee tier pool yang akan digunakan.
 */
async function executeV3Swap(wallet, provider, targetToken, fee) {
    console.log('----------------------------------------------------');
    console.log(`🚀 Mempersiapkan SWAP XOS -> ${targetToken.name} dengan fee ${fee}...`);

    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    const quoterContract = new ethers.Contract(CONTRACT_ADDRESSES.QUOTER_V2, CONTRACT_ABIS.QUOTER_V2, provider);

    const amountIn = ethers.parseEther(SWAP_AMOUNT_IN_ETHER);
    let amountOutMinimum = 0;

    try {
        console.log("📊 Meminta estimasi output dari Quoter...");
        const quoteParams = {
            tokenIn: CONTRACT_ADDRESSES.WXOS,
            tokenOut: targetToken.address,
            fee: fee,
            amountIn: amountIn,
            sqrtPriceLimitX96: 0
        };
        const { amountOut } = await quoterContract.quoteExactInputSingle.staticCall(quoteParams);
        const slippageAmount = (amountOut * BigInt(SLIPPAGE_PERCENTAGE * 100)) / 10000n;
        amountOutMinimum = amountOut - slippageAmount;
        console.log(`📉 Min. output setelah slippage ${SLIPPAGE_PERCENTAGE}%: ${ethers.formatUnits(amountOutMinimum, targetToken.decimals)} ${targetToken.name}`);
    } catch(e) {
        console.warn(`⚠️ Gagal mendapatkan quote. Swap akan berjalan tanpa proteksi slippage (amountOutMinimum = 0).`);
    }

    const params = {
        tokenIn: CONTRACT_ADDRESSES.WXOS,
        tokenOut: targetToken.address,
        fee: fee,
        recipient: wallet.address,
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        sqrtPriceLimitX96: 0,
    };

    try {
        console.log(`💸 Mencoba menukar ${SWAP_AMOUNT_IN_ETHER} XOS dengan ${targetToken.name}...`);
        const tx = await routerContract.exactInputSingle(params, { value: amountIn, gasLimit: 1000000 });
        console.log(`⏳  Transaksi SWAP [${targetToken.name}] dikirim! Hash: ${tx.hash}`);
        await tx.wait();
        console.log(`✅  SWAP [${targetToken.name}] BERHASIL!`);
    } catch (error) {
        console.error(`💥 Gagal melakukan SWAP ke ${targetToken.name}!`, error.reason || error.message);
    }
}

/**
 * Menjual token ERC20 kembali ke token native (XOS/ETH/BNB) secara atomik.
 * @param {ethers.Wallet} wallet - Instance wallet.
 * @param {ethers.Provider} provider - Instance provider.
 * @param {object} tokenToSell - Objek token yang akan dijual dari config.
 */
async function swapTokenBackToNative(wallet, provider, tokenToSell) {
    console.log('----------------------------------------------------');

    // Pemeriksaan untuk mencegah crash jika ada kesalahan konfigurasi
    if (!tokenToSell || !tokenToSell.address) {
        const tokenName = tokenToSell ? tokenToSell.name : "TOKEN TIDAK DIKENAL";
        console.error(`❌ Konfigurasi untuk token [${tokenName}] tidak valid atau alamat tidak ditemukan. SWAP DILEWATI.`);
        return; 
    }

    console.log(`🚀 Mempersiapkan SWAP BACK: ${tokenToSell.name} -> XOS...`);

    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    const quoterContract = new ethers.Contract(CONTRACT_ADDRESSES.QUOTER_V2, CONTRACT_ABIS.QUOTER_V2, provider);
    const tokenContract = new ethers.Contract(tokenToSell.address, CONTRACT_ABIS.ERC20, wallet);

    const balance = await tokenContract.balanceOf(wallet.address);
    if (balance.isZero()) {
        console.log(`🤷 Saldo ${tokenToSell.name} adalah 0. Tidak ada yang bisa dijual.`);
        return;
    }
    const amountToSell = balance;
    console.log(`💰 Saldo terdeteksi: ${ethers.formatUnits(amountToSell, tokenToSell.decimals)} ${tokenToSell.name}. Menjual semua...`);

    const allowance = await tokenContract.allowance(wallet.address, CONTRACT_ADDRESSES.ROUTER);
    if (allowance.lt(amountToSell)) {
        console.log("🤔 Allowance tidak cukup. Memberikan approval...");
        const approveTx = await tokenContract.approve(CONTRACT_ADDRESSES.ROUTER, amountToSell);
        console.log(`⏳ Menunggu konfirmasi approval... Hash: ${approveTx.hash}`);
        await approveTx.wait();
        console.log("✅ Approval berhasil!");
    } else {
        console.log("✅ Approval sudah ada.");
    }

    const fee = await findValidFeeTier(
        new ethers.Contract(CONTRACT_ADDRESSES.FACTORY_V3, CONTRACT_ABIS.FACTORY_V3, provider),
        tokenToSell.address,
        CONTRACT_ADDRESSES.WXOS
    );
    if (!fee) {
        console.log(`❌ Gagal menemukan pool untuk ${tokenToSell.name}/WXOS. Swap dibatalkan.`);
        return;
    }
    
    console.log("📊 Meminta estimasi output dari Quoter...");
    const quoteParams = {
        tokenIn: tokenToSell.address,
        tokenOut: CONTRACT_ADDRESSES.WXOS,
        fee: fee,
        amountIn: amountToSell,
        sqrtPriceLimitX96: 0
    };
    const { amountOut } = await quoterContract.quoteExactInputSingle.staticCall(quoteParams);
    const amountOutMinimum = amountOut - (amountOut * BigInt(SLIPPAGE_PERCENTAGE * 100) / 10000n);
    console.log(`📉 Min. output WXOS setelah slippage: ${ethers.formatEther(amountOutMinimum)}`);

    const swapParams = {
        tokenIn: tokenToSell.address,
        tokenOut: CONTRACT_ADDRESSES.WXOS,
        fee: fee,
        recipient: CONTRACT_ADDRESSES.ROUTER,
        amountIn: amountToSell,
        amountOutMinimum: amountOutMinimum,
        sqrtPriceLimitX96: 0,
    };

    const swapCallData = routerContract.interface.encodeFunctionData("exactInputSingle", [swapParams]);
    const unwrapCallData = routerContract.interface.encodeFunctionData("unwrapWETH9", [amountOutMinimum, wallet.address]);

    try {
        console.log("✨ Menjalankan multicall (Swap + Unwrap)...");
        const multicallTx = await routerContract.multicall([swapCallData, unwrapCallData], { gasLimit: 1000000 });
        console.log(`⏳ Transaksi SWAP BACK [${tokenToSell.name}] dikirim! Hash: ${multicallTx.hash}`);
        await multicallTx.wait();
        console.log(`✅ SWAP BACK [${tokenToSell.name}] BERHASIL!`);
    } catch (error) {
        console.error(`💥 Gagal melakukan SWAP BACK untuk ${tokenToSell.name}!`, error.reason || error.message);
    }
}

/**
 * Fungsi utama untuk menjalankan bot.
 */
async function main() {
    console.log('🚀 Memulai Bot Ultimate...');
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);
    
    const factoryContract = new ethers.Contract(CONTRACT_ADDRESSES.FACTORY_V3, CONTRACT_ABIS.FACTORY_V3, provider);

    // FASE 1: BELI SEMUA TOKEN DI TARGET LIST
    console.log("\n***** FASE PEMBELIAN DIMULAI *****\n");
    for (const token of TARGET_TOKENS) {
        if (!token.address) {
            console.error(`❌ Konfigurasi untuk token [${token.name}] tidak memiliki alamat. Pembelian dilewati.`);
            continue;
        }
        const fee = await findValidFeeTier(factoryContract, CONTRACT_ADDRESSES.WXOS, token.address);
        if (fee) {
            await executeV3Swap(wallet, provider, token, fee);
        }
        console.log("\n...Mengambil jeda 5 detik...\n");
        await sleep(5000); 
    }

    // TUNGGU SEBENTAR SEBELUM MENJUAL
    console.log("\n\n🏁 Fase pembelian selesai. Menunggu 10 detik sebelum memulai fase penjualan...\n\n");
    await sleep(10000);

    // FASE 2: JUAL KEMBALI SEMUA TOKEN YANG DIBELI
    console.log("\n***** FASE PENJUALAN DIMULAI *****\n");
    for (const token of TARGET_TOKENS) {
        await swapTokenBackToNative(wallet, provider, token);
        console.log("\n...Mengambil jeda 5 detik...\n");
        await sleep(5000);
    }
    
    console.log('----------------------------------------------------');
    console.log('🎉 Bot telah menyelesaikan semua tugasnya (beli dan jual).');
}

main().catch(error => {
    console.error('💥 Terjadi error fatal di luar ekspektasi:', error);
    process.exit(1);
});
