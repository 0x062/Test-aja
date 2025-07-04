// swap.js (Versi Universal Router V3)

import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from './config.js';

async function executeV3Swap(wallet) {
    console.log('----------------------------------------------------');
    console.log('🚀 Mempersiapkan SWAP menggunakan logika V3...');
    
    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    
    const amountInString = '0.01';
    const amountIn = ethers.parseEther(amountInString);
    
    // Parameter untuk fungsi exactInputSingle
    const params = {
        tokenIn: CONTRACT_ADDRESSES.WXOS,
        tokenOut: CONTRACT_ADDRESSES.USDC,
        fee: 3000, // Fee tier pool, 3000 = 0.3% (tebakan paling umum)
        recipient: wallet.address,
        amountIn: amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
    };

    try {
        console.log(`💸 Mencoba menukar ${amountInString} XOS dengan USDC via V3...`);
        
        // Universal Router pintar. Walaupun tokenIn adalah WXOS, kita bisa kirim 'value'
        // berisi XOS, dan dia akan otomatis me-wrapnya untuk kita.
        const tx = await routerContract.exactInputSingle(params, {
            value: amountIn,
            gasLimit: 1000000 // Kita set gas limit manual untuk jaga-jaga
        });
        
        console.log(`⏳  Transaksi SWAP V3 dikirim! Hash: ${tx.hash}`);
        console.log('Menunggu transaksi dikonfirmasi...');
        await tx.wait();
        console.log('✅  SWAP V3 BERHASIL! SELAMAT PARTNER!');

    } catch (error) {
        console.error('💥 Gagal melakukan SWAP V3!', error);
    }
}

async function main() {
    console.log('🚀 Memulai bot untuk XOS Testnet...');
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);
    
    const saldoNative = await provider.getBalance(wallet.address);
    console.log(`💰 Saldo Native (XOS): ${ethers.formatEther(saldoNative)}`);

    // Untuk V3, kita tidak perlu approve router jika swap dari koin native
    await executeV3Swap(wallet);
    
    console.log('----------------------------------------------------');
    console.log('🎉 Bot telah menyelesaikan tugasnya.');
}

main().catch(error => {
    console.error('💥 Terjadi error fatal:', error);
    process.exit(1);
});
