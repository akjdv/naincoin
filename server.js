const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "nain-state.json");

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function nowISO() {
  return new Date().toISOString();
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

function addressFromPublicKey(publicKeyPem) {
  return "NAIN_" + sha256(publicKeyPem).slice(0, 40);
}

function txPayload(tx) {
  return stableStringify({
    id: tx.id,
    type: tx.type,
    fromAddress: tx.fromAddress,
    fromPublicKey: tx.fromPublicKey,
    toAddress: tx.toAddress,
    amount: tx.amount,
    timestamp: tx.timestamp,
    memo: tx.memo
  });
}

function createKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  return { publicKey, privateKey, address: addressFromPublicKey(publicKey) };
}

function publicKeyFromPrivateKey(privateKeyPem) {
  return crypto.createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" });
}

class Transaction {
  constructor({ id, type, fromAddress, fromPublicKey, toAddress, amount, timestamp, signature, memo }) {
    this.id = id || "tx_" + randomHex(12);
    this.type = type || "transfer";
    this.fromAddress = fromAddress || null;
    this.fromPublicKey = fromPublicKey || null;
    this.toAddress = String(toAddress || "").trim();
    this.amount = Number(amount);
    this.timestamp = timestamp || nowISO();
    this.signature = signature || null;
    this.memo = memo || "";
  }

  isSystemMint() {
    return this.fromAddress === null;
  }

  isValid(allowSystemMint = false) {
    if (!this.toAddress || !Number.isFinite(this.amount) || this.amount <= 0) return false;

    if (this.isSystemMint()) {
      return allowSystemMint || this.type === "mining_reward" || this.type === "genesis";
    }

    if (!this.fromAddress || !this.fromPublicKey || !this.signature) return false;
    if (addressFromPublicKey(this.fromPublicKey) !== this.fromAddress) return false;

    try {
      const verify = crypto.createVerify("SHA256");
      verify.update(txPayload(this));
      verify.end();
      return verify.verify(this.fromPublicKey, this.signature, "hex");
    } catch {
      return false;
    }
  }
}

function signTransaction(privateKey, fields) {
  const fromPublicKey = publicKeyFromPrivateKey(privateKey);
  const tx = new Transaction({
    ...fields,
    fromAddress: addressFromPublicKey(fromPublicKey),
    fromPublicKey
  });
  const sign = crypto.createSign("SHA256");
  sign.update(txPayload(tx));
  sign.end();
  tx.signature = sign.sign(privateKey, "hex");
  return tx;
}

class Block {
  constructor({ index, timestamp, transactions, previousHash, nonce, hash, miner, difficulty, hashChecks, minedMs }) {
    this.index = index;
    this.timestamp = timestamp || nowISO();
    this.transactions = (transactions || []).map(t => new Transaction(t));
    this.previousHash = previousHash || "0";
    this.nonce = nonce || 0;
    this.miner = miner || null;
    this.difficulty = difficulty || 3;
    this.hashChecks = hashChecks || 0;
    this.minedMs = minedMs || 0;
    this.hash = hash || this.calculateHash();
  }

  calculateHash() {
    return sha256(stableStringify({
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions,
      previousHash: this.previousHash,
      nonce: this.nonce,
      miner: this.miner,
      difficulty: this.difficulty
    }));
  }

  mine() {
    const started = Date.now();
    const target = "0".repeat(this.difficulty);
    this.hash = this.calculateHash();

    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hashChecks++;
      this.hash = this.calculateHash();
    }

    this.minedMs = Date.now() - started;
  }
}

class Blockchain {
  constructor(saved) {
    this.difficulty = Number(saved?.difficulty || 4);
    this.miningReward = Number(saved?.miningReward || 25);
    this.maxTransactionsPerBlock = Number(saved?.maxTransactionsPerBlock || 75);
    this.casinoWallet = saved?.casinoWallet || createKeyPair();
    this.casinoAddress = this.casinoWallet.address;
    this.casinoStats = saved?.casinoStats || {
      gamesPlayed: 0,
      totalBet: 0,
      totalPaid: 0,
      biggestWin: 0
    };

    if (saved && Array.isArray(saved.chain) && saved.chain.length) {
      this.chain = saved.chain.map(b => new Block(b));
      this.pendingTransactions = (saved.pendingTransactions || []).map(t => new Transaction(t));
    } else {
      this.chain = [this.createGenesisBlock()];
      this.pendingTransactions = [];
    }
  }

