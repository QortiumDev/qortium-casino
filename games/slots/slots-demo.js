const SYMBOL_ORDER = [
  "BLANK",
  "CHERRY",
  "LEMON",
  "ORANGE",
  "PLUM",
  "BELL",
  "BAR",
  "DOUBLE_BAR",
  "TRIPLE_BAR",
  "SEVEN",
];

const REEL_COUNTS = [
  {
    BLANK: 6,
    CHERRY: 4,
    LEMON: 3,
    ORANGE: 3,
    PLUM: 2,
    BELL: 2,
    BAR: 1,
    DOUBLE_BAR: 1,
    TRIPLE_BAR: 1,
    SEVEN: 1,
  },
  {
    BLANK: 7,
    CHERRY: 3,
    LEMON: 3,
    ORANGE: 3,
    PLUM: 2,
    BELL: 2,
    BAR: 1,
    DOUBLE_BAR: 1,
    TRIPLE_BAR: 1,
    SEVEN: 1,
  },
  {
    BLANK: 8,
    CHERRY: 3,
    LEMON: 3,
    ORANGE: 2,
    PLUM: 2,
    BELL: 2,
    BAR: 1,
    DOUBLE_BAR: 1,
    TRIPLE_BAR: 1,
    SEVEN: 1,
  },
];

const PAYTABLE_ORDER = [
  { code: "SEVEN3", label: "SEVEN SEVEN SEVEN", multiplier: 2000 },
  { code: "TRIPLE_BAR3", label: "TRIPLE_BAR TRIPLE_BAR TRIPLE_BAR", multiplier: 1000 },
  { code: "DOUBLE_BAR3", label: "DOUBLE_BAR DOUBLE_BAR DOUBLE_BAR", multiplier: 500 },
  { code: "BAR3", label: "BAR BAR BAR", multiplier: 250 },
  { code: "ANY_BAR3", label: "Any BAR Any BAR Any BAR", multiplier: 30 },
  { code: "BELL3", label: "BELL BELL BELL", multiplier: 40 },
  { code: "PLUM3", label: "PLUM PLUM PLUM", multiplier: 30 },
  { code: "ORANGE3", label: "ORANGE ORANGE ORANGE", multiplier: 20 },
  { code: "LEMON3", label: "LEMON LEMON LEMON", multiplier: 16 },
  { code: "CHERRY3", label: "CHERRY CHERRY CHERRY", multiplier: 70 },
  { code: "CHERRY2", label: "CHERRY CHERRY Any", multiplier: 9 },
  { code: "CHERRY1", label: "CHERRY Any Any", multiplier: 1 },
];

const PAYTABLE_MAP = new Map(PAYTABLE_ORDER.map((item) => [item.code, item]));

const AUTO_REFRESH_MS = 15_000;

const STARTING_WALLET_CREDITS = 3000;
const STARTING_MACHINE_BALANCE = 20000;
const PAYOUT_FEE_RESERVE = 5;

const MIN_BET = 1;
const MAX_BET = 100;
const BET_STEP = 1;

const SESSION_INACTIVITY_BLOCKS = 8;
const ENTROPY_CONFIRM_DEPTH_K = 2;
const PENDING_QUEUE_CAPACITY = 4;

const MAX_PAYOUT_MULTIPLIER = PAYTABLE_ORDER[0].multiplier;
const DOMAIN_TAG = "slot3-hybrid-v1";
const MAX_SETTLED_PULL_ROWS = 80;

const apiBaseInput = document.getElementById("api-base-input");
const syncTipBtn = document.getElementById("sync-tip-btn");
const clearBaseBtn = document.getElementById("clear-base-btn");
const autoRefreshToggle = document.getElementById("auto-refresh-toggle");
const slotStatusEl = document.getElementById("slot-status");

const tipHeightEl = document.getElementById("tip-height");
const tipTimeEl = document.getElementById("tip-time");
const tipSignatureEl = document.getElementById("tip-signature");
const machineStatusEl = document.getElementById("machine-status");

const walletEl = document.getElementById("wallet-value");
const sessionCreditEl = document.getElementById("session-credit-value");
const atBalanceEl = document.getElementById("at-balance-value");
const houseOwnedEl = document.getElementById("house-owned-value");
const safeHouseEl = document.getElementById("safe-house-value");
const effectiveMaxBetEl = document.getElementById("effective-max-bet-value");
const queueSizeEl = document.getElementById("queue-size-value");
const deadlineEl = document.getElementById("deadline-value");
const settlementStateEl = document.getElementById("settlement-state-value");
const anchorTxEl = document.getElementById("anchor-tx-value");
const anchorReadyEl = document.getElementById("anchor-ready-value");
const anchorSecondCallEl = document.getElementById("anchor-second-call-value");
const pullsEl = document.getElementById("pulls-value");
const wageredEl = document.getElementById("wagered-value");
const paidEl = document.getElementById("paid-value");
const returnEl = document.getElementById("return-value");

const loadBtn = document.getElementById("load-demo-btn");
const paymentInput = document.getElementById("payment-input");
const betInput = document.getElementById("bet-input");
const fundBtn = document.getElementById("fund-btn");
const pullBtn = document.getElementById("pull-btn");
const cashoutBtn = document.getElementById("cashout-btn");
const resetBtn = document.getElementById("reset-btn");
const resultLineEl = document.getElementById("result-line");

