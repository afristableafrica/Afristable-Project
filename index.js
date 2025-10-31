const {
    Client,
    PrivateKey,
    AccountCreateTransaction,
    AccountBalanceQuery,
    Hbar,
    TokenCreateTransaction,
    TransferTransaction,
    AccountId,
    TokenType,
    TokenSupplyType,
    TokenAssociateTransaction,
    TokenId
} = require("@hashgraph/sdk");
require("dotenv").config();

async function main() {
    const myAccountId = process.env.MY_ACCOUNT_ID;
    const myPrivateKey = process.env.MY_PRIVATE_KEY;

    if (!myAccountId || !myPrivateKey) {
        throw new Error("Environment variables MY_ACCOUNT_ID and MY_PRIVATE_KEY must be present");
    }

    const client = Client.forTestnet().setOperator(myAccountId, myPrivateKey);

    client.setDefaultMaxTransactionFee(new Hbar(100));
    client.setDefaultMaxQueryPayment(new Hbar(50));

    // Create new keys
    const newAccountPrivateKey = PrivateKey.generateED25519();
    const newAccountPublicKey = newAccountPrivateKey.publicKey;

    // Create a new account
    const newAccount = await new AccountCreateTransaction()
        .setKey(newAccountPublicKey)
        .setInitialBalance(Hbar.fromTinybars(1000))
        .execute(client);

    const getReceipt = await newAccount.getReceipt(client);
    const newAccountId = getReceipt.accountId;
    console.log("✅ New account ID:", newAccountId.toString());

    // Supply key for the token
    const supplyKey = PrivateKey.generate();

    // Create the token
    const tokenCreateTx = new TokenCreateTransaction()
        .setTokenName("Afristable Nigerian Naira")
        .setTokenSymbol("aNGN")
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(2)
        .setInitialSupply(1000000)
        .setTreasuryAccountId(myAccountId)
        .setSupplyType(TokenSupplyType.Infinite)
        .setSupplyKey(supplyKey)
        .freezeWith(client);

    // Sign and submit the token creation
    const tokenCreateSign = await tokenCreateTx.sign(PrivateKey.fromString(myPrivateKey));
    const tokenCreateSubmit = await tokenCreateSign.execute(client);
    const tokenCreateRx = await tokenCreateSubmit.getReceipt(client);
    const tokenId = tokenCreateRx.tokenId;

    console.log("✅ Created token with ID:", tokenId.toString());

    // Associate the new account with the token
    const transaction = await new TokenAssociateTransaction()
        .setAccountId(newAccountId)
        .setTokenIds([tokenId])
        .freezeWith(client);

    const signTx = await transaction.sign(newAccountPrivateKey);
    const txResponse = await signTx.execute(client);
    const associationReceipt = await txResponse.getReceipt(client);
    console.log("✅ Association status:", associationReceipt.status.toString());

    // Transfer tokens
    const transferTx = await new TransferTransaction()
        .addTokenTransfer(tokenId, myAccountId, -10)
        .addTokenTransfer(tokenId, newAccountId, 10)
        .freezeWith(client);

    const signTransferTx = await transferTx.sign(PrivateKey.fromString(myPrivateKey));
    const transferTxResponse = await signTransferTx.execute(client);
    const transferReceipt = await transferTxResponse.getReceipt(client);

    console.log("✅ Transfer status:", transferReceipt.status.toString());

    // Check balances
    const balanceCheckTreasury = await new AccountBalanceQuery()
        .setAccountId(myAccountId)
        .execute(client);

    console.log(`💰 Treasury balance: ${balanceCheckTreasury.tokens.get(tokenId)} units of ${tokenId}`);

    const balanceCheckNewAccount = await new AccountBalanceQuery()
        .setAccountId(newAccountId)
        .execute(client);

    console.log(`💰 New account balance: ${balanceCheckNewAccount.tokens.get(tokenId)} units of ${tokenId}`);
}

main();
