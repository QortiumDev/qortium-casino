const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_SYMBOLS = ["\u2660", "\u2665", "\u2666", "\u2663"];
const SUIT_NAMES = ["Spades", "Hearts", "Diamonds", "Clubs"];
const FACE_RANKS = new Set(["J", "Q", "K"]);
const PIP_LAYOUTS = {
  A: [
    { row: 3, col: 2 },
  ],
  "2": [
    { row: 1, col: 2 },
    { row: 5, col: 2, down: true },
  ],
  "3": [
    { row: 1, col: 2 },
    { row: 3, col: 2 },
    { row: 5, col: 2, down: true },
  ],
  "4": [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
    { row: 5, col: 1, down: true },
    { row: 5, col: 3, down: true },
  ],
  "5": [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
    { row: 3, col: 2 },
    { row: 5, col: 1, down: true },
    { row: 5, col: 3, down: true },
  ],
  "6": [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
    { row: 3, col: 1 },
    { row: 3, col: 3 },
    { row: 5, col: 1, down: true },
    { row: 5, col: 3, down: true },
  ],
  "7": [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
    { row: 2, col: 2 },
    { row: 3, col: 1 },
    { row: 3, col: 3 },
    { row: 5, col: 1, down: true },
    { row: 5, col: 3, down: true },
  ],
  "8": [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
    { row: 2, col: 2 },
    { row: 3, col: 1 },
    { row: 3, col: 3 },
    { row: 4, col: 2, down: true },
    { row: 5, col: 1, down: true },
    { row: 5, col: 3, down: true },
  ],
  "9": [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
    { row: 2, col: 2 },
    { row: 3, col: 1 },
    { row: 3, col: 2 },
    { row: 3, col: 3 },
    { row: 4, col: 2, down: true },
    { row: 5, col: 1, down: true },
    { row: 5, col: 3, down: true },
  ],
  "10": [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
    { row: 2, col: 1 },
    { row: 2, col: 3 },
    { row: 3, col: 1 },
    { row: 3, col: 3 },
    { row: 4, col: 1, down: true },
    { row: 4, col: 3, down: true },
    { row: 5, col: 1, down: true },
    { row: 5, col: 3, down: true },
  ],
};

const DOMAIN_TAG = "blackjack-draw-v1";
const MAX_REJECTION_ATTEMPTS = 24;
const MAX_TRACE_ROWS = 80;

const ATOMS_PER_QORT = 100_000_000;
const DEFAULT_BET_ATOMS = 1 * ATOMS_PER_QORT;
const STARTING_CREDITS_ATOMS = 25 * ATOMS_PER_QORT;

const txSeedInput = document.getElementById("tx-seed-input");
const autoSeedToggle = document.getElementById("auto-seed-toggle");
const generateSeedBtn = document.getElementById("generate-seed-btn");
const clearSeedBtn = document.getElementById("clear-seed-btn");
const seedStatusEl = document.getElementById("seed-status");

const creditsEl = document.getElementById("credits-value");
const handsEl = document.getElementById("hands-value");
const winsEl = document.getElementById("wins-value");
const lossesEl = document.getElementById("losses-value");
const pushesEl = document.getElementById("pushes-value");
const wageredEl = document.getElementById("wagered-value");
const paidEl = document.getElementById("paid-value");
const returnEl = document.getElementById("return-value");

const handStatusEl = document.getElementById("hand-status");
const handResultLineEl = document.getElementById("hand-result-line");

const dealBtn = document.getElementById("deal-btn");
const hitBtn = document.getElementById("hit-btn");
const standBtn = document.getElementById("stand-btn");
const resetSessionBtn = document.getElementById("reset-session-btn");

const dealerCardsEl = document.getElementById("dealer-cards");
const playerCardsEl = document.getElementById("player-cards");
const dealerTotalEl = document.getElementById("dealer-total");
const playerTotalEl = document.getElementById("player-total");

const traceBody = document.getElementById("trace-body");