const txLogBody = document.getElementById("tx-log-body");
const pullHistoryBody = document.getElementById("pull-history-body");

const reelColumns = Array.from(document.querySelectorAll(".reel-column"));

let loaded = false;
let refreshing = false;
let autoRefreshTimer = null;

let latestTipHeight = null;
let latestTipTimestamp = null;
let latestTipSignature = "";

let nextTxId = 1;

const blockCache = new Map();
const txLog = [];
const settledPullHistory = [];

const reels = REEL_COUNTS.map((counts, reelIndex) => makeReelStrip(counts, reelIndex + 11));
const reelStops = [0, 0, 0];

const machine = {
  walletBalance: STARTING_WALLET_CREDITS,
  machineBalance: STARTING_MACHINE_BALANCE,
  sessionActive: false,
  sessionCredit: 0,
  sessionDeadlineHeight: null,
  sessionPullNonce: 0,
  pendingCashoutFlag: false,

  pendingPulls: [],
  pendingQueueOverflowCount: 0,

  settlementState: "idle",
  anchor: null,
  epochCounter: 0,
  currentEpochSeed64: null,

  totalDeposited: 0,
  totalCashout: 0,
  totalSpins: 0,
  totalWagered: 0,
  totalPaid: 0,
  totalIgnoredPayments: 0,
  totalIgnoredMessages: 0,

  lastBet: 0,
  lastWinCredit: 0,
  lastOutcomeCode: "-",
  lastReelStops: [0, 0, 0],
};

init();

function init() {
  renderReelCountTable();
  renderPaytable();
  reelStops.forEach((stop, index) => renderReel(index, stop, false));

  bindEvents();
  setAutoRefresh(autoRefreshToggle.checked);

  updateTipSummary();
  renderAll();
}

function bindEvents() {
  loadBtn.addEventListener("click", () => {
    loaded = true;
    loadBtn.disabled = true;
    loadBtn.textContent = "Loaded";
    document.getElementById("machine-demo").classList.add("machine-selected");

    machineStatusEl.textContent = "Demo machine loaded. Sync tip and submit local txs.";
    machineStatusEl.classList.remove("muted");

    setResult("Machine loaded. Submit PAYMENT to start a session.", "warn");
    updateControls();
    syncTip({ source: "load" });
  });

  syncTipBtn.addEventListener("click", () => {
    syncTip({ source: "manual" });
  });

  clearBaseBtn.addEventListener("click", () => {
    apiBaseInput.value = "";
    setStatus("Using relative API path: /blocks", "warn");
    syncTip({ source: "manual" });
  });

  autoRefreshToggle.addEventListener("change", () => {
    setAutoRefresh(autoRefreshToggle.checked);
  });

  apiBaseInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    syncTip({ source: "manual" });
  });

  fundBtn.addEventListener("click", () => {
    submitPaymentTx();
  });

  pullBtn.addEventListener("click", () => {
    submitPullTx();
  });

  cashoutBtn.addEventListener("click", () => {
    submitCashoutTx();
  });

  resetBtn.addEventListener("click", () => {
    resetSimulation();
  });

  paymentInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitPaymentTx();
  });

  betInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitPullTx();
  });
}

function setAutoRefresh(enabled) {
  if (autoRefreshTimer !== null) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (!enabled) {
    return;
  }

  autoRefreshTimer = setInterval(() => {
    syncTip({ source: "auto" });
  }, AUTO_REFRESH_MS);
}

async function syncTip({ source = "manual" } = {}) {
  if (refreshing) {
    return;
  }

  refreshing = true;
  syncTipBtn.disabled = true;
  setStatus("Fetching latest tip...", "warn");

  try {
    const latestBlock = await fetchLatestBlock();
    const tipHeight = Number(latestBlock.height);
    const tipTimestamp = Number(latestBlock.timestamp);
    const tipSignature = String(latestBlock.signature || "").trim();

    if (!Number.isFinite(tipHeight)) {
      throw new Error("latest block did not include numeric height");
    }

    const previousTip = latestTipHeight;

    latestTipHeight = tipHeight;
    latestTipTimestamp = Number.isFinite(tipTimestamp) ? tipTimestamp : null;
    latestTipSignature = tipSignature;

    cacheBlock(latestBlock);

    if (loaded && (previousTip === null || tipHeight > previousTip)) {
      await processTipAdvance(tipHeight);
      setStatus(
        `Tip #${tipHeight} synced${source === "auto" ? " (auto)" : ""}.`,
        "ok"
      );
    } else if (loaded) {
      setStatus(`Tip unchanged at #${tipHeight}.`, "warn");
    } else {
      setStatus(`Tip #${tipHeight} available. Load machine to start.`, "warn");
    }

    updateTipSummary();
    renderAll();
  } catch (error) {
    setStatus(`Unable to fetch tip: ${error.message}`, "bad");
  } finally {
    refreshing = false;
    syncTipBtn.disabled = false;
    updateControls();
  }
}