  createGenesisBlock() {
    const txs = [
      new Transaction({
        type: "genesis",
        fromAddress: null,
        toAddress: this.casinoAddress,
        amount: 1000000,
        timestamp: "2026-01-01T00:00:00.000Z",
        memo: "Genesis casino bank reserve"
      })
    ];

    const block = new Block({
      index: 0,
      timestamp: "2026-01-01T00:00:00.000Z",
      transactions: txs,
      previousHash: "0",
      miner: "genesis",
      difficulty: 0
    });
    block.hash = block.calculateHash();
    return block;
  }

  latestBlock() {
    return this.chain[this.chain.length - 1];
  }

  addTransaction(rawTx) {
    const tx = new Transaction(rawTx);
    if (!tx.isValid(false)) throw new Error("Invalid transaction or bad signature.");

    if (tx.fromAddress) {
      const balance = this.getConfirmedBalance(tx.fromAddress);
      const pendingSpend = this.pendingTransactions
        .filter(t => t.fromAddress === tx.fromAddress)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      if (balance - pendingSpend < tx.amount) throw new Error("Not enough confirmed NAIN.");
    }

    this.pendingTransactions.push(tx);
    saveState();
    return tx;
  }

  minePendingTransactions(minerAddress) {
    minerAddress = String(minerAddress || "").trim();
    if (!minerAddress) throw new Error("Miner address required.");

    const rewardTx = new Transaction({
      type: "mining_reward",
      fromAddress: null,
      toAddress: minerAddress,
      amount: this.miningReward,
      timestamp: nowISO(),
      memo: `Mining reward for block ${this.chain.length}`
    });

    const txs = [
      ...this.pendingTransactions.slice(0, this.maxTransactionsPerBlock),
      rewardTx
    ];

    return this.mineBlock(txs, minerAddress, true);
  }

  mineBlock(transactions, minerAddress, removePending = false) {
    const block = new Block({
      index: this.chain.length,
      timestamp: nowISO(),
      transactions,
      previousHash: this.latestBlock().hash,
      miner: minerAddress,
      difficulty: this.difficulty
    });

    for (const tx of block.transactions) {
      if (!tx.isValid(tx.type === "mining_reward" || tx.type === "genesis")) {
        throw new Error("Block contains invalid transaction.");
      }
    }

    block.mine();
    this.chain.push(block);

    if (removePending) {
      this.pendingTransactions = this.pendingTransactions.slice(this.maxTransactionsPerBlock);
    }

    saveState();
    return block;
  }

  getConfirmedBalance(address) {
    let balance = 0;
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.fromAddress === address) balance -= Number(tx.amount);
        if (tx.toAddress === address) balance += Number(tx.amount);
      }
    }
    return Number(balance.toFixed(8));
  }

  getPendingDelta(address) {
    let delta = 0;
    for (const tx of this.pendingTransactions) {
      if (tx.fromAddress === address) delta -= Number(tx.amount);
      if (tx.toAddress === address) delta += Number(tx.amount);
    }
    return Number(delta.toFixed(8));
  }

  getAllBalances() {
    const balances = {};
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.fromAddress) balances[tx.fromAddress] = (balances[tx.fromAddress] || 0) - Number(tx.amount);
        if (tx.toAddress) balances[tx.toAddress] = (balances[tx.toAddress] || 0) + Number(tx.amount);
      }
    }
    return Object.entries(balances)
      .map(([address, balance]) => ({ address, balance: Number(balance.toFixed(8)) }))
      .sort((a, b) => b.balance - a.balance);
  }

  getTransactionsForAddress(address) {
    const out = [];
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.fromAddress === address || tx.toAddress === address) {
          out.push({ block: block.index, hash: block.hash, transaction: tx });
        }
      }
    }
    return out.reverse();
  }

  isChainValid() {
    if (!this.chain.length) return false;
    if (this.chain[0].hash !== this.chain[0].calculateHash()) return false;

    for (let i = 1; i < this.chain.length; i++) {
      const current = new Block(this.chain[i]);
      const previous = new Block(this.chain[i - 1]);

      if (current.hash !== current.calculateHash()) return false;
      if (current.previousHash !== previous.hash) return false;
      if (!current.hash.startsWith("0".repeat(current.difficulty))) return false;

      for (const tx of current.transactions) {
        const allowSystem = tx.type === "mining_reward" || tx.type === "genesis";
        if (!tx.isValid(allowSystem)) return false;
      }
    }

    return true;
  }

  toJSON() {
    return {
      difficulty: this.difficulty,
      miningReward: this.miningReward,
      maxTransactionsPerBlock: this.maxTransactionsPerBlock,
      casinoAddress: this.casinoAddress,
      casinoWallet: this.casinoWallet,
      casinoStats: this.casinoStats,
      chain: this.chain,
      pendingTransactions: this.pendingTransactions
    };
  }

  publicJSON() {
    return {
      difficulty: this.difficulty,
      miningReward: this.miningReward,
      maxTransactionsPerBlock: this.maxTransactionsPerBlock,
      casinoAddress: this.casinoAddress,
      casinoStats: this.casinoStats,
      chain: this.chain,
      pendingTransactions: this.pendingTransactions
    };
  }
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error("Could not load saved state:", err.message);
    return null;
  }
}

