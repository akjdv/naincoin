# Nain Coin v2

A polished educational proof-of-work blockchain for a fake coin called **Nain / NAIN**.

## What is included

- Working Node.js + Express blockchain server
- Real proof-of-work mining with nonce search
- Blocks with hashes, previous hashes, difficulty, nonce, mining time, and hash checks
- Wallet generation using secp256k1 key pairs
- Signed transactions
- Mempool
- Mining rewards
- Balance checker
- Rich list
- Address transaction history
- Chain validation
- Browser UI
- On-chain play-money casino section:
  - Dice
  - Slots
  - Crash
- Casino bank wallet
- Casino bets and payouts recorded in mined blocks
- JSON persistence in `data/nain-state.json`

## Important warning

This is a working educational blockchain, but it is **not a production cryptocurrency**.

NAIN has no real value. Do not sell it. Do not connect it to real money. Do not market it as an investment. The casino section is fake play-money only.

## Run locally

Install Node.js 18 or newer.

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Basic usage

1. Click **Create new wallet**.
2. Click **Mine block** to earn 25 NAIN.
3. Mine a few blocks if you want betting/spending balance.
4. Send NAIN to another NAIN address.
5. Mine again to confirm normal transfers.
6. Use the casino games with your fake NAIN balance.
7. View the chain in the explorer.

## API endpoints

### Info

```bash
GET /api/info
```

### Create wallet

```bash
POST /api/wallet
```

### Mine block

```bash
POST /api/mine
Content-Type: application/json

{
  "minerAddress": "NAIN_your_address"
}
```

### Send transaction

```bash
POST /api/transaction
Content-Type: application/json

{
  "privateKey": "-----BEGIN PRIVATE KEY-----...",
  "toAddress": "NAIN_recipient_address",
  "amount": 10,
  "memo": "hello"
}
```

### Play casino game

```bash
POST /api/casino/play
Content-Type: application/json

{
  "privateKey": "-----BEGIN PRIVATE KEY-----...",
  "game": "dice",
  "betAmount": 5,
  "clientSeed": "anything-random",
  "params": {
    "rollUnder": 50
  }
}
```

Supported games:

```text
dice
slots
crash
```

### Balance

```bash
GET /api/balance/NAIN_address
```

### Address history

```bash
GET /api/transactions/NAIN_address
```

### Full public chain

```bash
GET /api/chain
```

### Pending transactions

```bash
GET /api/pending
```

### Validate chain

```bash
GET /api/validate
```

## Deploy for free

This is a Node/Express app. Static hosts like GitHub Pages cannot run the blockchain server.

Good simple options:

- Render Web Service
- Koyeb Web Service
- Railway hobby/prototype deployment

### Render deployment

1. Make a GitHub account if needed.
2. Create a new GitHub repository.
3. Upload all project files to the repo.
4. Go to Render.
5. Create a new **Web Service**.
6. Connect the GitHub repo.
7. Use these settings:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
```

8. Deploy.
9. Open the Render URL.

### Koyeb deployment

1. Upload this project to GitHub.
2. Go to Koyeb.
3. Create Web Service.
4. Choose GitHub deployment.
5. Select your repo.
6. Koyeb detects Node.js when `package.json` is in the root.
7. Use:

```text
Build command: npm install
Run command: npm start
```

8. Deploy and open the `.koyeb.app` URL.

### Railway deployment

1. Upload this project to GitHub.
2. Create a new Railway project.
3. Deploy from GitHub repo.
4. Railway should detect Node.js.
5. Start command:

```text
npm start
```

## Persistence warning

Free hosting can sleep, restart, or wipe local filesystem data. The chain is stored in:

```text
data/nain-state.json
```

For a serious long-running demo, add persistent disk storage or replace the JSON file with SQLite/Postgres.

## Recommended next upgrades

- Peer-to-peer networking
- Difficulty adjustment every N blocks
- Browser-side signing so private keys never hit the server
- SQLite or Postgres persistence
- User accounts
- Rate limiting
- WebSocket live updates
- Block pagination
- Proper provably-fair commit/reveal casino seed flow
- Admin dashboard