async function processTipAdvance(tipHeight) {
  confirmMempoolTransactions(tipHeight);
  processConfirmedTransactions(tipHeight);
  await advancePendingSettlement(tipHeight);
  applyInactivityTimeout(tipHeight);

  if (machine.pendingCashoutFlag && machine.pendingPulls.length === 0 && machine.sessionActive) {
    executeCashout("cashout_after_queue_drain", tipHeight);
  }
}

function confirmMempoolTransactions(tipHeight) {
  for (const tx of txLog) {
    if (tx.status !== "mempool") {
      continue;
    }

    if (tipHeight < tx.confirmHeight) {
      continue;
    }

    tx.status = "confirmed";
    tx.confirmedTip = tipHeight;
    tx.detail = `Confirmed at #${tx.confirmHeight}. Awaiting AT processing.`;
  }
}

function processConfirmedTransactions(tipHeight) {
  const toProcess = txLog
    .filter((tx) => tx.status === "confirmed")
    .sort((a, b) => {
      if (a.confirmHeight !== b.confirmHeight) {
        return a.confirmHeight - b.confirmHeight;
      }

      return a.id - b.id;
    });

  for (const tx of toProcess) {
    processConfirmedTransaction(tx, tipHeight);
    tx.status = "processed";
    tx.processedTip = tipHeight;
  }
}

function processConfirmedTransaction(tx, tipHeight) {
  if (tx.kind === "PAYMENT") {
    processPaymentTx(tx, tipHeight);
    return;
  }

  if (tx.kind === "MESSAGE_PULL") {
    processPullTx(tx, tipHeight);
    return;
  }

  if (tx.kind === "MESSAGE_CASHOUT") {
    processCashoutTx(tx, tipHeight);
  }
}

function processPaymentTx(tx, tipHeight) {
  if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
    machine.totalIgnoredPayments += 1;
    tx.detail = "Ignored PAYMENT (invalid amount).";
    return;
  }

  machine.machineBalance += tx.amount;
  machine.sessionCredit += tx.amount;
  machine.totalDeposited += tx.amount;

  if (!machine.sessionActive) {
    machine.sessionActive = true;
    machine.sessionPullNonce = 0;
    tx.detail = `Processed PAYMENT. Session opened with +${tx.amount}.`;
  } else {
    tx.detail = `Processed PAYMENT top-up +${tx.amount}.`;
  }

  extendSessionDeadline(tipHeight);

  setResult(`PAYMENT tx #${tx.id} processed at #${tx.confirmHeight}.`, "ok");
}

function processPullTx(tx, tipHeight) {
  if (!machine.sessionActive) {
    machine.totalIgnoredMessages += 1;
    tx.detail = "Ignored PULL (no active session).";
    return;
  }

  const bet = tx.bet;
  if (!isValidBetAtoms(bet)) {
    machine.totalIgnoredMessages += 1;
    tx.detail = "Ignored PULL (invalid bet format).";
    return;
  }

  if (machine.pendingPulls.length >= PENDING_QUEUE_CAPACITY) {
    machine.pendingQueueOverflowCount += 1;
    machine.totalIgnoredMessages += 1;
    tx.detail = `Ignored PULL (queue full ${PENDING_QUEUE_CAPACITY}).`;
    return;
  }

  const effectiveMaxBet = deriveEffectiveMaxBet();
  const acceptedMaxBet = Math.min(MAX_BET, effectiveMaxBet, machine.sessionCredit);

  if (bet > acceptedMaxBet) {
    machine.totalIgnoredMessages += 1;
    tx.detail = `Ignored PULL (bet ${bet} > accepted max ${acceptedMaxBet}).`;
    return;
  }

  machine.sessionCredit -= bet;
  machine.sessionPullNonce += 1;
  machine.totalSpins += 1;
  machine.totalWagered += bet;
  machine.lastBet = bet;

  const pendingPull = {
    pullNonce: machine.sessionPullNonce,
    sourceTxId: tx.id,
    txSignature: tx.signature,
    confirmHeight: tx.confirmHeight,
    bet,
  };

  machine.pendingPulls.push(pendingPull);
  extendSessionDeadline(tipHeight);

  tx.detail = `Processed PULL. Reserved ${bet}; queued pull #${pendingPull.pullNonce}.`;

  setResult(
    `PULL tx #${tx.id} queued as pull #${pendingPull.pullNonce}. Waiting entropy settlement.`,
    "warn"
  );
}

function processCashoutTx(tx, tipHeight) {
  if (!machine.sessionActive) {
    machine.totalIgnoredMessages += 1;
    tx.detail = "Ignored CASHOUT (no active session).";
    return;
  }

  if (machine.pendingPulls.length > 0 || machine.settlementState !== "idle") {
    machine.pendingCashoutFlag = true;
    extendSessionDeadline(tipHeight);
    tx.detail = `CASHOUT pending. Waiting for ${machine.pendingPulls.length} pull(s) to settle.`;
    setResult("CASHOUT accepted. It will execute after pending pulls settle.", "warn");
    return;
  }

  const paid = executeCashout("player_cashout", tipHeight);
  tx.detail = `CASHOUT processed. Paid ${paid}.`;
}

