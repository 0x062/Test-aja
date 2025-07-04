// swap.js

import { ethers } from 'ethers';
import 'dotenv/config';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from './config.js';

async function approveToken(wallet) {
    console.log('----------------------------------------------------');
    console.log('⚙️  Mempersiapkan transaksi "Approve"...');
    const usdcContract = new ethers.Contract(CONTRACT_ADDRESSES.USDC, CONTRACT_ABIS.ERC20, wallet);
    const amountToApprove = ethers.MaxUint256;
    try {
        // Cek allowance dulu
        const allowance = await usdcContract.allowance(wallet.address, CONTRACT_ADDRESSES.ROUTER);
        if (allowance >= ethers.parseUnits("1", 18)) { // Cek jika allowance sudah cukup besar
            console.log("✅ Izin sudah diberikan sebelumnya.");
            return true; // Kembalikan true jika sudah di-approve
        }

        console.log(`✍️  Memberi izin (approve) kepada Router...`);
        const tx = await usdcContract.approve(CONTRACT_ADDRESSES.ROUTER, amountToApprove);
        console.log(`⏳  Transaksi Approve dikirim! Hash: ${tx.hash}`);
        await tx.wait();
        console.log('✅  Izin berhasil diberikan!');
        return true; // Kembalikan true jika approve berhasil
    } catch (error) {
        console.error('💥 Gagal melakukan approve!', error.reason || error.message);
        return false; // Kembalikan false jika gagal
    }
}

async function executeSwap(wallet) {
    console.log('----------------------------------------------------');
    console.log('🚀 Mempersiapkan transaksi "SWAP"...');
    const routerContract = new ethers.Contract(CONTRACT_ADDRESSES.ROUTER, CONTRACT_ABIS.ROUTER, wallet);
    const amountInString = '0.01';
    const amountIn = ethers.parseEther(amountInString);
    const amountOutMin = 0;
    const path = [CONTRACT_ADDRESSES.WXOS, CONTRACT_ADDRESSES.USDC];
    const to = wallet.address;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    try {
        console.log(`💸 Menukar ${amountInString} XOS dengan USDC...`);
        const tx = await routerContract.swapExactETHForTokens(
            amountOutMin, path, to, deadline, { value: amountIn }
        );
        console.log(`⏳  Transaksi SWAP dikirim! Hash: ${tx.hash}`);
        await tx.wait();
        console.log('✅  SWAP BERHASIL! Selamat!');
    } catch (error) {
        console.error('💥 Gagal melakukan SWAP!', error.reason || error.message);
    }
}

async function main() {
    console.log('🚀 Memulai bot untuk XOS Testnet...');
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);
    const saldoNative = await provider.getBalance(wallet.address);
    console.log(`💰 Saldo Native (XOS): ${ethers.formatEther(saldoNative)}`);

    const approveSuccess = await approveToken(wallet);

    if (approveSuccess) {
        await executeSwap(wallet);
    } else {
        console.log("Approve gagal, proses swap dibatalkan.");
    }
    
    console.log('----------------------------------------------------');
    console.log('🎉 Bot telah menyelesaikan tugasnya.');
}

main().catch(error => {
    console.error('💥 Terjadi error fatal:', error);
    process.exit(1);
});
