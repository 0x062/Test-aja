// checkPath.js

import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from './config.js';

async function testPath() {
    console.log("🕵️  Memulai tes validitas path...");

    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, provider);

    // Kita gunakan jumlah kecil untuk tes
    const amountIn = ethers.parseEther('0.0001'); 
    const path = [CONTRACT_ADDRESSES.WXOS, CONTRACT_ADDRESSES.USDC];

    console.log(`Path yang diuji: [${path[0]}, ${path[1]}]`);
    console.log("Bertanya kepada Router...");

    try {
        const amountsOut = await routerContract.getAmountsOut(amountIn, path);
        
        console.log("✅ SUKSES! Path ini VALID.");
        console.log(`Estimasi output untuk ${ethers.formatEther(amountIn)} WXOS adalah:`);
        // Desimal USDC kita asumsikan 18 sesuai data sebelumnya
        console.log(`${ethers.formatUnits(amountsOut[1], 18)} USDC`);

    } catch (error) {
        console.log("-------------------------------------------");
        console.error("💥 GAGAL! Path ini TIDAK VALID atau tidak ada likuiditas.");
        console.error("Inilah alasan kegagalan dari node:");
        // Kita tampilkan error lengkapnya untuk dianalisis
        console.error(error);
        console.log("-------------------------------------------");
    }
}

testPath().catch(error => {
    console.error('💥 Terjadi error fatal di skrip:', error);
});