let creditsAtoms = STARTING_CREDITS_ATOMS;
let totalHands = 0;
let totalWins = 0;
let totalLosses = 0;
let totalPushes = 0;
let totalWageredAtoms = 0;
let totalPaidAtoms = 0;

let nextHandId = 1;
let currentHand = null;
let isBusy = false;
let seedStatusTicket = 0;

const traceEntries = [];

init();

function init() {
  bindEvents();
  generateDemoSeed("initial");
  updateSessionView();
  renderHand();
  renderTrace();
  updateControls();
}

function bindEvents() {
  generateSeedBtn.addEventListener("click", () => {
    generateDemoSeed("manual");
  });

  clearSeedBtn.addEventListener("click", () => {
    txSeedInput.value = "";
    setSeedStatus("Seed cleared.", "warn");
  });

  txSeedInput.addEventListener("input", () => {
    updateSeedStatusFromInput();
  });

  autoSeedToggle.addEventListener("change", () => {
    if (autoSeedToggle.checked) {
      setSeedStatus("Auto mode on. A fresh tx-like payload will be generated per action.", "warn");
    } else {
      updateSeedStatusFromInput();
    }
  });

  dealBtn.addEventListener("click", () => {
    dealHand();
  });

  hitBtn.addEventListener("click", () => {
    playerHit();
  });

  standBtn.addEventListener("click", () => {
    playerStand();
  });

  resetSessionBtn.addEventListener("click", () => {
    if (isBusy) {
      return;
    }

    resetSession();
  });
}

function generateDemoSeed(action) {
  const payload = {
    version: 1,
    game: "blackjack-demo",
    action,
    pseudoTxSignature: randomHex(64),
    reference: randomHex(32),
    timestamp: Date.now(),
    playerAddress: "QDEMO_PLAYER_ADDR",
    tableAddress: "QDEMO_BLACKJACK_TABLE",
    amountAtoms: DEFAULT_BET_ATOMS,
  };

  txSeedInput.value = JSON.stringify(payload, null, 2);
  updateSeedStatusFromInput();
}

async function updateSeedStatusFromInput() {
  const ticket = ++seedStatusTicket;
  const seedValue = readSeedInput();

  if (seedValue.length === 0) {
    setSeedStatus("Seed not set yet.", "warn");
    return;
  }

  try {
    const txHashHex = await sha256Hex(seedValue);
    if (ticket !== seedStatusTicket) {
      return;
    }

    setSeedStatus(
      `Seed hash ${shorten(txHashHex, 20)}. Same seed + actions => same draw sequence.`,
      "ok"
    );
  } catch (error) {
    setSeedStatus(`Unable to hash seed: ${error.message}`, "bad");
  }
}

async function dealHand() {
  if (isBusy) {
    return;
  }

  if (currentHand && currentHand.phase !== "settled") {
    setHandResult("Finish the current hand before dealing a new one.", "bad");
    return;
  }

  if (creditsAtoms < DEFAULT_BET_ATOMS) {
    setHandResult("Not enough credits to deal 1 QORT.", "bad");
    return;
  }

  isBusy = true;
  updateControls();

  let wagerDebited = false;

  try {
    currentHand = {
      id: nextHandId,
      phase: "dealing",
      betAtoms: DEFAULT_BET_ATOMS,
      playerNaturalBlackjack: false,
      deck: freshDeck(),
      remaining: 52,
      drawCounter: 0,
      playerCards: [],
      dealerCards: [],
    };

    nextHandId += 1;

    setHandStatus(`Hand #${currentHand.id} dealing. Bet: ${formatQort(currentHand.betAtoms)}.`);

    const actionSeed = await getActionSeed(`deal-hand-${currentHand.id}`);

    creditsAtoms -= DEFAULT_BET_ATOMS;
    totalWageredAtoms += DEFAULT_BET_ATOMS;
    wagerDebited = true;

    await dealCardTo(currentHand, "player", "deal-player-1", actionSeed, true);
    await dealCardTo(currentHand, "dealer", "deal-dealer-1", actionSeed, true);
    await dealCardTo(currentHand, "player", "deal-player-2", actionSeed, true);

    const playerEval = evaluateHand(currentHand.playerCards);
    currentHand.playerNaturalBlackjack = playerEval.blackjack;

    if (playerEval.blackjack) {
      await resolveDealerTurn(currentHand, `auto-natural-hand-${currentHand.id}`);
    } else {
      currentHand.phase = "player_turn";
      setHandResult("Hand dealt. Choose Hit or Stand.", "warn");
      setHandStatus(`Hand #${currentHand.id} active.`);
    }

    updateSessionView();
    renderHand();
  } catch (error) {
    if (wagerDebited) {
      creditsAtoms += DEFAULT_BET_ATOMS;
      totalWageredAtoms -= DEFAULT_BET_ATOMS;
      updateSessionView();
    }

    currentHand = null;
    renderHand();
    setHandStatus("Ready for next hand.");

    setHandResult(`Deal failed: ${error.message}`, "bad");
  } finally {
    isBusy = false;
    updateControls();
  }
}

