// burn.js
const {
    TokenBurnTransaction,
    PrivateKey,
} = require("@hashgraph/sdk");
const { getClient } = require("./hederaClient");

/**
 * Burn tokens from treasury or user (requires appropriate key)
 * amount: smallest units
 */
async function burn({ tokenId, amount, supplyPrivateKeyString }) {
    const client = getClient();
    const supplyKey = PrivateKey.fromString(supplyPrivateKeyString);

    const tx = await new TokenBurnTransaction()
        .setTokenId(tokenId)
        .setAmount(amount)
        .freezeWith(client);

    const signed = await tx.sign(supplyKey);
    const submit = await signed.execute(client);
    const receipt = await submit.getReceipt(client);
    client.close();
    console.log("Burn status:", receipt.status.toString());
    return receipt;
}

module.exports = { burn };
