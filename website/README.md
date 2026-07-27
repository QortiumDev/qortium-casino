# Qortium Casino — Sample Website

This is a static **WEBSITE** campaign resource, deliberately separate from the
existing casino demos. Its intended QDN identity is fixed for the later
publisher handoff:

| Field | Value |
| --- | --- |
| Service | `WEBSITE` |
| Name | `Casino` |
| Identifier | `Sample` |
| URL | `qdn://WEBSITE/Casino/Sample` |

It is intentionally useful before the faucet exists:

- below Previewnet block 70,000 it displays a block countdown;
- at or above that block without a configured faucet it says that the casino is
  coming very soon;
- only after a publisher sets both values in `src/config.js` will it display the
  Home-mediated claim control.

The site does not hold a key, an API key, or a signing route. In Qortium Home it
uses `qdnRequest` for selected-account details, trust status, node reads, and
the deliberately narrow `SEND_MESSAGE` contract action. In an ordinary browser,
only read-only requests to a local node are attempted; account inspection and
claiming are unavailable.

## Local check

```sh
cd website
npm test
npm run build
```

Open `dist/index.html` from a local static server. Its ordinary-browser
read-only fallback targets `http://127.0.0.1:24891`; Qortium Home uses its
configured node through the bridge instead.

## Publication handoff

1. Keep `src/config.js` unconfigured for the current pre-faucet test publish.
   It will show the countdown now and a candid coming-soon state after block
   70,000. The claim button remains disabled.
2. After the Faucet V1 deploy, update `src/config.js` with the deployed faucet
   AT address and the actual
   issued SMPL asset ID. Do not guess either value.
3. From a clean, reviewed `main` checkout, run the checks above and then:

   ```sh
   QORTIUM_CASINO_ALLOW_PUBLISH=1 npm run qdn:publish
   ```

   The publisher reads the local Casino treasury environment, verifies the
   synced node and the `Casino` owner, registers that name if necessary, and
   waits for `qdn://WEBSITE/Casino/Sample` to reach `READY`. It refuses dirty
   or non-`main` source and never publishes without the explicit arm variable.

The test publication does not wait for the faucet. A later configured publish
replaces the same `WEBSITE/Casino/Sample` resource after the deployed values
and Core status endpoint are available.

## Product limits made visible by the site

Bronze is an on-chain eligibility requirement once the Faucet V1 change lands;
the UI never pretends its disabled state is the enforcement. Once Core exposes
the read-only AT map-value endpoint, it derives the faucet's exact claim key
for the selected address and reports whether that account has already claimed.