function applyInactivityTimeout(tipHeight) {
  if (!machine.sessionActive) {
    return;
  }

  if (!Number.isFinite(machine.sessionDeadlineHeight)) {
    return;
  }

  if (tipHeight < machine.sessionDeadlineHeight) {
    return;
  }

  if (machine.pendingPulls.length > 0) {
    machine.pendingCashoutFlag = true;
    setResult(
      `Timeout reached at #${tipHeight}. Settling ${machine.pendingPulls.length} pending pull(s) first.`,
      "warn"
    );
    return;
  }

  executeCashout("inactivity_timeout", tipHeight);
}

async function advancePendingSettlement(tipHeight) {
  if (machine.pendingPulls.length === 0) {
    machine.settlementState = "idle";
    machine.anchor = null;
    machine.currentEpochSeed64 = null;
    return;
  }

  if (machine.settlementState === "idle" || machine.anchor === null) {
    const anchorPull = machine.pendingPulls[0];
    const readyHeight = anchorPull.confirmHeight + ENTROPY_CONFIRM_DEPTH_K;

    machine.anchor = {
      txId: anchorPull.sourceTxId,
      txSignature: anchorPull.txSignature,
      confirmHeight: anchorPull.confirmHeight,
      readyHeight,
      secondCallHeight: readyHeight + 1,
    };

    machine.settlementState = "waitDepth";
  }

  if (machine.settlementState === "waitDepth") {
    if (tipHeight < machine.anchor.readyHeight) {
      return;
    }

    machine.settlementState = "wait0308";
    setResult(
      `Anchor tx #${machine.anchor.txId} ready at #${machine.anchor.readyHeight}. 0x0308 first call sleeps one block.`,
      "warn"
    );

    if (tipHeight < machine.anchor.secondCallHeight) {
      return;
    }
  }

  if (machine.settlementState === "wait0308") {
    if (tipHeight < machine.anchor.secondCallHeight) {
      return;
    }

    const entropyBlock = await fetchBlockByHeight(machine.anchor.secondCallHeight);
    cacheBlock(entropyBlock);

    const entropySignature = String(entropyBlock.signature || "").trim();
    if (!entropySignature) {
      throw new Error(`entropy block #${machine.anchor.secondCallHeight} missing signature`);
    }

    machine.currentEpochSeed64 = await deriveEpochSeed64(
      machine.anchor.txSignature,
      entropySignature,
      machine.epochCounter + 1
    );
    machine.epochCounter += 1;
    machine.settlementState = "resolving";
  }

  if (machine.settlementState === "resolving") {
    await settlePendingPulls(tipHeight);
    machine.settlementState = "idle";
    machine.anchor = null;
    machine.currentEpochSeed64 = null;
  }
}

async function settlePendingPulls(tipHeight) {
  const queuedPulls = [...machine.pendingPulls];
  machine.pendingPulls.length = 0;

  for (const pull of queuedPulls) {
    const outcome = await derivePullOutcome(pull, machine.epochCounter, machine.currentEpochSeed64);

    machine.sessionCredit += outcome.payout;
    machine.totalPaid += outcome.payout;
    machine.lastWinCredit = outcome.payout;
    machine.lastOutcomeCode = outcome.outcomeCode;
    machine.lastReelStops = [...outcome.stops];

    await animateOutcomeStops(outcome.stops);

    settledPullHistory.unshift({
      pullNonce: pull.pullNonce,
      sourceTxId: pull.sourceTxId,
      confirmHeight: pull.confirmHeight,
      settledTipHeight: tipHeight,
      anchorTxId: machine.anchor.txId,
      epochCounter: machine.epochCounter,
      bet: pull.bet,
      payout: outcome.payout,
      net: outcome.payout - pull.bet,
      symbols: outcome.symbols,
      outcomeCode: outcome.outcomeCode,
    });

    if (settledPullHistory.length > MAX_SETTLED_PULL_ROWS) {
      settledPullHistory.length = MAX_SETTLED_PULL_ROWS;
    }

    const netText = outcome.payout - pull.bet;
    const tone = netText >= 0 ? "ok" : "bad";
    setResult(
      `Settled pull #${pull.pullNonce}: ${outcome.symbols.join(" | ")} -> ${outcome.outcomeCode} (${netText >= 0 ? "+" : ""}${netText}).`,
      tone
    );
  }
}

async function derivePullOutcome(pull, epochCounter, epochSeed64) {
  const basePayload = `${DOMAIN_TAG}|epoch:${epochCounter}|seed:${epochSeed64}|tx:${pull.txSignature}|nonce:${pull.pullNonce}`;
  const stops = [];

  for (let reelIndex = 0; reelIndex < reels.length; reelIndex += 1) {
    const reelLength = reels[reelIndex].length;
    // eslint-disable-next-line no-await-in-loop
    const stop = await deriveStopIndex(basePayload, reelIndex, reelLength);
    stops.push(stop);
  }

  const symbols = stops.map((stop, index) => getWindow(reels[index], stop).mid);
  const outcomeCode = evaluateOutcome(symbols[0], symbols[1], symbols[2]) || "LOSE";
  const multiplier = outcomeCode === "LOSE" ? 0 : PAYTABLE_MAP.get(outcomeCode).multiplier;
  const payout = multiplier * pull.bet;

  return {
    stops,
    symbols,
    outcomeCode,
    multiplier,
    payout,
  };
}

