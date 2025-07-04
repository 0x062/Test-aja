// swap.js (Versi Cerdas dengan Auto Fee Tier)

import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS, TARGET_TOKENS } from './config.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// FUNGSI HELPER BARU UNTUK MENCARI FEE TIER
async function findValidFeeTier(factoryContract, tokenA, tokenB) {
    console.log(`🕵️  Mencari fee tier yang valid untuk pasangan ${tokenA.slice(0,6)}.../${tokenB.slice(0,6)}...`);
    const feesToCheck = [500, 3000, 10000]; // Fee tier standar V3

    for (const fee of feesToCheck) {
        const poolAddress = await factoryContract.getPool(tokenA, tokenB, fee);
        if (poolAddress !== ethers.ZeroAddress) {
            console.log(`✅ Fee tier ditemukan: ${fee}`);
            return fee; // Kembalikan fee pertama yang ditemukan
        }
    }
    console.log("❌ Tidak ada pool yang ditemukan untuk pasangan ini di fee tier standar.");
    return null; // Kembalikan null jika tidak ada pool yang ditemukan
}

// Fungsi swap sekarang menerima 'fee' sebagai parameter
async function executeV3Swap(wallet, targetToken, fee) {
    // ... (Fungsi ini isinya sama persis seperti sebelumnya, tidak ada yang berubah)
    console.log('----------------------------------------------------');
    console.log(`🚀 Mempersiapkan SWAP XOS -> ${targetToken.name} dengan fee ${fee}...`);
    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    const amountInString = '0.01';
    const amountIn = ethers.parseEther(amountInString);
    const params = {
        tokenIn: CONTRACT_ADDRESSES.WXOS,
        tokenOut: targetToken.address,
        fee: fee, // Menggunakan fee dari parameter
        recipient: wallet.address,
        amountIn: amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
    };
    try {
        console.log(`💸 Mencoba menukar ${amountInString} XOS dengan ${targetToken.name}...`);
        const tx = await routerContract.exactInputSingle(params, { value: amountIn, gasLimit: 1000000 });
        console.log(`⏳  Transaksi SWAP [${targetToken.name}] dikirim! Hash: ${tx.hash}`);
        await tx.wait();
        console.log(`✅  SWAP [${targetToken.name}] BERHASIL!`);
    } catch (error) {
        console.error(`💥 Gagal melakukan SWAP ke ${targetToken.name}!`, error.reason || error.message);
    }
}

async function main() {
    console.log('🚀 Memulai Bot Cerdas...');
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);
    
    // Buat instance untuk Factory Contract
    const factoryContract = new ethers.Contract(CONTRACT_ADDRESSES.FACTORY_V3, CONTRACT_ABIS.FACTORY_V3, provider);

    // Loop untuk setiap token di daftar target kita
    for (const token of TARGET_TOKENS) {
        // Cari fee tier secara otomatis
        const fee = await findValidFeeTier(factoryContract, CONTRACT_ADDRESSES.WXOS, token.address);

        // Hanya lanjutkan jika fee tier ditemukan
        if (fee) {
            await executeV3Swap(wallet, token, fee);
        }
        
        console.log("\n...Mengambil jeda 5 detik...\n");
        await sleep(5000); 
    }
    
    console.log('----------------------------------------------------');
    console.log('🎉 Bot telah menyelesaikan semua tugasnya.');
}

main().catch(error => {
    console.error('💥 Terjadi error fatal:', error);
    process.exit(1);
});