async function playerHit() {
  if (!canPlayerAct()) {
    return;
  }

  isBusy = true;
  updateControls();

  try {
    const hand = currentHand;
    const actionSeed = await getActionSeed(`hit-hand-${hand.id}-draw-${hand.drawCounter + 1}`);

    await dealCardTo(hand, "player", "player-hit", actionSeed, true);

    const playerEval = evaluateHand(hand.playerCards);
    if (playerEval.bust) {
      settleHand(hand, "loss", `Player busts at ${playerEval.total}. Dealer wins.`);
    } else if (playerEval.total === 21) {
      await resolveDealerTurn(hand, `auto-stand-hand-${hand.id}-from-21`);
    } else {
      hand.phase = "player_turn";
      setHandResult(`Player total ${formatHandTotal(playerEval)}. Hit or Stand.`, "warn");
      setHandStatus(`Hand #${hand.id} active.`);
    }

    updateSessionView();
    renderHand();
  } catch (error) {
    if (currentHand && currentHand.phase === "dealer_turn") {
      currentHand.phase = "player_turn";
      renderHand();
      setHandStatus(`Hand #${currentHand.id} active.`);
    }

    setHandResult(`Hit failed: ${error.message}`, "bad");
  } finally {
    isBusy = false;
    updateControls();
  }
}

async function playerStand() {
  if (!canPlayerAct()) {
    return;
  }

  isBusy = true;
  updateControls();

  try {
    await resolveDealerTurn(currentHand, `stand-hand-${currentHand.id}`);
    updateSessionView();
    renderHand();
  } catch (error) {
    if (currentHand && currentHand.phase === "dealer_turn") {
      currentHand.phase = "player_turn";
      renderHand();
      setHandStatus(`Hand #${currentHand.id} active.`);
    }

    setHandResult(`Stand failed: ${error.message}`, "bad");
  } finally {
    isBusy = false;
    updateControls();
  }
}

async function resolveDealerTurn(hand, actionTag) {
  hand.phase = "dealer_turn";
  setHandStatus(`Hand #${hand.id} dealer turn.`);
  renderHand();

  const actionSeed = await getActionSeed(actionTag);

  if (hand.dealerCards.length < 2) {
    await dealCardTo(hand, "dealer", "deal-dealer-2", actionSeed, true);
  }

  let dealerEval = evaluateHand(hand.dealerCards);

  if (dealerEval.blackjack || hand.playerNaturalBlackjack) {
    if (dealerEval.blackjack && hand.playerNaturalBlackjack) {
      settleHand(hand, "push", "Both player and dealer have blackjack.");
      return;
    }

    if (dealerEval.blackjack) {
      settleHand(hand, "loss", "Dealer blackjack.");
      return;
    }

    settleHand(hand, "blackjack", "Player blackjack pays 3:2.");
    return;
  }

  while (dealerEval.total < 17) {
    await dealCardTo(hand, "dealer", "dealer-hit", actionSeed, true);
    dealerEval = evaluateHand(hand.dealerCards);
  }

  const playerEval = evaluateHand(hand.playerCards);

  if (dealerEval.bust) {
    settleHand(hand, "win", `Dealer busts at ${dealerEval.total}. Player wins.`);
    return;
  }

  if (dealerEval.total > playerEval.total) {
    settleHand(hand, "loss", `Dealer ${dealerEval.total} beats player ${playerEval.total}.`);
    return;
  }

  if (dealerEval.total < playerEval.total) {
    settleHand(hand, "win", `Player ${playerEval.total} beats dealer ${dealerEval.total}.`);
    return;
  }

  settleHand(hand, "push", `Push at ${playerEval.total}.`);
}