async function deriveStopIndex(basePayload, reelIndex, reelLength) {
  const modulus = BigInt(reelLength);
  const sampleSpace = 1n << 64n;
  const acceptanceLimit = sampleSpace - (sampleSpace % modulus);

  let candidate = 0n;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const payload = `${basePayload}|reel:${reelIndex}|attempt:${attempt}`;
    // eslint-disable-next-line no-await-in-loop
    const digest = await sha256Utf8(payload);
    candidate = readBigUint64BE(digest, 24);

    if (candidate < acceptanceLimit) {
      return Number(candidate % modulus);
    }
  }

  return Number(candidate % modulus);
}

async function deriveEpochSeed64(anchorTxSignature, entropyBlockSignature, epochCounter) {
  const payload = `${DOMAIN_TAG}|anchor:${anchorTxSignature}|block:${entropyBlockSignature}|epoch:${epochCounter}`;
  const digest = await sha256Utf8(payload);
  return readBigUint64BE(digest, 0).toString();
}

async function animateOutcomeStops(finalStops) {
  const startedAt = Date.now();
  const durationMs = 260;

  while (Date.now() - startedAt < durationMs) {
    for (let reelIndex = 0; reelIndex < reels.length; reelIndex += 1) {
      const tempStop = Math.floor(Math.random() * reels[reelIndex].length);
      renderReel(reelIndex, tempStop, true);
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(52);
  }

  for (let reelIndex = 0; reelIndex < finalStops.length; reelIndex += 1) {
    reelStops[reelIndex] = finalStops[reelIndex];
    renderReel(reelIndex, finalStops[reelIndex], false);
  }
}

function submitPaymentTx() {
  if (!ensureMachineReadyForTx()) {
    return;
  }

  const amount = readPositiveInteger(paymentInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    setResult("PAYMENT amount must be a positive integer.", "bad");
    return;
  }

  if (amount > machine.walletBalance) {
    setResult("Not enough wallet credits for PAYMENT.", "bad");
    return;
  }

  machine.walletBalance -= amount;

  const tx = createLocalTx({
    kind: "PAYMENT",
    payload: `amount=${amount}`,
    amount,
  });

  tx.detail = `Accepted in mempool. Will confirm at #${tx.confirmHeight}.`;

  setResult(`PAYMENT tx #${tx.id} created in mempool.`, "warn");
  renderAll();
}

function submitPullTx() {
  if (!ensureMachineReadyForTx()) {
    return;
  }

  if (!machine.sessionActive) {
    setResult("Submit PAYMENT first to open session credit.", "bad");
    return;
  }

  const bet = readPositiveInteger(betInput.value);
  if (!isValidBetAtoms(bet)) {
    setResult(`PULL bet must be ${MIN_BET}-${MAX_BET} with step ${BET_STEP}.`, "bad");
    return;
  }

  const tx = createLocalTx({
    kind: "MESSAGE_PULL",
    payload: `opcode=PULL,bet=${bet}`,
    bet,
  });

  tx.detail = `Accepted in mempool. Will confirm at #${tx.confirmHeight}.`;

  setResult(`PULL tx #${tx.id} queued in mempool.`, "warn");
  renderAll();
}

function submitCashoutTx() {
  if (!ensureMachineReadyForTx()) {
    return;
  }

  if (!machine.sessionActive) {
    setResult("No active session to cash out.", "bad");
    return;
  }

  const tx = createLocalTx({
    kind: "MESSAGE_CASHOUT",
    payload: "opcode=CASHOUT",
  });

  tx.detail = `Accepted in mempool. Will confirm at #${tx.confirmHeight}.`;

  setResult(`CASHOUT tx #${tx.id} queued in mempool.`, "warn");
  renderAll();
}

function createLocalTx({ kind, payload, amount = 0, bet = 0 }) {
  const tipHeight = latestTipHeight;
  const tx = {
    id: nextTxId,
    signature: randomHex(32),
    kind,
    payload,
    amount,
    bet,

    submittedAt: Date.now(),
    submittedTipHeight: tipHeight,
    confirmHeight: tipHeight + 1,

    status: "mempool",
    confirmedTip: null,
    processedTip: null,
    detail: "",
  };

  nextTxId += 1;
  txLog.push(tx);

  return tx;
}

function ensureMachineReadyForTx() {
  if (!loaded) {
    setResult("Load the demo machine first.", "bad");
    return false;
  }

  if (!Number.isFinite(latestTipHeight)) {
    setResult("Sync chain tip before creating txs.", "bad");
    return false;
  }

  return true;
}

function readPositiveInteger(value) {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
}

function isValidBetAtoms(bet) {
  if (!Number.isFinite(bet)) {
    return false;
  }

  if (bet < MIN_BET || bet > MAX_BET) {
    return false;
  }

  return bet % BET_STEP === 0;
}

function deriveEffectiveMaxBet() {
  const houseOwned = Math.max(0, machine.machineBalance - machine.sessionCredit);
  const safeHouse = Math.max(0, houseOwned - PAYOUT_FEE_RESERVE);

  if (safeHouse <= 0) {
    return 0;
  }

  const maxFromSafety = Math.floor(safeHouse / MAX_PAYOUT_MULTIPLIER);
  const stepped = Math.floor(maxFromSafety / BET_STEP) * BET_STEP;

  if (!Number.isFinite(stepped) || stepped < 0) {
    return 0;
  }

  return stepped;
}

function extendSessionDeadline(tipHeight) {
  if (!Number.isFinite(tipHeight)) {
    return;
  }

  machine.sessionDeadlineHeight = tipHeight + SESSION_INACTIVITY_BLOCKS;
}

function executeCashout(reason, tipHeight) {
  const payout = Math.max(0, machine.sessionCredit);

  if (payout > 0) {
    machine.machineBalance = Math.max(0, machine.machineBalance - payout);
    machine.walletBalance += payout;
    machine.totalCashout += payout;
  }

  machine.sessionActive = false;
  machine.sessionCredit = 0;
  machine.sessionDeadlineHeight = null;
  machine.sessionPullNonce = 0;

  machine.pendingCashoutFlag = false;
  machine.pendingPulls.length = 0;
  machine.settlementState = "idle";
  machine.anchor = null;
  machine.currentEpochSeed64 = null;

  setResult(
    `Cashout (${reason}) paid ${payout} at tip #${tipHeight}.`,
    reason === "inactivity_timeout" ? "warn" : "ok"
  );

  return payout;
}

function resetSimulation() {
  machine.walletBalance = STARTING_WALLET_CREDITS;
  machine.machineBalance = STARTING_MACHINE_BALANCE;
  machine.sessionActive = false;
  machine.sessionCredit = 0;
  machine.sessionDeadlineHeight = null;
  machine.sessionPullNonce = 0;
  machine.pendingCashoutFlag = false;

  machine.pendingPulls.length = 0;
  machine.pendingQueueOverflowCount = 0;

  machine.settlementState = "idle";
  machine.anchor = null;
  machine.epochCounter = 0;
  machine.currentEpochSeed64 = null;

  machine.totalDeposited = 0;
  machine.totalCashout = 0;
  machine.totalSpins = 0;
  machine.totalWagered = 0;
  machine.totalPaid = 0;
  machine.totalIgnoredPayments = 0;
  machine.totalIgnoredMessages = 0;

  machine.lastBet = 0;
  machine.lastWinCredit = 0;
  machine.lastOutcomeCode = "-";
  machine.lastReelStops = [0, 0, 0];

  txLog.length = 0;
  settledPullHistory.length = 0;
  nextTxId = 1;

  reelStops[0] = 0;
  reelStops[1] = 0;
  reelStops[2] = 0;
  reelStops.forEach((stop, index) => renderReel(index, stop, false));

  setResult("Simulation reset.", "warn");
  renderAll();
}

function renderAll() {
  updateMachineView();
  renderTxLog();
  renderPullHistory();
  updateControls();
}

function updateMachineView() {
  const houseOwned = Math.max(0, machine.machineBalance - machine.sessionCredit);
  const safeHouse = Math.max(0, houseOwned - PAYOUT_FEE_RESERVE);
  const effectiveMaxBet = deriveEffectiveMaxBet();

  walletEl.textContent = String(machine.walletBalance);
  sessionCreditEl.textContent = String(machine.sessionCredit);
  atBalanceEl.textContent = String(machine.machineBalance);
  houseOwnedEl.textContent = String(houseOwned);
  safeHouseEl.textContent = String(safeHouse);
  effectiveMaxBetEl.textContent = String(effectiveMaxBet);

  queueSizeEl.textContent = `${machine.pendingPulls.length}/${PENDING_QUEUE_CAPACITY}`;
  deadlineEl.textContent = Number.isFinite(machine.sessionDeadlineHeight)
    ? String(machine.sessionDeadlineHeight)
    : "-";

  const settlementFlag = machine.pendingCashoutFlag ? " +cashout" : "";
  settlementStateEl.textContent = `${machine.settlementState}${settlementFlag}`;

  anchorTxEl.textContent = machine.anchor
    ? `#${machine.anchor.txId} ${shorten(machine.anchor.txSignature, 12)}`
    : "-";
  anchorReadyEl.textContent = machine.anchor ? String(machine.anchor.readyHeight) : "-";
  anchorSecondCallEl.textContent = machine.anchor ? String(machine.anchor.secondCallHeight) : "-";

  pullsEl.textContent = String(machine.totalSpins);
  wageredEl.textContent = String(machine.totalWagered);
  paidEl.textContent = String(machine.totalPaid);

  const sessionReturn = machine.totalWagered > 0
    ? (machine.totalPaid / machine.totalWagered) * 100
    : 0;
  returnEl.textContent = `${sessionReturn.toFixed(2)}%`;

  if (!loaded) {
    machineStatusEl.textContent = "Select the demo machine to start.";
  } else if (!Number.isFinite(latestTipHeight)) {
    machineStatusEl.textContent = "Loaded. Sync tip height to start tx simulation.";
  } else if (!machine.sessionActive) {
    machineStatusEl.textContent = "Session empty. Submit PAYMENT to fund session credit.";
  } else {
    machineStatusEl.textContent = `Session occupied. Deadline #${machine.sessionDeadlineHeight}. Pending pulls ${machine.pendingPulls.length}.`;
  }
}

function renderTxLog() {
  if (txLog.length === 0) {
    txLogBody.innerHTML = '<tr><td colspan="7" class="muted">No local transactions yet.</td></tr>';
    return;
  }

  txLogBody.innerHTML = [...txLog]
    .sort((a, b) => b.id - a.id)
    .map((tx) => {
      const statusLabel = tx.status === "mempool"
        ? "Mempool"
        : tx.status === "confirmed"
          ? "Confirmed"
          : "Processed";

      return `<tr>
        <td class="mono">#${tx.id}<br/><span class="muted">${shorten(tx.signature, 12)}</span></td>
        <td>${formatTxTypeLabel(tx)}</td>
        <td class="mono">${tx.payload}</td>
        <td class="mono">#${tx.submittedTipHeight}</td>
        <td class="mono">#${tx.confirmHeight}</td>
        <td>${statusLabel}</td>
        <td>${tx.detail || "-"}</td>
      </tr>`;
    })
    .join("");
}

function renderPullHistory() {
  if (settledPullHistory.length === 0) {
    pullHistoryBody.innerHTML = '<tr><td colspan="8" class="muted">No settled pulls yet.</td></tr>';
    return;
  }

  pullHistoryBody.innerHTML = settledPullHistory
    .map((entry) => {
      const netText = entry.net >= 0 ? `+${entry.net}` : `${entry.net}`;
      return `<tr>
        <td class="mono">#${entry.pullNonce}</td>
        <td class="mono">#${entry.sourceTxId}</td>
        <td class="mono">#${entry.confirmHeight}</td>
        <td class="mono">#${entry.settledTipHeight}</td>
        <td class="mono">A#${entry.anchorTxId} / E${entry.epochCounter}</td>
        <td>${entry.symbols.join(" | ")}</td>
        <td>${entry.outcomeCode}</td>
        <td>${entry.payout} (${netText})</td>
      </tr>`;
    })
    .join("");
}

function formatTxTypeLabel(tx) {
  if (tx.kind === "PAYMENT") {
    return "PAYMENT";
  }

  if (tx.kind === "MESSAGE_PULL") {
    return "MESSAGE PULL";
  }

  return "MESSAGE CASHOUT";
}

function updateControls() {
  const ready = loaded && Number.isFinite(latestTipHeight);

  syncTipBtn.disabled = refreshing;
  fundBtn.disabled = !ready;
  pullBtn.disabled = !ready || !machine.sessionActive;
  cashoutBtn.disabled = !ready || !machine.sessionActive;
}

function updateTipSummary() {
  tipHeightEl.textContent = Number.isFinite(latestTipHeight) ? String(latestTipHeight) : "-";
  tipTimeEl.textContent = Number.isFinite(latestTipTimestamp)
    ? new Date(latestTipTimestamp).toLocaleString()
    : "-";
  tipSignatureEl.textContent = latestTipSignature ? shorten(latestTipSignature, 24) : "-";
}

function setStatus(message, tone) {
  slotStatusEl.textContent = message;
  slotStatusEl.classList.remove("ok", "bad", "warn");
  slotStatusEl.classList.add(tone);
}

function setResult(message, tone) {
  resultLineEl.textContent = message;
  resultLineEl.classList.remove("ok", "bad", "warn");
  resultLineEl.classList.add(tone);
}

async function fetchLatestBlock() {
  try {
    return await fetchLatestBlockViaHttp();
  } catch (httpError) {
    const fallbackBlock = await fetchLatestBlockViaQortalRequest();
    if (fallbackBlock) {
      return fallbackBlock;
    }

    throw httpError;
  }
}

async function fetchBlockByHeight(height) {
  if (blockCache.has(height)) {
    return blockCache.get(height);
  }

  try {
    const block = await fetchBlockByHeightViaHttp(height);
    cacheBlock(block);
    return block;
  } catch (httpError) {
    const fallbackBlock = await fetchBlockByHeightViaQortalRequest(height);
    if (fallbackBlock) {
      cacheBlock(fallbackBlock);
      return fallbackBlock;
    }

    throw httpError;
  }
}

async function fetchLatestBlockViaHttp() {
  const apiBase = normalizeApiBase(apiBaseInput.value);
  const url = apiBase
    ? `${apiBase}/blocks/last?includeOnlineSignatures=false`
    : "/blocks/last?includeOnlineSignatures=false";

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return response.json();
}

async function fetchBlockByHeightViaHttp(height) {
  const apiBase = normalizeApiBase(apiBaseInput.value);
  const urls = apiBase
    ? [
      `${apiBase}/blocks/byheight/${height}?includeOnlineSignatures=false`,
      `${apiBase}/blocks/byheight/${height}`,
    ]
    : [
      `/blocks/byheight/${height}?includeOnlineSignatures=false`,
      `/blocks/byheight/${height}`,
    ];

  let lastError = null;
  for (const url of urls) {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    if (response.ok) {
      return response.json();
    }

    lastError = new Error(`HTTP ${response.status} from ${url}`);
  }

  throw lastError ?? new Error(`Unable to fetch block #${height} by HTTP`);
}

async function fetchLatestBlockViaQortalRequest() {
  const qortalRequest = getQortalRequest();
  if (qortalRequest === null) {
    return null;
  }

  try {
    const status = await qortalRequest({
      action: "GET_NODE_STATUS",
    });

    const height = Number(status?.height);
    if (!Number.isFinite(height)) {
      throw new Error("GET_NODE_STATUS did not return a valid height");
    }

    return await fetchBlockByHeightViaQortalRequest(height);
  } catch (error) {
    throw new Error(`qortalRequest fallback failed: ${error.message}`);
  }
}

async function fetchBlockByHeightViaQortalRequest(height) {
  const qortalRequest = getQortalRequest();
  if (qortalRequest === null) {
    return null;
  }

  try {
    return await qortalRequest({
      action: "FETCH_BLOCK",
      height,
    });
  } catch (error) {
    throw new Error(`qortalRequest fallback failed for #${height}: ${error.message}`);
  }
}

function getQortalRequest() {
  if (typeof window.qortalRequest === "function") {
    return window.qortalRequest.bind(window);
  }

  if (window.parent && typeof window.parent.qortalRequest === "function") {
    return window.parent.qortalRequest.bind(window.parent);
  }

  return null;
}

function normalizeApiBase(value) {
  return value.trim().replace(/\/+$/, "");
}

function cacheBlock(block) {
  const height = Number(block?.height);
  if (!Number.isFinite(height)) {
    return;
  }

  blockCache.set(height, block);

  if (blockCache.size <= 256) {
    return;
  }

  const oldestKey = blockCache.keys().next().value;
  blockCache.delete(oldestKey);
}

async function sha256Utf8(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

function readBigUint64BE(bytes, offset) {
  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    value = (value << 8n) + BigInt(bytes[offset + i]);
  }

  return value;
}

function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount);

  if (window.crypto && typeof window.crypto.getRandomValues === "function") {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteCount; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function shorten(value, visibleChars) {
  if (!value || value.length <= visibleChars) {
    return value || "";
  }

  return `${value.slice(0, visibleChars)}...`;
}

function renderReel(reelIndex, stopIndex, spinningState) {
  const windowSymbols = getWindow(reels[reelIndex], stopIndex);
  const column = reelColumns[reelIndex];

  column.querySelector('[data-pos="top"]').textContent = windowSymbols.top;
  column.querySelector('[data-pos="mid"]').textContent = windowSymbols.mid;
  column.querySelector('[data-pos="bot"]').textContent = windowSymbols.bot;

  if (spinningState) {
    column.classList.add("is-spinning");
  } else {
    column.classList.remove("is-spinning");
  }
}

function getWindow(strip, stopIndex) {
  const max = strip.length;
  const topIndex = (stopIndex - 1 + max) % max;
  const botIndex = (stopIndex + 1) % max;

  return {
    top: strip[topIndex],
    mid: strip[stopIndex],
    bot: strip[botIndex],
  };
}

function evaluateOutcome(a, b, c) {
  if (a === "SEVEN" && b === "SEVEN" && c === "SEVEN") return "SEVEN3";
  if (a === "TRIPLE_BAR" && b === "TRIPLE_BAR" && c === "TRIPLE_BAR") return "TRIPLE_BAR3";
  if (a === "DOUBLE_BAR" && b === "DOUBLE_BAR" && c === "DOUBLE_BAR") return "DOUBLE_BAR3";
  if (a === "BAR" && b === "BAR" && c === "BAR") return "BAR3";
  if (isBar(a) && isBar(b) && isBar(c)) return "ANY_BAR3";
  if (a === "BELL" && b === "BELL" && c === "BELL") return "BELL3";
  if (a === "PLUM" && b === "PLUM" && c === "PLUM") return "PLUM3";
  if (a === "ORANGE" && b === "ORANGE" && c === "ORANGE") return "ORANGE3";
  if (a === "LEMON" && b === "LEMON" && c === "LEMON") return "LEMON3";
  if (a === "CHERRY" && b === "CHERRY" && c === "CHERRY") return "CHERRY3";
  if (a === "CHERRY" && b === "CHERRY") return "CHERRY2";
  if (a === "CHERRY") return "CHERRY1";
  return null;
}

function isBar(symbol) {
  return symbol === "BAR" || symbol === "DOUBLE_BAR" || symbol === "TRIPLE_BAR";
}

function renderReelCountTable() {
  const tbody = document.getElementById("reel-counts-body");
  const rows = SYMBOL_ORDER.map((symbol) => {
    const r1 = REEL_COUNTS[0][symbol];
    const r2 = REEL_COUNTS[1][symbol];
    const r3 = REEL_COUNTS[2][symbol];
    return `<tr><td>${symbol}</td><td>${r1}</td><td>${r2}</td><td>${r3}</td></tr>`;
  });

  tbody.innerHTML = rows.join("");
}

function renderPaytable() {
  const tbody = document.getElementById("paytable-body");
  const rows = PAYTABLE_ORDER.map(
    (entry) => `<tr><td>${entry.label}</td><td>${entry.multiplier}</td></tr>`
  );

  tbody.innerHTML = rows.join("");
}

function makeReelStrip(counts, seed) {
  const strip = [];
  SYMBOL_ORDER.forEach((symbol) => {
    const count = counts[symbol];
    for (let i = 0; i < count; i += 1) {
      strip.push(symbol);
    }
  });

  return seededShuffle(strip, seed);
}

function seededShuffle(input, seed) {
  const output = [...input];
  const rand = seededRng(seed);

  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = output[i];
    output[i] = output[j];
    output[j] = tmp;
  }

  return output;
}

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
