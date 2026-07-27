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

## Launch handoff (do not do this early)

1. Confirm the Casino publisher owns `Casino` and the deployed Faucet V1 is
   live after block 70,000.
2. Update `src/config.js` with the deployed faucet AT address and the actual
   issued SMPL asset ID. Do not guess either value.
3. Run the checks above, inspect the built site, and use the explicit publish
   workflow approved for the publisher account.

`npm run qdn:publish` is deliberately a guard, not an automatic publisher. It
prints the exact identity and refuses unless a future maintainer deliberately
replaces it with an approved, account-specific publishing workflow.

## Product limits made visible by the site

Bronze is an on-chain eligibility requirement once the Faucet V1 change lands;
the UI never pretends its disabled state is the enforcement. Claim-history
lookup is intentionally pending the read-only faucet-status endpoint, so the
site never guesses that someone has already claimed from their SMPL balance.
