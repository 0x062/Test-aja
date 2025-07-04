// swap.js (Versi Tes XOS -> WXOS)

import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from './config.js';

// Fungsi approve tidak akan kita panggil di tes ini, tapi biarkan saja di sini.
async function approveToken(wallet) {
    // ... (kode approve tidak perlu diubah)
}

async function executeSwap(wallet) {
    console.log('----------------------------------------------------');
    console.log('🚀 Mempersiapkan transaksi "WRAP" (XOS -> WXOS)...');
    
    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    
    const amountInString = '0.01';
    const amountIn = ethers.parseEther(amountInString);
    const amountOutMin = 0; // Tidak relevan untuk wrapping, tapi tetap diperlukan
    
    // --- PERUBAHAN UTAMA DI SINI ---
    // Path untuk wrap XOS ke WXOS hanya berisi alamat WXOS itu sendiri.
    const path = [CONTRACT_ADDRESSES.WXOS];
    
    const to = wallet.address;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    try {
        // --- UBAH PESAN LOG AGAR SESUAI ---
        console.log(`💸 Membungkus (wrap) ${amountInString} XOS menjadi WXOS...`);
        
        const tx = await routerContract.swapExactETHForTokens(
            amountOutMin, path, to, deadline, { value: amountIn }
        );
        
        console.log(`⏳  Transaksi WRAP dikirim! Hash: ${tx.hash}`);
        console.log('Menunggu transaksi dikonfirmasi...');
        await tx.wait();
        console.log('✅  WRAP BERHASIL! Saldo WXOS bertambah!');
    
    } catch (error) {
        console.error('💥 Gagal melakukan WRAP!', error);
    }
}

async function main() {
    console.log('🚀 Memulai bot untuk XOS Testnet...');
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);
    
    const saldoNative = await provider.getBalance(wallet.address);
    console.log(`💰 Saldo Native (XOS): ${ethers.formatEther(saldoNative)}`);

    // --- PERUBAHAN LOGIKA PANGGILAN ---
    // Kita nonaktifkan 'approve' untuk sementara dan langsung panggil 'executeSwap'
    // const approveSuccess = await approveToken(wallet);
    // if (approveSuccess) {
    
    await executeSwap(wallet);
    
    // } else {
    //     console.log("Approve gagal, proses swap dibatalkan.");
    // }
    
    console.log('----------------------------------------------------');
    console.log('🎉 Bot telah menyelesaikan tugas tes-nya.');
}

main().catch(error => {
    console.error('💥 Terjadi error fatal:', error);
    process.exit(1);
});