let nain = new Blockchain(loadState());

function saveState() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(nain.toJSON(), null, 2));
}

function resolveDice({ choice, rollUnder, betAmount, clientSeed, serverSeed }) {
  const roll = (parseInt(sha256(`${serverSeed}:${clientSeed}:dice`).slice(0, 8), 16) % 10000) / 100;
  const target = Math.max(2, Math.min(98, Number(rollUnder || 50)));
  const win = roll < target;
  const multiplier = Number((99 / target).toFixed(4));
  return {
    game: "dice",
    roll,
    target,
    win,
    multiplier,
    payout: win ? Number((betAmount * multiplier).toFixed(8)) : 0,
    text: win ? `Won: rolled ${roll} under ${target}` : `Lost: rolled ${roll}, needed under ${target}`
  };
}

function resolveSlots({ betAmount, clientSeed, serverSeed }) {
  const symbols = ["NAIN", "N", "🍖", "⚡", "💎", "👑"];
  const hash = sha256(`${serverSeed}:${clientSeed}:slots`);
  const reels = [0, 1, 2].map(i => symbols[parseInt(hash.slice(i * 8, i * 8 + 8), 16) % symbols.length]);
  let multiplier = 0;
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    multiplier = reels[0] === "👑" ? 20 : reels[0] === "💎" ? 12 : 8;
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    multiplier = 1.8;
  }
  const payout = Number((betAmount * multiplier).toFixed(8));
  return {
    game: "slots",
    reels,
    win: payout > 0,
    multiplier,
    payout,
    text: payout > 0 ? `Won ${multiplier}x on ${reels.join(" ")}` : `Lost on ${reels.join(" ")}`
  };
}

function resolveCrash({ cashout, betAmount, clientSeed, serverSeed }) {
  const n = parseInt(sha256(`${serverSeed}:${clientSeed}:crash`).slice(0, 8), 16);
  const r = n / 0xffffffff;
  const crashPoint = Number(Math.max(1.01, Math.min(50, 0.99 / Math.max(0.01, 1 - r))).toFixed(2));
  const target = Math.max(1.01, Math.min(25, Number(cashout || 2)));
  const win = target <= crashPoint;
  return {
    game: "crash",
    crashPoint,
    target,
    win,
    multiplier: win ? target : 0,
    payout: win ? Number((betAmount * target).toFixed(8)) : 0,
    text: win ? `Cashed out at ${target}x before ${crashPoint}x` : `Crashed at ${crashPoint}x before ${target}x`
  };
}

function resolveCasinoGame({ game, betAmount, clientSeed, params }) {
  const serverSeed = randomHex(32);
  if (game === "dice") return { ...resolveDice({ ...params, betAmount, clientSeed, serverSeed }), serverSeed, serverSeedHash: sha256(serverSeed) };
  if (game === "slots") return { ...resolveSlots({ betAmount, clientSeed, serverSeed }), serverSeed, serverSeedHash: sha256(serverSeed) };
  if (game === "crash") return { ...resolveCrash({ ...params, betAmount, clientSeed, serverSeed }), serverSeed, serverSeedHash: sha256(serverSeed) };
  throw new Error("Unknown casino game.");
}

