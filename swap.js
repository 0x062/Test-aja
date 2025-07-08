// swap.js (Versi Ultimate dengan Swap & Swap Back)

import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS, TARGET_TOKENS } from './config.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ================== PENGATURAN UTAMA ==================
const SWAP_AMOUNT_IN_ETHER = '0.01'; 
const SLIPPAGE_PERCENTAGE = 1; 
// ====================================================

// Fungsi helper ini tidak berubah dan tetap kita gunakan
async function findValidFeeTier(factoryContract, tokenA, tokenB) {
    // ... (Tidak ada perubahan pada fungsi ini)
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

// Fungsi swap forward ini juga tidak berubah
async function executeV3Swap(wallet, provider, targetToken, fee) {
    // ... (Tidak ada perubahan pada fungsi ini)
    // ... (Isi fungsi sama persis seperti sebelumnya)
}

// =========================================================================
//                  BARU: FUNGSI SWAP BACK TO NATIVE
// =========================================================================
/**
 * Menjual token ERC20 kembali ke token native (XOS/ETH/BNB).
 * @param {ethers.Wallet} wallet - Instance wallet yang digunakan.
 * @param {ethers.Provider} provider - Instance provider JSON-RPC.
 * @param {object} tokenToSell - Objek token dari config.js { name, address, decimals }.
 */
async function swapTokenBackToNative(wallet, provider, tokenToSell) {
    console.log('----------------------------------------------------');
    console.log(`🚀 Mempersiapkan SWAP BACK: ${tokenToSell.name} -> XOS...`);

    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    const quoterContract = new ethers.Contract(CONTRACT_ADDRESSES.QUOTER_V2, CONTRACT_ABIS.QUOTER_V2, provider);
    const tokenContract = new ethers.Contract(tokenToSell.address, CONTRACT_ABIS.ERC20, wallet); // Gunakan ABI ERC20 standar

    // 1. Cek Saldo & Beri Approval jika perlu
    const balance = await tokenContract.balanceOf(wallet.address);
    if (balance.isZero()) {
        console.log(`🤷 Saldo ${tokenToSell.name} adalah 0. Tidak ada yang bisa dijual.`);
        return;
    }
    const amountToSell = balance; // Jual semua saldo
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

    // 2. Cari Fee Tier & Dapatkan Quote untuk proteksi slippage
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

    // 3. Siapkan Multicall (Swap + Unwrap)
    const swapParams = {
        tokenIn: tokenToSell.address,
        tokenOut: CONTRACT_ADDRESSES.WXOS,
        fee: fee,
        recipient: CONTRACT_ADDRESSES.ROUTER, // Penting: kirim WXOS ke router untuk di-unwrap
        amountIn: amountToSell,
        amountOutMinimum: amountOutMinimum,
        sqrtPriceLimitX96: 0,
    };

    // Encode data panggilan untuk setiap langkah
    const swapCallData = routerContract.interface.encodeFunctionData("exactInputSingle", [swapParams]);
    const unwrapCallData = routerContract.interface.encodeFunctionData("unwrapWETH9", [amountOutMinimum, wallet.address]); // Kirim XOS ke wallet kita

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


async function main() {
    console.log('🚀 Memulai Bot Ultimate...');
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);
    
    const factoryContract = new ethers.Contract(CONTRACT_ADDRESSES.FACTORY_V3, CONTRACT_ABIS.FACTORY_V3, provider);

    // FASE 1: BELI SEMUA TOKEN DI TARGET LIST
    for (const token of TARGET_TOKENS) {
        // ... (Tidak ada perubahan di sini, loop pembelian tetap berjalan seperti sebelumnya)
    }

    // TUNGGU SEBENTAR SEBELUM MENJUAL
    console.log("\n\n🏁 Fase pembelian selesai. Menunggu 10 detik sebelum memulai fase penjualan...\n\n");
    await sleep(10000);

    // FASE 2: JUAL KEMBALI SEMUA TOKEN YANG DIMILIKI
    for (const token of TARGET_TOKENS) {
        await swapTokenBackToNative(wallet, provider, token);
        console.log("\n...Mengambil jeda 5 detik...\n");
        await sleep(5000);
    }
    
    console.log('----------------------------------------------------');
    console.log('🎉 Bot telah menyelesaikan semua tugasnya (beli dan jual).');
}

main().catch(error => {
    console.error('💥 Terjadi error fatal:', error);
    process.exit(1);
});
