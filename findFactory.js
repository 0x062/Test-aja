// findFactory.js
import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from './config.js';

async function findFactoryAddress() {
    console.log("🤖 Bertanya kepada Router: 'Di mana alamat Pabrik V3-mu?'");

    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, provider);

    try {
        // Panggil fungsi 'factory()' dari kontrak Router
        const factoryAddress = await routerContract.factory();
        
        console.log("-------------------------------------------");
        console.log("✅ BERHASIL! Alamat Factory V3 ditemukan:");
        console.log(factoryAddress);
        console.log("-------------------------------------------");
        console.log("Salin alamat di atas dan masukkan ke dalam config.js di bagian FACTORY_V3.");

    } catch (error) {
        console.error("💥 Gagal memanggil fungsi factory(). Mungkin tidak ada di ABI?", error);
    }
}

findFactoryAddress();
