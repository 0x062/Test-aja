import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS, TARGET_TOKENS } from './config.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// FUNGSI HELPER UNTUK MENCARI FEE TIER (Tidak berubah)
async function findValidFeeTier(factoryContract, tokenA, tokenB) {
    console.log(`🕵️  Mencari fee tier yang valid untuk pasangan ${tokenA.slice(0,6)}.../${tokenB.slice(0,6)}...`);
    const feesToCheck = [500, 3000, 10000]; // Fee tier standar V3

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

// FUNGSI SWAP BELI (Tidak berubah)
async function executeV3Swap(wallet, targetToken, fee) {
    console.log('----------------------------------------------------');
    console.log(`🚀 Mempersiapkan SWAP XOS -> ${targetToken.name} dengan fee ${fee}...`);
    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    const amountInString = '0.01';
    const amountIn = ethers.parseEther(amountInString);
    const params = {
        tokenIn: CONTRACT_ADDRESSES.WXOS,
        tokenOut: targetToken.address,
        fee: fee,
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

// FUNGSI SWAP BACK (Dengan perbaikan kedua)
async function swapTokenBackToNative(wallet, provider, tokenToSell) {
    console.log('----------------------------------------------------');
    console.log(`🚀 Mempersiapkan SWAP BACK: ${tokenToSell.name} -> XOS...`);

    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    const tokenContract = new ethers.Contract(tokenToSell.address, CONTRACT_ABIS.ERC20, wallet);

    // 1. Cek Saldo & Beri Approval jika perlu
    const balance = await tokenContract.balanceOf(wallet.address);

    // Perbaikan #1: Menggunakan `=== 0n` untuk ethers.js v6
    if (balance === 0n) {
        console.log(`🤷 Saldo ${tokenToSell.name} adalah 0. Tidak ada yang bisa dijual.`);
        return;
    }
    console.log(`💰 Saldo terdeteksi: ${ethers.formatUnits(balance, tokenToSell.decimals || 18)} ${tokenToSell.name}. Menjual semua...`);

    const allowance = await tokenContract.allowance(wallet.address, CONTRACT_ADDRESSES.ROUTER);
    
    // ================== PERBAIKAN DI SINI ==================
    // Perbaikan #2: Menggunakan `<` untuk membandingkan BigInt di ethers.js v6
    if (allowance < balance) {
    // =======================================================
        console.log("🤔 Allowance tidak cukup. Memberikan approval...");
        const approveTx = await tokenContract.approve(CONTRACT_ADDRESSES.ROUTER, balance);
        console.log(`⏳ Menunggu konfirmasi approval... Hash: ${approveTx.hash}`);
        await approveTx.wait();
        console.log("✅ Approval berhasil!");
    } else {
        console.log("✅ Approval sudah ada.");
    }

    // 2. Cari Fee Tier
    const factoryContract = new ethers.Contract(CONTRACT_ADDRESSES.FACTORY_V3, CONTRACT_ABIS.FACTORY_V3, provider);
    const fee = await findValidFeeTier(factoryContract, tokenToSell.address, CONTRACT_ADDRESSES.WXOS);
    if (!fee) {
        console.log(`❌ Gagal menemukan pool untuk ${tokenToSell.name}/WXOS. Swap dibatalkan.`);
        return;
    }
    
    // 3. Siapkan Multicall (Swap + Unwrap)
    const swapParams = {
        tokenIn: tokenToSell.address,
        tokenOut: CONTRACT_ADDRESSES.WXOS,
        fee: fee,
        recipient: routerContract.target,
        amountIn: balance,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
    };

    const swapCallData = routerContract.interface.encodeFunctionData("exactInputSingle", [swapParams]);
    const unwrapCallData = routerContract.interface.encodeFunctionData("unwrapWETH9", [0, wallet.address]);

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

// FUNGSI main (Tidak berubah)
async function main() {
    console.log('🚀 Memulai Bot Cerdas...');
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);
    
    const factoryContract = new ethers.Contract(CONTRACT_ADDRESSES.FACTORY_V3, CONTRACT_ABIS.FACTORY_V3, provider);

    // --- FASE 1: PEMBELIAN ---
    console.log("\n***** FASE PEMBELIAN DIMULAI *****\n");
    for (const token of TARGET_TOKENS) {
        const fee = await findValidFeeTier(factoryContract, CONTRACT_ADDRESSES.WXOS, token.address);
        if (fee) {
            await executeV3Swap(wallet, token, fee);
        }
        console.log("\n...Mengambil jeda 5 detik...\n");
        await sleep(5000); 
    }
    
    // --- JEDA ANTAR FASE ---
    console.log("\n\n🏁 Fase pembelian selesai. Menunggu 10 detik sebelum memulai fase penjualan...\n\n");
    await sleep(10000);

    // --- FASE 2: PENJUALAN ---
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
    console.error('💥 Terjadi error fatal:', error);
    process.exit(1);
});
