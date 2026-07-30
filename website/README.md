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

It is intentionally useful before the faucet can act:

- below Previewnet block 80,000 (`atNoNativeAssetFeeWaiverHeight`, the Core
  1.6.2 step-fee waiver trigger) it displays a re-opening countdown — the
  Faucet V1 AT is already deployed and prefunded, but cannot execute a step
  before that height because step fees were priced in the chain's absent
  native asset;
- at or above that block, with the deployed faucet configured in
  `src/config.js`, it displays the Home-mediated claim control;
- if the config were ever cleared, it would fall back to a candid
  coming-soon state instead of guessing.

The original opening was block 70,000; the site's Official Notice of
Rescheduling tells that story truthfully.

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

1. `src/config.js` now carries the deployed values: Faucet V1 at
   `AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WD` (confirmed at block 73,375) and SMPL
   asset ID 3. Both were read from the confirmed `DEPLOY_AT` transaction —
   never change them without matching redeploy evidence.
2. The claim button stays disabled below block 80,000, so no claim MESSAGE
   is queued against the step-locked AT before the waiver activates.
3. From a clean, reviewed `main` checkout, run the checks above and then:

   ```sh
   QORTIUM_CASINO_ALLOW_PUBLISH=1 npm run qdn:publish
   ```

   The publisher reads the local Casino treasury environment, verifies the
   synced node and the `Casino` owner, registers that name if necessary, and
   waits for `qdn://WEBSITE/Casino/Sample` to reach `READY`. It refuses dirty
   or non-`main` source and never publishes without the explicit arm variable.

A configured publish replaces the same `WEBSITE/Casino/Sample` resource that
the earlier unconfigured test publish created.

## Product limits made visible by the site

Bronze is an on-chain eligibility requirement enforced by the deployed Faucet
V1 contract; the UI never pretends its disabled state is the enforcement.
Using Core's read-only AT map-value endpoint (`/at/{address}/map/value`,
available since 1.6.2), it derives the faucet's exact claim key for the
selected address and reports whether that account has already claimed.