function settleHand(hand, outcome, message) {
  let payoutAtoms = 0;
  let tone = "warn";

  if (outcome === "win") {
    payoutAtoms = hand.betAtoms * 2;
    totalWins += 1;
    tone = "ok";
  } else if (outcome === "blackjack") {
    payoutAtoms = Math.floor((hand.betAtoms * 5) / 2);
    totalWins += 1;
    tone = "ok";
  } else if (outcome === "push") {
    payoutAtoms = hand.betAtoms;
    totalPushes += 1;
    tone = "warn";
  } else {
    totalLosses += 1;
    tone = "bad";
  }

  creditsAtoms += payoutAtoms;
  totalPaidAtoms += payoutAtoms;
  totalHands += 1;

  hand.phase = "settled";

  setHandStatus(`Hand #${hand.id} settled.`);
  setHandResult(`${message} Payout: ${formatQort(payoutAtoms)}.`, tone);
}

async function dealCardTo(hand, recipient, drawTag, actionSeed, animate = false) {
  const cardId = await drawCardFromDeck(hand, drawTag, actionSeed);

  if (recipient === "player") {
    hand.playerCards.push(cardId);
  } else {
    hand.dealerCards.push(cardId);
  }

  renderHand();

  if (animate) {
    await sleep(120);
  }
}

async function drawCardFromDeck(hand, drawTag, actionSeed) {
  if (hand.remaining <= 0) {
    throw new Error("deck exhausted");
  }

  const remainingBefore = hand.remaining;
  const drawNo = hand.drawCounter + 1;

  const pick = await selectDeckIndex({
    handId: hand.id,
    drawNo,
    drawTag,
    remaining: remainingBefore,
    txSeed: actionSeed.seedRaw,
  });

  const tailIndex = remainingBefore - 1;
  const chosenCard = hand.deck[pick.index];

  hand.deck[pick.index] = hand.deck[tailIndex];
  hand.deck[tailIndex] = chosenCard;

  hand.remaining -= 1;
  hand.drawCounter += 1;

  traceEntries.unshift({
    handId: hand.id,
    drawNo,
    action: drawTag,
    txHash: actionSeed.txHashHex,
    pickIndex: pick.index,
    remainingBefore,
    card: cardLabel(chosenCard),
  });

  if (traceEntries.length > MAX_TRACE_ROWS) {
    traceEntries.length = MAX_TRACE_ROWS;
  }

  renderTrace();

  return chosenCard;
}

async function selectDeckIndex({ handId, drawNo, drawTag, remaining, txSeed }) {
  const modulus = BigInt(remaining);
  const space = 1n << 64n;
  const acceptanceLimit = space - (space % modulus);
  let candidate = 0n;

  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt += 1) {
    const payload = `${DOMAIN_TAG}|hand=${handId}|draw=${drawNo}|tag=${drawTag}|remaining=${remaining}|tx=${txSeed}|attempt=${attempt}`;
    const digest = await sha256Utf8(payload);
    candidate = readBigUint64BE(digest, 24);

    if (candidate < acceptanceLimit) {
      return {
        index: Number(candidate % modulus),
      };
    }
  }

  return {
    index: Number(candidate % modulus),
  };
}

async function getActionSeed(actionTag) {
  if (autoSeedToggle.checked || readSeedInput().length === 0) {
    generateDemoSeed(actionTag);
  }

  const seedRaw = readSeedInput();
  if (seedRaw.length === 0) {
    throw new Error("seed payload is empty");
  }

  const txHashHex = await sha256Hex(seedRaw);
  return {
    seedRaw,
    txHashHex,
  };
}

