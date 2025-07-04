// config.js

// Di sini kita kumpulkan semua alamat kontrak penting agar terpusat.
export const CONTRACT_ADDRESSES = {
    // Ganti dengan alamat USDC di XOS Testnet
    USDC: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d',
    // Ganti dengan alamat Router DEX yang sudah kamu temukan
    ROUTER: '0xdc7D6b58c89A554b3FDC4B5B10De9b4DbF39FB40',
    WXOS: '0x0AAB67cf6F2e99847b9A95DeC950B250D648c1BB'
};

// Di sini kita kumpulkan semua ABI (Application Binary Interface).
// di dalam file config.js

export const CONTRACT_ABIS = {
    ERC20: [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)"
    ],
    // PASTIKAN BAGIAN ROUTER INI SUDAH LENGKAP
    ROUTER: [
        "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable",
        // INI BARIS YANG MUNGKIN LUPA TERSIMPAN
        "function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)"
    ]
};
