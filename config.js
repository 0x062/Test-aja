// config.js

// Di sini kita kumpulkan semua alamat kontrak penting agar terpusat.
export const CONTRACT_ADDRESSES = {
    // Ganti dengan alamat USDC di XOS Testnet
    USDC: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d',
    // Ganti dengan alamat Router DEX yang sudah kamu temukan
    ROUTER: '0xdc7D6b58c89A554b3FDC4B5B10De9b4DbF39FB40',
};

// Di sini kita kumpulkan semua ABI (Application Binary Interface).
export const CONTRACT_ABIS = {
    // ABI untuk token standar ERC-20
    ERC20: [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)"
    ],
    // Nanti kita akan tambahkan ABI untuk Router di sini saat masuk Babak 4
    ROUTER: [
        // ... akan diisi nanti
    ]
};
