// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const mongoose = require('mongoose');

const { createToken, mint, transfer, burn, toSmallestUnit } = require('./tokenService');
const { createTopic, submitMessage } = require('./hcsService');
const { User, Deposit, Tx } = require('./models');

const app = express();
app.use(bodyParser.json());

// connect DB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log("MongoDB connected"))
  .catch(e=> console.error("Mongo err", e));

// webhook verification
function verifyWebhook(req) {
  const secret = process.env.WEBHOOK_SECRET || '';
  const signature = req.headers['x-signature'] || '';
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return signature === expected;
}

// Create HCS topic (admin)
app.post('/admin/create-topic', async (req, res) => {
  try {
    const topicId = await createTopic();
    return res.json({ topicId });
  } catch (e) { console.error(e); res.status(500).json({error: e.message}); }
});

// Create token (admin)
app.post('/admin/create-token', async (req, res) => {
  try {
    const { name, symbol } = req.body;
    const tokenId = await createToken({ name, symbol, supplyKeyPublic: null });
    return res.json({ tokenId });
  } catch (e) { console.error(e); res.status(500).json({error: e.message}); }
});

/**
 * PSP deposit callback -> mint tokens and transfer to user
 * body: { depositId, userAccountId, amountFloat, fiatCurrency }
 */
app.post('/deposit/callback', async (req, res) => {
  try {
    if (!verifyWebhook(req)) return res.status(401).json({error: 'invalid signature'});
    const { depositId, userAccountId, amountFloat, fiatCurrency } = req.body;
    // create deposit record
    const ds = toSmallestUnit(amountFloat);
    await Deposit.create({ depositId, userAccountId, amountFloat, amountSmallest: ds, fiatCurrency });

    // 1) mint (assumes supplyPrivateKey is available)
    const mintReceipt = await mint({ tokenId: process.env.TOKEN_ID, amountSmallest: ds, supplyPrivateKeyString: process.env.SUPPLY_KEY_PRIVATE });

    // 2) transfer from treasury to user
    const transferReceipt = await transfer({
      tokenId: process.env.TOKEN_ID,
      fromAccountId: process.env.TREASURY_ACCOUNT_ID,
      fromPrivateKeyString: process.env.TREASURY_PRIVATE_KEY,
      toAccountId: userAccountId,
      amountSmallest: ds
    });

    // 3) HCS log
    const depositHash = `sha256:${crypto.createHash('sha256').update(depositId).digest('hex')}`;
    const hcs = await submitMessage({
      topicId: process.env.HCS_TOPIC_ID,
      payload: { event: "MINT", depositHash, tokenId: process.env.TOKEN_ID, amountSmallest: ds, timestamp: new Date().toISOString() }
    });

    // 4) record transaction
    await Tx.create({ type: 'MINT', tokenId: process.env.TOKEN_ID, amountSmallest: ds, from: process.env.TREASURY_ACCOUNT_ID, to: userAccountId, hederaReceipt: { mint: mintReceipt, transfer: transferReceipt }, hcsSeq: hcs.seq });

    // 5) update deposit
    await Deposit.updateOne({ depositId }, { status: 'COMPLETED', mintedTx: { mintReceipt, transferReceipt } });

    res.json({ status: 'ok', mintReceipt, transferReceipt, hcs });
  } catch (err) {
    console.error('deposit error', err);
    res.status(500).json({ error: 'internal' });
  }
});

/**
 * Redeem endpoint: user requests a fiat payout
 * body: { userAccountId, amountFloat, payoutDetails }
 */
app.post('/redeem', async (req, res) => {
  try {
    const { userAccountId, amountFloat, payoutDetails } = req.body;
    const ds = toSmallestUnit(amountFloat);

    // In production, ensure user transferred tokens to treasury or escrow prior to burn.
    const burnReceipt = await burn({ tokenId: process.env.TOKEN_ID, amountSmallest: ds, supplyPrivateKeyString: process.env.SUPPLY_KEY_PRIVATE });

    const userHash = `sha256:${crypto.createHash('sha256').update(userAccountId).digest('hex')}`;
    const hcs = await submitMessage({ topicId: process.env.HCS_TOPIC_ID, payload: { event: "BURN", userHash, tokenId: process.env.TOKEN_ID, amountSmallest: ds, payoutDetails, timestamp: new Date().toISOString() } });

    await Tx.create({ type: 'BURN', tokenId: process.env.TOKEN_ID, amountSmallest: ds, from: userAccountId, to: process.env.TREASURY_ACCOUNT_ID, hederaReceipt: burnReceipt, hcsSeq: hcs.seq });

    // TODO: trigger fiat payout via PSP here

    res.json({ status: 'ok', burnReceipt, hcs });
  } catch (err) { console.error('redeem err', err); res.status(500).json({ error: 'internal' }); }
});

/**
 * Admin transfer endpoint
 */
app.post('/transfer', async (req, res) => {
  try {
    const { toAccountId, amountFloat } = req.body;
    const ds = toSmallestUnit(amountFloat);
    const transferReceipt = await transfer({
      tokenId: process.env.TOKEN_ID,
      fromAccountId: process.env.TREASURY_ACCOUNT_ID,
      fromPrivateKeyString: process.env.TREASURY_PRIVATE_KEY,
      toAccountId,
      amountSmallest: ds
    });
    const hcs = await submitMessage({ topicId: process.env.HCS_TOPIC_ID, payload: { event: "TRANSFER", tokenId: process.env.TOKEN_ID, toAccountId, amountSmallest: ds, timestamp: new Date().toISOString() } });
    await Tx.create({ type: 'TRANSFER', tokenId: process.env.TOKEN_ID, amountSmallest: ds, from: process.env.TREASURY_ACCOUNT_ID, to: toAccountId, hederaReceipt: transferReceipt, hcsSeq: hcs.seq });
    res.json({ status: 'ok', transferReceipt, hcs });
  } catch (err) { console.error('transfer err', err); res.status(500).json({ error: 'internal' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Afristable backend running on ${PORT}`));
