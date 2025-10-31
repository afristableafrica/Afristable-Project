// mint.js
const {
    TokenMintTransaction,
    AccountId,
    PrivateKey,
} = require("@hashgraph/sdk");
const { getClient } = require("./hederaClient");

/**
 * Mint tokens to issuer/treasury before transferring to user.
 * amount is in smallest units (e.g., decimals=2, so 1.50 NGN => 150)
 */
async function mint({ tokenId, amount, supplyPrivateKeyString }) {
    const client = getClient();
    const supplyKey = PrivateKey.fromString(supplyPrivateKeyString);

    const tx = await new TokenMintTransaction()
        .setTokenId(tokenId)
        .setAmount(amount)
        .freezeWith(client);

    const signed = await tx.sign(supplyKey);
    const submit = await signed.execute(client);
    const receipt = await submit.getReceipt(client);
    client.close();
    console.log("Mint receipt:", receipt.status.toString());
    return receipt;
}

module.exports = { mint };
