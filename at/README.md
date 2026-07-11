# Faucet AT v0

Build and run the tests from the repository root:

```sh
mvn -f at/pom.xml test
```

Print creation bytes (Base58 and hex) for the default 1,000 CHIP grant:

```sh
mvn -f at/pom.xml -Dexec.mainClass=org.qortium.at.casino.FaucetV0 exec:java
```

`FaucetV0.main()` also accepts an optional whole-CHIP grant amount as its first argument.

Deployment must configure `DeployAtTransactionData.assetId` to the issued CHIP asset. The
AT's CHIP balance funds grants; provide and retain a separate `nativeFeeReserve` in native
coin so it can execute even when its working asset is CHIP. See `docs/FAUCET_AT_V0.md` and
`docs/CHIP_ASSET.md` for the deployment and asset parameters.
