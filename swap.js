// swap.js

import { ethers } from 'ethers';
import 'dotenv/config';
// 1. Impor konfigurasi dari file config.js
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from './config.js';

// Fungsi approve sekarang menggunakan data dari config
async function approveToken(wallet) {
    console.log('----------------------------------------------------');
    console.log('⚙️  Mempersiapkan transaksi "Approve"...');
    // Menggunakan CONTRACT_ADDRESSES.USDC dan CONTRACT_ABIS.ERC20
    const usdcContract = new ethers.Contract(CONTRACT_ADDRESSES.USDC, CONTRACT_ABIS.ERC20, wallet);
    const amountToApprove = ethers.MaxUint256;
    try {
        // Menggunakan CONTRACT_ADDRESSES.ROUTER
        console.log(`✍️  Memberi izin (approve) kepada Router (${CONTRACT_ADDRESSES.ROUTER}) untuk menggunakan USDC kita...`);
        const tx = await usdcContract.approve(CONTRACT_ADDRESSES.ROUTER, amountToApprove);
        console.log(`⏳  Transaksi dikirim! Hash: ${tx.hash}`);
        console.log('Menunggu transaksi dikonfirmasi oleh jaringan...');
        await tx.wait();
        console.log('✅  Izin berhasil diberikan! Router sekarang bisa menggunakan USDC kita.');
    } catch (error) {
        console.error('💥 Gagal melakukan approve!', error.reason || error.message);
    }
    console.log('----------------------------------------------------');
}

async function main() {
    console.log('🚀 Memulai bot untuk XOS Testnet...');
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    console.log('🔌 Berhasil terhubung ke RPC URL XOS Testnet.');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);
    const saldoNative = await provider.getBalance(wallet.address);
    const saldoNativeFormatted = ethers.formatEther(saldoNative);
    console.log(`💰 Saldo Native (XOS): ${saldoNativeFormatted}`);
    console.log('----------------------------------------------------');
    console.log(`🔍 Membaca data dari token di alamat: ${CONTRACT_ADDRESSES.USDC}`);
    // Menggunakan data dari config.js
    const usdcReadContract = new ethers.Contract(CONTRACT_ADDRESSES.USDC, CONTRACT_ABIS.ERC20, provider);
    try {
        const [namaToken, simbolToken, desimalToken, saldoToken] = await Promise.all([
            usdcReadContract.name(),
            usdcReadContract.symbol(),
            usdcReadContract.decimals(),
            usdcReadContract.balanceOf(wallet.address)
        ]);
        console.log(`Nama Token: ${namaToken}`);
        console.log(`Simbol Token: ${simbolToken}`);
        console.log(`Jumlah Desimal: ${desimalToken}`);
        const saldoTokenFormatted = ethers.formatUnits(saldoToken, desimalToken);
        console.log(`💰 Saldo ${simbolToken} kita: ${saldoTokenFormatted}`);
        
        if (saldoToken > 0) {
            await approveToken(wallet);
        } else {
            console.log('Saldo token 0, tidak perlu melakukan approve.');
        }

    } catch (error) {
        console.error('💥 Gagal membaca data dari kontrak token!', error.reason || error.message);
    }
    console.log('----------------------------------------------------');
}

main().catch(error => {
    console.error('💥 Terjadi error fatal:', error);
    process.exit(1);
});