function readSeedInput() {
  return txSeedInput.value.trim();
}

function canPlayerAct() {
  return !isBusy && currentHand !== null && currentHand.phase === "player_turn";
}

function resetSession() {
  creditsAtoms = STARTING_CREDITS_ATOMS;
  totalHands = 0;
  totalWins = 0;
  totalLosses = 0;
  totalPushes = 0;
  totalWageredAtoms = 0;
  totalPaidAtoms = 0;

  nextHandId = 1;
  currentHand = null;
  traceEntries.length = 0;

  updateSessionView();
  renderHand();
  renderTrace();
  updateControls();

  setHandStatus("Session reset. Ready for next hand.");
  setHandResult("No hand active.", "warn");
}

function updateSessionView() {
  creditsEl.textContent = formatQort(creditsAtoms);
  handsEl.textContent = String(totalHands);
  winsEl.textContent = String(totalWins);
  lossesEl.textContent = String(totalLosses);
  pushesEl.textContent = String(totalPushes);
  wageredEl.textContent = formatQort(totalWageredAtoms);
  paidEl.textContent = formatQort(totalPaidAtoms);

  const returnPercent = totalWageredAtoms > 0
    ? (totalPaidAtoms / totalWageredAtoms) * 100
    : 0;

  returnEl.textContent = `${returnPercent.toFixed(2)}%`;
}

function updateControls() {
  const activeHand = currentHand && currentHand.phase !== "settled";
  const playerTurn = currentHand && currentHand.phase === "player_turn";

  dealBtn.disabled = isBusy || activeHand || creditsAtoms < DEFAULT_BET_ATOMS;
  hitBtn.disabled = isBusy || !playerTurn;
  standBtn.disabled = isBusy || !playerTurn;
  resetSessionBtn.disabled = isBusy;
}

function renderHand() {
  if (currentHand === null) {
    dealerCardsEl.innerHTML = '<span class="card-chip card-chip-empty">No cards</span>';
    playerCardsEl.innerHTML = '<span class="card-chip card-chip-empty">No cards</span>';
    dealerTotalEl.textContent = "Total: -";
    playerTotalEl.textContent = "Total: -";
    return;
  }

  const hideDealerHole = currentHand.phase === "player_turn";

  dealerCardsEl.innerHTML = renderCards(currentHand.dealerCards, hideDealerHole);
  playerCardsEl.innerHTML = renderCards(currentHand.playerCards, false);

  const playerEval = evaluateHand(currentHand.playerCards);
  playerTotalEl.textContent = `Total: ${formatHandTotal(playerEval)}`;

  if (hideDealerHole && currentHand.dealerCards.length >= 1) {
    const upCardEval = evaluateHand([currentHand.dealerCards[0]]);
    dealerTotalEl.textContent = `Total: ${upCardEval.total} + ?`;
  } else {
    const dealerEval = evaluateHand(currentHand.dealerCards);
    dealerTotalEl.textContent = `Total: ${formatHandTotal(dealerEval)}`;
  }
}

function renderCards(cards, hideSecondCard) {
  if (cards.length === 0) {
    return '<span class="card-chip card-chip-empty">No cards</span>';
  }

  return cards
    .map((cardId, index) => {
      if (hideSecondCard && index === 1) {
        return '<span class="card-chip card-chip-hidden">??</span>';
      }

      return renderCardChip(cardId);
    })
    .join("");
}

function renderCardChip(cardId) {
  const view = cardView(cardId);
  return `<span class="card-chip ${view.toneClass}" aria-label="${view.rankLabel} of ${view.suitName}">
    <span class="card-corner card-corner-top">
      <span class="card-corner-rank">${view.rankLabel}</span>
      <span class="card-corner-suit" aria-hidden="true">${view.suitSymbol}</span>
    </span>
    <span class="card-corner card-corner-bottom">
      <span class="card-corner-rank">${view.rankLabel}</span>
      <span class="card-corner-suit" aria-hidden="true">${view.suitSymbol}</span>
    </span>
    ${renderCardCenter(view)}
  </span>`;
}

