export const CONTRACT_ADDRESSES = {
    ROUTER: '0xdc7D6b58c89A554b3FDC4B5B10De9b4DbF39FB40',
    WXOS: '0x0AAB67cf6F2e99847b9A95DeC950B250D648c1BB', 
    // TAMBAHKAN ALAMAT FACTORY V3 YANG KAMU TEMUKAN
    FACTORY_V3: '0x8a3CC3a133480b394A975F8cD4668Ce8cC99Cb9B',
};

// DAFTAR TARGET KITA JADI LEBIH SIMPLE, TANPA FEE
export const TARGET_TOKENS = [
    { name: 'USDC', address: '0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d' },
    { name: 'USDT',  address: '0x2CCDB83a043A32898496c1030880Eb2cB977CAbc' },
];

export const CONTRACT_ABIS = {

    FACTORY_V3: [
        "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"
    ],
    
    ERC20: [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)"
    ],
    
    // Gunakan versi ringkas ini untuk Router
    ROUTER: [
        // Fungsi utama untuk swap V3 (satu pool)
        {
            "inputs": [
                {
                    "components": [
                        { "internalType": "address", "name": "tokenIn", "type": "address" },
                        { "internalType": "address", "name": "tokenOut", "type": "address" },
                        { "internalType": "uint24", "name": "fee", "type": "uint24" },
                        { "internalType": "address", "name": "recipient", "type": "address" },
                        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
                        { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
                        { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
                    ],
                    "internalType": "struct IV3SwapRouter.ExactInputSingleParams",
                    "name": "params",
                    "type": "tuple"
                }
            ],
            "name": "exactInputSingle",
            "outputs": [
                { "internalType": "uint256", "name": "amountOut", "type": "uint256" }
            ],
            "stateMutability": "payable",
            "type": "function"
        },
        // Fungsi untuk wrap XOS -> WXOS (berguna nanti)
        {
            "inputs": [{"internalType":"uint256","name":"value","type":"uint256"}],
            "name":"wrapETH",
            "outputs":[],
            "stateMutability":"payable",
            "type":"function"
        },
        {"inputs":[],"name":"factory","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
        // Fungsi untuk unwrap WXOS -> XOS (berguna nanti)
        {
            "inputs":[{"internalType":"uint256","name":"amountMinimum","type":"uint256"},{"internalType":"address","name":"recipient","type":"address"}],
            "name":"unwrapWETH9",
            "outputs":[],
            "stateMutability":"payable",
            "type":"function"
        }
    ]
};