function settleCasinoBet({ privateKey, game, betAmount, clientSeed, params }) {
  betAmount = Number(betAmount);
  if (!Number.isFinite(betAmount) || betAmount <= 0) throw new Error("Bet amount must be positive.");

  const fromPublicKey = publicKeyFromPrivateKey(privateKey);
  const playerAddress = addressFromPublicKey(fromPublicKey);

  const confirmed = nain.getConfirmedBalance(playerAddress);
  if (confirmed < betAmount) throw new Error("Not enough confirmed NAIN for this bet.");

  const result = resolveCasinoGame({
    game,
    betAmount,
    clientSeed: String(clientSeed || randomHex(8)),
    params: params || {}
  });

  const betTx = signTransaction(privateKey, {
    type: "casino_bet",
    toAddress: nain.casinoAddress,
    amount: betAmount,
    timestamp: nowISO(),
    memo: `${game} bet | ${result.text}`
  });

  const txs = [betTx];

  if (result.payout > 0) {
    if (nain.getConfirmedBalance(nain.casinoAddress) < result.payout) {
      throw new Error("Casino bank does not have enough NAIN to pay this result.");
    }

    const payoutTx = signTransaction(nain.casinoWallet.privateKey, {
      type: "casino_payout",
      toAddress: playerAddress,
      amount: result.payout,
      timestamp: nowISO(),
      memo: `${game} payout | ${result.text}`
    });
    txs.push(payoutTx);
  }

  nain.casinoStats.gamesPlayed += 1;
  nain.casinoStats.totalBet = Number((nain.casinoStats.totalBet + betAmount).toFixed(8));
  nain.casinoStats.totalPaid = Number((nain.casinoStats.totalPaid + result.payout).toFixed(8));
  nain.casinoStats.biggestWin = Math.max(nain.casinoStats.biggestWin, result.payout);

  const casinoBlock = nain.mineBlock(txs, "casino-settlement", false);
  return { result, block: casinoBlock, playerAddress };
}

app.get("/api/info", (req, res) => {
  const latest = nain.latestBlock();
  res.json({
    name: "Nain",
    ticker: "NAIN",
    version: "2.0.0",
    blocks: nain.chain.length,
    pendingTransactions: nain.pendingTransactions.length,
    difficulty: nain.difficulty,
    miningReward: nain.miningReward,
    valid: nain.isChainValid(),
    latestHash: latest.hash,
    latestBlock: latest.index,
    casinoAddress: nain.casinoAddress,
    casinoStats: nain.casinoStats
  });
});

app.get("/api/chain", (req, res) => res.json(nain.publicJSON()));
app.get("/api/blocks/latest", (req, res) => res.json(nain.latestBlock()));
app.get("/api/pending", (req, res) => res.json(nain.pendingTransactions));
app.get("/api/balances", (req, res) => res.json(nain.getAllBalances()));
app.get("/api/validate", (req, res) => res.json({ valid: nain.isChainValid() }));

app.get("/api/balance/:address", (req, res) => {
  const address = req.params.address;
  res.json({
    address,
    confirmed: nain.getConfirmedBalance(address),
    pendingDelta: nain.getPendingDelta(address),
    spendable: nain.getConfirmedBalance(address) + Math.min(0, nain.getPendingDelta(address))
  });
});

app.get("/api/transactions/:address", (req, res) => {
  res.json(nain.getTransactionsForAddress(req.params.address));
});

app.post("/api/wallet", (req, res) => {
  res.json(createKeyPair());
});

app.post("/api/transaction/sign-preview", (req, res) => {
  try {
    const { privateKey, toAddress, amount, memo } = req.body;
    const tx = signTransaction(privateKey, {
      type: "transfer",
      toAddress,
      amount,
      timestamp: nowISO(),
      memo: memo || "Nain transfer"
    });
    res.json(tx);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/transaction", (req, res) => {
  try {
    const { privateKey, toAddress, amount, memo } = req.body;
    const tx = signTransaction(privateKey, {
      type: "transfer",
      toAddress,
      amount,
      timestamp: nowISO(),
      memo: memo || "Nain transfer"
    });
    const added = nain.addTransaction(tx);
    res.json({ message: "Transaction added to mempool. Mine a block to confirm it.", transaction: added });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/mine", (req, res) => {
  try {
    const block = nain.minePendingTransactions(req.body.minerAddress);
    res.json({
      message: "Proof-of-work block mined.",
      block,
      hashrate: block.minedMs > 0 ? Math.round(block.hashChecks / (block.minedMs / 1000)) : block.hashChecks
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/casino/play", (req, res) => {
  try {
    const { privateKey, game, betAmount, clientSeed, params } = req.body;
    if (!privateKey) throw new Error("Private key required.");
    const settlement = settleCasinoBet({ privateKey, game, betAmount, clientSeed, params });
    res.json({
      message: "Casino game settled on-chain with proof-of-work.",
      ...settlement
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/admin/reset", (req, res) => {
  const token = req.headers["x-reset-token"];
  if (process.env.RESET_TOKEN && token === process.env.RESET_TOKEN) {
    nain = new Blockchain(null);
    saveState();
    return res.json({ message: "Nain chain reset." });
  }
  res.status(403).json({ error: "Reset disabled. Set RESET_TOKEN env var and send x-reset-token header." });
});

app.listen(PORT, () => {
  saveState();
  console.log(`Nain Coin v2 running on port ${PORT}`);
});
