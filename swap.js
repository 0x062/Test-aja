const { ethers } = require('ethers');
require('dotenv').config();

const PRIVATE_KEY   = (process.env.PRIVATE_KEY || '').trim();
if (!PRIVATE_KEY.startsWith('0x') || PRIVATE_KEY.length !== 66) {
  console.error('❌ PRIVATE_KEY invalid or missing.');
  process.exit(1);
}

const RPC_URL        = process.env.RPC_URL;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const WNATIVE        = process.env.WNATIVE;
const AMOUNT_IN_RAW  = process.env.AMOUNT_IN;             // e.g. "0.001"
const SLIPPAGE       = parseFloat(process.env.SLIPPAGE) / 100;    // e.g. 1 → 0.01
const DEADLINE_SEC   = parseInt(process.env.DEADLINE_MINUTES, 10) * 60;
const GAS_LIMIT      = parseInt(process.env.GAS_LIMIT, 10);

if (!RPC_URL || !ROUTER_ADDRESS || !WNATIVE || !AMOUNT_IN_RAW) {
  console.error('❌ RPC_URL, ROUTER_ADDRESS, WNATIVE, or AMOUNT_IN missing in .env');
  process.exit(1);
}

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

// Router with explicit ABIs
const router = new ethers.Contract(
  ROUTER_ADDRESS,
  [
    "function swapExactETHForTokens(uint256,address[],address,uint256) payable returns(uint256[])",
    "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])",
    "function getAmountsOut(uint256,address[]) view returns(uint256[])"
  ],
  wallet
);

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)"
];

// Preload token metadata for all addresses in SWAP_PAIRS
const SWAP_PAIRS = [
  { from: WNATIVE, to: "0x2CCDB83a043A32898496c1030880Eb2cB977CAbc" }, // XOS→USDT
  { from: WNATIVE, to: "0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d" }, // XOS→USDC
  { from: "0x2CCDB83a043A32898496c1030880Eb2cB977CAbc", to: "0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d" } // USDT→USDC
];

async function loadTokenInfo(addrs) {
  const info = {};
  for (const addr of addrs) {
    if (addr === WNATIVE) {
      info[addr] = { symbol: "XOS", decimals: 18 };
    } else {
      const t = new ethers.Contract(addr, ERC20_ABI, provider);
      try {
        const [sym, dec] = await Promise.all([t.symbol(), t.decimals()]);
        info[addr] = { symbol: sym, decimals: dec };
      } catch {
        info[addr] = { symbol: addr.slice(0,6)+"…", decimals: 18 };
      }
    }
  }
  return info;
}

async function swapToken(from, to, amountRaw, tokenInfo) {
  const { symbol: symIn, decimals: decIn }   = tokenInfo[from];
  const { symbol: symOut, decimals: decOut } = tokenInfo[to];

  const amountIn = ethers.utils.parseUnits(amountRaw, decIn);
  const path     = from === WNATIVE ? [WNATIVE, to] : [from, WNATIVE, to];

  const amountsOut   = await router.getAmountsOut(amountIn, path);
  const estimatedOut = amountsOut[amountsOut.length - 1];
  const minOut       = estimatedOut.mul(Math.floor((1 - SLIPPAGE) * 1000)).div(1000);
  const deadline     = Math.floor(Date.now() / 1000) + DEADLINE_SEC;

  console.log(`\n🔄 Swap ${amountRaw} ${symIn} → ${symOut}`);
  console.log(`   estimated out: ${ethers.utils.formatUnits(estimatedOut, decOut)} ${symOut}`);
  console.log(`   min out (${(SLIPPAGE*100).toFixed(2)}% slippage): ${ethers.utils.formatUnits(minOut, decOut)} ${symOut}`);

  // approval
  if (from !== WNATIVE) {
    const token     = new ethers.Contract(from, ERC20_ABI, wallet);
    const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
    if (allowance.lt(amountIn)) {
      process.stdout.write(`   🔑 Approving ${symIn}… `);
      await (await token.approve(ROUTER_ADDRESS, ethers.constants.MaxUint256)).wait();
      console.log("✅");
    }
  }

  // balance before
  const before = await new ethers.Contract(to, ERC20_ABI, provider).balanceOf(wallet.address);

  // execute swap
  const opts = { gasLimit: GAS_LIMIT };
  if (from === WNATIVE) opts.value = amountIn;

  const fnSig = from === WNATIVE
    ? "swapExactETHForTokens(uint256,address[],address,uint256)"
    : "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)";

  const args = from === WNATIVE
    ? [minOut, path, wallet.address, deadline]
    : [amountIn, minOut, path, wallet.address, deadline];

  console.log("   🚀 sending txn…");
  const tx = await router[fnSig](...args, opts);
  console.log(`   📋 tx hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`   📦 status: ${receipt.status === 1 ? "✅ success" : "❌ failed"}`);

  const after = await new ethers.Contract(to, ERC20_ABI, provider).balanceOf(wallet.address);
  console.log(`   🎉 received: ${ethers.utils.formatUnits(after.sub(before), decOut)} ${symOut}`);
}

(async () => {
  console.log("🤖 Starting swaps…");
  // collect unique addresses
  const addrs = Array.from(new Set([
    ...SWAP_PAIRS.map(p=>p.from),
    ...SWAP_PAIRS.map(p=>p.to)
  ]));
  const tokenInfo = await loadTokenInfo(addrs);

  for (const { from, to } of SWAP_PAIRS) {
    try {
      await swapToken(from, to, AMOUNT_IN_RAW, tokenInfo);
    } catch (e) {
      console.error(`❌ Error swapping ${tokenInfo[from].symbol}→${tokenInfo[to].symbol}:`, e.message);
    }
  }
  console.log("\n🎉 All done!");
})();
