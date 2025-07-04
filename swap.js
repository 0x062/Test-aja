// main.js

import { ethers } from 'ethers';
import 'dotenv/config';

// --- KONFIGURASI UNTUK XOS TESTNET ---
// GANTI DENGAN ALAMAT KONTRAK USDC DI XOS TESTNET YANG KAMU TEMUKAN
const TOKEN_TO_CHECK_ADDRESS = process.env.USDC;

// ABI ERC-20 standar, ini tidak perlu diubah karena fungsinya sama.
const TOKEN_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
];
// -----------------------------------------

async function main() {
    console.log('🚀 Memulai bot untuk XOS Testnet...');

    // Gunakan variabel RPC yang benar dari file .env
    const provider = new ethers.JsonRpcProvider(process.env.XOS_TESTNET_RPC_URL);
    console.log('🔌 Berhasil terhubung ke RPC URL XOS Testnet.');

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`✅ Bot berjalan menggunakan alamat: ${wallet.address}`);

    // Mengambil saldo koin asli (XOS)
    const saldoNative = await provider.getBalance(wallet.address);
    const saldoNativeFormatted = ethers.formatEther(saldoNative);
    console.log(`💰 Saldo Native (XOS): ${saldoNativeFormatted}`);
    console.log('----------------------------------------------------');

    console.log(`🔍 Membaca data dari token di alamat: ${TOKEN_TO_CHECK_ADDRESS}`);

    // Membuat objek 'Contract' untuk token target kita di XOS Testnet
    const tokenContract = new ethers.Contract(TOKEN_TO_CHECK_ADDRESS, TOKEN_ABI, provider);

    // Memanggil fungsi-fungsi dari smart contract token
    try {
        const [namaToken, simbolToken, desimalToken, saldoToken] = await Promise.all([
            tokenContract.name(),
            tokenContract.symbol(),
            tokenContract.decimals(),
            tokenContract.balanceOf(wallet.address)
        ]);

        console.log(`Nama Token: ${namaToken}`);
        console.log(`Simbol Token: ${simbolToken}`);
        console.log(`Jumlah Desimal: ${desimalToken}`);

        const saldoTokenFormatted = ethers.formatUnits(saldoToken, desimalToken);
        console.log(`💰 Saldo ${simbolToken} kita: ${saldoTokenFormatted}`);

    } catch (error) {
        console.error('💥 Gagal membaca data dari kontrak token!', error.reason || error.message);
        console.error('Pastikan alamat token dan RPC URL sudah benar, dan jaringan tidak sedang down.');
    }
    console.log('----------------------------------------------------');
}

main().catch(error => {
    console.error('💥 Terjadi error fatal:', error);
    process.exit(1);
});