function renderCardCenter(view) {
  if (view.isFaceCard) {
    return `<span class="card-face-center" aria-hidden="true">
      <span class="card-face-rank">${view.rankLabel}</span>
    </span>`;
  }

  const pips = PIP_LAYOUTS[view.rankLabel] || [];
  const pipMarkup = pips
    .map((pip) => {
      const downClass = pip.down ? " card-pip-down" : "";
      return `<span class="card-pip${downClass}" style="grid-row:${pip.row};grid-column:${pip.col};" aria-hidden="true">${view.suitSymbol}</span>`;
    })
    .join("");

  return `<span class="card-pips">${pipMarkup}</span>`;
}

function renderTrace() {
  if (traceEntries.length === 0) {
    traceBody.innerHTML = '<tr><td colspan="6" class="muted">No draws yet.</td></tr>';
    return;
  }

  traceBody.innerHTML = traceEntries
    .map((entry) => {
      return `<tr>
        <td class="mono">#${entry.handId}</td>
        <td class="mono">${entry.drawNo}</td>
        <td>${entry.action}</td>
        <td class="mono">${shorten(entry.txHash, 12)}</td>
        <td class="mono">${entry.pickIndex}/${entry.remainingBefore}</td>
        <td>${entry.card}</td>
      </tr>`;
    })
    .join("");
}

function evaluateHand(cards) {
  let total = 0;
  let acesAsEleven = 0;

  for (const cardId of cards) {
    const rank = cardId % 13;

    if (rank === 0) {
      total += 11;
      acesAsEleven += 1;
      continue;
    }

    if (rank >= 10) {
      total += 10;
      continue;
    }

    total += rank + 1;
  }

  while (total > 21 && acesAsEleven > 0) {
    total -= 10;
    acesAsEleven -= 1;
  }

  return {
    total,
    soft: acesAsEleven > 0,
    blackjack: cards.length === 2 && total === 21,
    bust: total > 21,
  };
}

function freshDeck() {
  return Array.from({ length: 52 }, (_, index) => index);
}

function cardLabel(cardId) {
  const view = cardView(cardId);
  return `${view.rankLabel}${view.suitSymbol}`;
}

function cardView(cardId) {
  const rank = cardId % 13;
  const suit = Math.floor(cardId / 13);
  const rankLabel = RANK_LABELS[rank];
  const isRedSuit = suit === 1 || suit === 2;

  return {
    rankLabel,
    suitSymbol: SUIT_SYMBOLS[suit],
    suitName: SUIT_NAMES[suit],
    toneClass: isRedSuit ? "card-chip-red" : "card-chip-black",
    isFaceCard: FACE_RANKS.has(rankLabel),
  };
}

function formatHandTotal(handEval) {
  if (handEval.bust) {
    return `${handEval.total} (bust)`;
  }

  if (handEval.soft && handEval.total !== 21) {
    return `${handEval.total} (soft)`;
  }

  return String(handEval.total);
}

function setSeedStatus(message, tone) {
  seedStatusEl.textContent = message;
  seedStatusEl.classList.remove("ok", "bad", "warn");
  seedStatusEl.classList.add(tone);
}

function setHandResult(message, tone) {
  handResultLineEl.textContent = message;
  handResultLineEl.classList.remove("ok", "bad", "warn");
  handResultLineEl.classList.add(tone);
}

function setHandStatus(message) {
  handStatusEl.textContent = message;
}

function formatQort(atoms) {
  return `${(atoms / ATOMS_PER_QORT).toFixed(2)} QORT`;
}

function shorten(value, visibleChars) {
  if (value.length <= visibleChars) {
    return value;
  }

  return `${value.slice(0, visibleChars)}...`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(input) {
  const digest = await sha256Utf8(input);
  return bytesToHex(digest);
}

async function sha256Utf8(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function readBigUint64BE(bytes, offset) {
  let value = 0n;

  for (let i = 0; i < 8; i += 1) {
    value = (value << 8n) + BigInt(bytes[offset + i]);
  }

  return value;
}
