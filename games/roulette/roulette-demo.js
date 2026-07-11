const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const SINGLE_ZERO_POCKETS = Array.from({ length: 37 }, (_, index) => String(index));
const DOUBLE_ZERO_POCKETS = [
  "0",
  "00",
  ...Array.from({ length: 36 }, (_, index) => String(index + 1)),
];
const PREVIEW_POCKETS = ["0", "00", ...Array.from({ length: 36 }, (_, index) => String(index + 1))];

const AUTO_REFRESH_MS = 15_000;
const CONFIRMATIONS_REQUIRED = 2;
const ROUND_CLOSE_OFFSET = 1;
const ENTROPY_DELAY_BLOCKS = 1;

const STARTING_CREDITS = 1000;
const MIN_BET = 1;
const MAX_BET = 100;

const BET_TYPES = [
  { id: "straight", label: "Straight Up", payout: 35, needsSelection: true },
  { id: "red", label: "Red", payout: 1, needsSelection: false },
  { id: "black", label: "Black", payout: 1, needsSelection: false },
  { id: "odd", label: "Odd", payout: 1, needsSelection: false },
  { id: "even", label: "Even", payout: 1, needsSelection: false },
  { id: "low", label: "1-18", payout: 1, needsSelection: false },
  { id: "high", label: "19-36", payout: 1, needsSelection: false },
  { id: "dozen1", label: "1st Dozen", payout: 2, needsSelection: false },
  { id: "dozen2", label: "2nd Dozen", payout: 2, needsSelection: false },
  { id: "dozen3", label: "3rd Dozen", payout: 2, needsSelection: false },
];

const BET_TYPE_MAP = new Map(BET_TYPES.map((item) => [item.id, item]));

const apiBaseInput = document.getElementById("api-base-input");
const spinLatestBtn = document.getElementById("spin-latest-btn");
const clearBaseBtn = document.getElementById("clear-base-btn");
const autoRefreshToggle = document.getElementById("auto-refresh-toggle");
const rouletteStatusEl = document.getElementById("roulette-status");

const blockHeightEl = document.getElementById("block-height");
const blockTimeEl = document.getElementById("block-time");
const blockSignatureEl = document.getElementById("block-signature");
const blockSeedEl = document.getElementById("block-seed");

const singleResultEl = document.getElementById("single-result");
const singleIndexEl = document.getElementById("single-index");
const doubleResultEl = document.getElementById("double-result");
const doubleIndexEl = document.getElementById("double-index");

const historyBody = document.getElementById("spin-history-body");

const bettingStatusEl = document.getElementById("betting-status");
const roundTipHeightEl = document.getElementById("round-tip-height");
const roundCloseHeightEl = document.getElementById("round-close-height");
const roundEntropyHeightEl = document.getElementById("round-entropy-height");
const roundSettleTipHeightEl = document.getElementById("round-settle-tip-height");

const creditsEl = document.getElementById("credits-value");
const betsEl = document.getElementById("bets-value");
const wageredEl = document.getElementById("wagered-value");
const paidEl = document.getElementById("paid-value");
const hitRateEl = document.getElementById("hit-rate-value");
const returnEl = document.getElementById("return-value");

const betWheelSelect = document.getElementById("bet-wheel-select");
const betTypeSelect = document.getElementById("bet-type-select");
const betTargetInput = document.getElementById("bet-target-input");
const betAmountInput = document.getElementById("bet-amount-input");
const placeBetBtn = document.getElementById("place-bet-btn");
const resetSessionBtn = document.getElementById("reset-session-btn");
const betResultLineEl = document.getElementById("bet-result-line");

const pendingBetsBody = document.getElementById("pending-bets-body");
const settledBetsBody = document.getElementById("settled-bets-body");

let autoRefreshTimer = null;
let lastSettledHeight = null;
let lastSettledSignature = null;
let latestTipHeight = null;
let refreshing = false;

const spinHistory = [];
const seenSignatures = new Set();

let credits = STARTING_CREDITS;
let totalBets = 0;
let totalWagered = 0;
let totalPaid = 0;
let totalWins = 0;
let nextBetId = 1;

const pendingBets = [];
const settledBets = [];
const entropyOutcomeCache = new Map();

init();

function init() {
  bindEvents();
  updateSessionView();
  renderPendingBets();
  renderSettledBets();
  updateStraightSelectionInput();
  setAutoRefresh(autoRefreshToggle.checked);
  syncSettledSpin({ source: "initial" });
}

function bindEvents() {
  spinLatestBtn.addEventListener("click", () => {
    syncSettledSpin({ forceAnimate: true, source: "manual" });
  });

  clearBaseBtn.addEventListener("click", () => {
    apiBaseInput.value = "";
    setStatus("Using relative API path: /blocks", "warn");
    syncSettledSpin({ forceAnimate: true, source: "manual" });
  });

  autoRefreshToggle.addEventListener("change", () => {
    setAutoRefresh(autoRefreshToggle.checked);
  });

  apiBaseInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    syncSettledSpin({ forceAnimate: true, source: "manual" });
  });

  betTypeSelect.addEventListener("change", () => {
    updateStraightSelectionInput();
  });

  betWheelSelect.addEventListener("change", () => {
    updateStraightSelectionInput();
  });

  placeBetBtn.addEventListener("click", () => {
    placeBetForOpenRound();
  });

  resetSessionBtn.addEventListener("click", () => {
    resetSession();
  });

  betAmountInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    placeBetForOpenRound();
  });

  betTargetInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    placeBetForOpenRound();
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
    syncSettledSpin({ source: "auto" });
  }, AUTO_REFRESH_MS);
}

async function syncSettledSpin({ forceAnimate = false, source = "manual" } = {}) {
  if (refreshing) {
    return;
  }

  refreshing = true;
  spinLatestBtn.disabled = true;
  setStatus("Fetching latest tip...", "warn");

  try {
    const latestBlock = await fetchLatestBlock();
    const latestHeight = Number(latestBlock.height);
    if (!Number.isFinite(latestHeight)) {
      throw new Error("latest block did not include a numeric height");
    }

    latestTipHeight = latestHeight;
    placeBetBtn.disabled = false;
    updateRoundWindow(latestTipHeight);

    const settlement = await settleMatureBets(latestHeight);
    if (settlement.count > 0) {
      const tone = settlement.paid > 0 ? "ok" : "warn";
      setBetResult(
        `Settled ${settlement.count} bet(s) at tip #${latestHeight}. Payouts: ${settlement.paid}.`,
        tone
      );
    }

    const settledHeight = latestHeight - CONFIRMATIONS_REQUIRED;
    if (settledHeight < 0) {
      setStatus(`Need at least ${CONFIRMATIONS_REQUIRED + 1} blocks before settled results are available.`, "warn");
      return;
    }

    const settledBlock = await fetchBlockByHeight(settledHeight);
    const signature = String(settledBlock.signature || "").trim();
    const timestamp = Number(settledBlock.timestamp);
    const detectedAt = Date.now();

    if (!signature) {
      throw new Error(`block #${settledHeight} did not include a signature`);
    }

    const settledOutcome = await deriveOutcomesForBlock({
      signature,
      height: settledHeight,
      timestamp,
    });

    const isNewSettled = (
      lastSettledHeight === null ||
      settledHeight !== lastSettledHeight ||
      lastSettledSignature === null ||
      signature !== lastSettledSignature
    );
    const shouldAnimate = forceAnimate || isNewSettled;

    updateBlockSummary(settledHeight, timestamp, signature);

    await Promise.all([
      animateResult(
        singleResultEl,
        settledOutcome.single.label,
        rouletteClass(settledOutcome.single.label),
        shouldAnimate
      ),
      animateResult(
        doubleResultEl,
        settledOutcome.double.label,
        rouletteClass(settledOutcome.double.label),
        shouldAnimate
      ),
    ]);

    singleIndexEl.textContent = String(settledOutcome.single.index);
    doubleIndexEl.textContent = String(settledOutcome.double.index);

    const inserted = pushHistory({
      height: settledHeight,
      blockTimestamp: timestamp,
      detectedAt,
      signature,
      singleLabel: settledOutcome.single.label,
      doubleLabel: settledOutcome.double.label,
    });

    lastSettledHeight = settledHeight;
    lastSettledSignature = signature;

    if (!inserted && source === "auto") {
      setStatus(`No new settled block yet. Tip #${latestHeight}, showing #${settledHeight}.`, "warn");
    } else if (!inserted) {
      setStatus(`Settled block #${settledHeight} already logged.`, "warn");
    } else {
      setStatus(
        `Settled block #${settledHeight} from tip #${latestHeight}${source === "auto" ? " (auto)" : ""}.`,
        "ok"
      );
    }
  } catch (error) {
    setStatus(`Unable to fetch settled block. ${error.message}`, "bad");
    setBettingStatus("Unable to sync tip/round window.");
  } finally {
    refreshing = false;
    spinLatestBtn.disabled = false;
  }
}

function updateRoundWindow(tipHeight) {
  const round = getOpenRoundFromTip(tipHeight);
  roundTipHeightEl.textContent = String(tipHeight);
  roundCloseHeightEl.textContent = String(round.closeHeight);
  roundEntropyHeightEl.textContent = String(round.entropyHeight);
  roundSettleTipHeightEl.textContent = String(round.settleTipHeight);
  setBettingStatus(
    `Open round closes at #${round.closeHeight}. Entropy #${round.entropyHeight}. Settles when tip reaches #${round.settleTipHeight}.`
  );
}

function getOpenRoundFromTip(tipHeight) {
  const closeHeight = tipHeight + ROUND_CLOSE_OFFSET;
  const entropyHeight = closeHeight + ENTROPY_DELAY_BLOCKS;
  const settleTipHeight = entropyHeight + CONFIRMATIONS_REQUIRED;

  return {
    closeHeight,
    entropyHeight,
    settleTipHeight,
  };
}

function updateStraightSelectionInput() {
  const type = BET_TYPE_MAP.get(betTypeSelect.value);
  const wheel = betWheelSelect.value;
  const needsSelection = Boolean(type?.needsSelection);

  betTargetInput.disabled = !needsSelection;
  if (!needsSelection) {
    betTargetInput.placeholder = "Not used for this bet type";
    return;
  }

  if (wheel === "double") {
    betTargetInput.placeholder = "0-36 or 00";
  } else {
    betTargetInput.placeholder = "0-36";
    if (betTargetInput.value.trim() === "00") {
      betTargetInput.value = "0";
    }
  }
}

function placeBetForOpenRound() {
  if (!Number.isFinite(latestTipHeight)) {
    setBetResult("Wait for tip sync before placing bets.", "bad");
    return;
  }

  const amount = readBetAmount();
  if (amount === null) {
    setBetResult(`Bet amount must be between ${MIN_BET} and ${MAX_BET}.`, "bad");
    return;
  }

  if (amount > credits) {
    setBetResult("Not enough credits for this bet.", "bad");
    return;
  }

  const betType = BET_TYPE_MAP.get(betTypeSelect.value);
  if (!betType) {
    setBetResult("Unknown bet type.", "bad");
    return;
  }

  const wheel = betWheelSelect.value;
  let selection = null;

  if (betType.needsSelection) {
    selection = normalizeStraightSelection(betTargetInput.value, wheel);
    if (selection === null) {
      setBetResult(
        wheel === "double"
          ? "Straight pick must be 0-36 or 00 on double-zero wheel."
          : "Straight pick must be 0-36 on single-zero wheel.",
        "bad"
      );
      return;
    }
  }

  const openRound = getOpenRoundFromTip(latestTipHeight);
  const bet = {
    id: nextBetId,
    placedAt: Date.now(),
    wheel,
    type: betType.id,
    selection,
    amount,
    closeHeight: openRound.closeHeight,
    entropyHeight: openRound.entropyHeight,
    settleTipHeight: openRound.settleTipHeight,
  };

  nextBetId += 1;
  pendingBets.push(bet);

  credits -= amount;
  totalBets += 1;
  totalWagered += amount;

  updateSessionView();
  renderPendingBets();

  setBetResult(
    `Bet #${bet.id} queued for close #${bet.closeHeight} (entropy #${bet.entropyHeight}).`,
    "warn"
  );
}

function readBetAmount() {
  const value = Number.parseInt(betAmountInput.value, 10);
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value < MIN_BET || value > MAX_BET) {
    return null;
  }

  return value;
}

function normalizeStraightSelection(rawValue, wheel) {
  const value = rawValue.trim().toUpperCase();

  if (value === "00") {
    return wheel === "double" ? "00" : null;
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 36) {
    return null;
  }

  return String(numeric);
}

async function settleMatureBets(tipHeight) {
  if (pendingBets.length === 0) {
    return { count: 0, paid: 0 };
  }

  const maxEntropyHeight = tipHeight - CONFIRMATIONS_REQUIRED;
  if (maxEntropyHeight < 0) {
    return { count: 0, paid: 0 };
  }

  const matureBets = pendingBets.filter((bet) => bet.entropyHeight <= maxEntropyHeight);
  if (matureBets.length === 0) {
    return { count: 0, paid: 0 };
  }

  let totalPayout = 0;

  for (const bet of matureBets) {
    const outcome = await getEntropyOutcome(bet.entropyHeight);
    const pocketLabel = bet.wheel === "single" ? outcome.single.label : outcome.double.label;
    const evaluation = evaluateBet(bet, pocketLabel);

    credits += evaluation.payout;
    totalPaid += evaluation.payout;
    totalPayout += evaluation.payout;
    if (evaluation.win) {
      totalWins += 1;
    }

    settledBets.unshift({
      ...bet,
      settledAt: Date.now(),
      settledTipHeight: tipHeight,
      entropySignature: outcome.signature,
      entropyTimestamp: outcome.timestamp,
      pocketLabel,
      payout: evaluation.payout,
      won: evaluation.win,
      net: evaluation.payout - bet.amount,
    });
  }

  for (let i = pendingBets.length - 1; i >= 0; i -= 1) {
    if (pendingBets[i].entropyHeight <= maxEntropyHeight) {
      pendingBets.splice(i, 1);
    }
  }

  updateSessionView();
  renderPendingBets();
  renderSettledBets();

  return {
    count: matureBets.length,
    paid: totalPayout,
  };
}

function evaluateBet(bet, pocketLabel) {
  const betType = BET_TYPE_MAP.get(bet.type);
  let win = false;

  switch (bet.type) {
    case "straight":
      win = pocketLabel === bet.selection;
      break;
    case "red":
      win = rouletteClass(pocketLabel) === "red";
      break;
    case "black":
      win = rouletteClass(pocketLabel) === "black";
      break;
    case "odd": {
      const value = parsePocketNumber(pocketLabel);
      win = value !== null && value >= 1 && value <= 36 && value % 2 === 1;
      break;
    }
    case "even": {
      const value = parsePocketNumber(pocketLabel);
      win = value !== null && value >= 1 && value <= 36 && value % 2 === 0;
      break;
    }
    case "low": {
      const value = parsePocketNumber(pocketLabel);
      win = value !== null && value >= 1 && value <= 18;
      break;
    }
    case "high": {
      const value = parsePocketNumber(pocketLabel);
      win = value !== null && value >= 19 && value <= 36;
      break;
    }
    case "dozen1": {
      const value = parsePocketNumber(pocketLabel);
      win = value !== null && value >= 1 && value <= 12;
      break;
    }
    case "dozen2": {
      const value = parsePocketNumber(pocketLabel);
      win = value !== null && value >= 13 && value <= 24;
      break;
    }
    case "dozen3": {
      const value = parsePocketNumber(pocketLabel);
      win = value !== null && value >= 25 && value <= 36;
      break;
    }
    default:
      win = false;
      break;
  }

  const payout = win ? bet.amount * (betType.payout + 1) : 0;
  return { win, payout };
}

function parsePocketNumber(label) {
  if (label === "00") {
    return null;
  }

  const numeric = Number.parseInt(label, 10);
  return Number.isFinite(numeric) ? numeric : null;
}

async function getEntropyOutcome(height) {
  if (entropyOutcomeCache.has(height)) {
    return entropyOutcomeCache.get(height);
  }

  const block = await fetchBlockByHeight(height);
  const signature = String(block.signature || "").trim();
  if (!signature) {
    throw new Error(`block #${height} did not include a signature`);
  }

  const timestamp = Number(block.timestamp);
  const outcome = await deriveOutcomesForBlock({ signature, height, timestamp });
  entropyOutcomeCache.set(height, outcome);
  return outcome;
}

async function deriveOutcomesForBlock({ signature, height, timestamp }) {
  const single = await deriveRouletteOutcome({
    signature,
    height,
    wheelSize: 37,
    domainTag: "roulette-single-zero-v1",
  });

  const double = await deriveRouletteOutcome({
    signature,
    height,
    wheelSize: 38,
    domainTag: "roulette-double-zero-v1",
  });

  return {
    height,
    timestamp,
    signature,
    single,
    double,
  };
}

function resetSession() {
  credits = STARTING_CREDITS;
  totalBets = 0;
  totalWagered = 0;
  totalPaid = 0;
  totalWins = 0;
  nextBetId = 1;

  pendingBets.length = 0;
  settledBets.length = 0;
  entropyOutcomeCache.clear();

  updateSessionView();
  renderPendingBets();
  renderSettledBets();
  setBetResult("Betting session reset.", "warn");
}

function updateSessionView() {
  creditsEl.textContent = String(credits);
  betsEl.textContent = String(totalBets);
  wageredEl.textContent = String(totalWagered);
  paidEl.textContent = String(totalPaid);

  const hitRate = totalBets > 0 ? (totalWins / totalBets) * 100 : 0;
  const totalReturn = totalWagered > 0 ? (totalPaid / totalWagered) * 100 : 0;

  hitRateEl.textContent = `${hitRate.toFixed(2)}%`;
  returnEl.textContent = `${totalReturn.toFixed(2)}%`;
}

function renderPendingBets() {
  if (pendingBets.length === 0) {
    pendingBetsBody.innerHTML = '<tr><td colspan="5" class="muted">No pending bets.</td></tr>';
    return;
  }

  pendingBetsBody.innerHTML = [...pendingBets]
    .reverse()
    .map((bet) => {
      const placed = new Date(bet.placedAt).toLocaleTimeString();
      return `<tr>
        <td class="mono">#${bet.id}</td>
        <td>${placed}</td>
        <td class="mono">C#${bet.closeHeight} / E#${bet.entropyHeight} / S#${bet.settleTipHeight}</td>
        <td>${formatBetSelection(bet)}</td>
        <td>${bet.amount}</td>
      </tr>`;
    })
    .join("");
}

function renderSettledBets() {
  if (settledBets.length === 0) {
    settledBetsBody.innerHTML = '<tr><td colspan="5" class="muted">No settled bets yet.</td></tr>';
    return;
  }

  settledBetsBody.innerHTML = settledBets
    .map((bet) => {
      const settledAt = new Date(bet.settledAt).toLocaleTimeString();
      const net = bet.net >= 0 ? `+${bet.net}` : String(bet.net);

      return `<tr>
        <td class="mono">#${bet.id}</td>
        <td>${settledAt}</td>
        <td class="mono">#${bet.entropyHeight} ${shorten(bet.entropySignature, 10)}</td>
        <td>${formatBetSelection(bet)} -> <strong>${bet.pocketLabel}</strong></td>
        <td>${bet.payout} (${net})</td>
      </tr>`;
    })
    .join("");
}

function formatBetSelection(bet) {
  const type = BET_TYPE_MAP.get(bet.type);
  const wheelLabel = bet.wheel === "single" ? "S0" : "D0";

  if (type.needsSelection) {
    return `${wheelLabel} ${type.label} ${bet.selection}`;
  }

  return `${wheelLabel} ${type.label}`;
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
  try {
    return await fetchBlockByHeightViaHttp(height);
  } catch (httpError) {
    const fallbackBlock = await fetchBlockByHeightViaQortalRequest(height);
    if (fallbackBlock) {
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

async function deriveRouletteOutcome({ signature, height, wheelSize, domainTag }) {
  const pockets = wheelSize === 37 ? SINGLE_ZERO_POCKETS : DOUBLE_ZERO_POCKETS;
  const modulus = BigInt(wheelSize);
  const spaceSize = 1n << 64n;
  const acceptanceLimit = spaceSize - (spaceSize % modulus);
  let candidate = 0n;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const payload = `${domainTag}|${height}|${signature}|${attempt}`;
    const digest = await sha256Utf8(payload);
    candidate = readBigUint64BE(digest, 24);

    if (candidate < acceptanceLimit) {
      const index = Number(candidate % modulus);
      return {
        index,
        label: pockets[index],
      };
    }
  }

  const fallbackIndex = Number(candidate % modulus);
  return {
    index: fallbackIndex,
    label: pockets[fallbackIndex],
  };
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

async function animateResult(element, finalLabel, finalClass, animate) {
  if (!animate) {
    setResultChip(element, finalLabel, finalClass);
    return;
  }

  const startedAt = Date.now();
  const durationMs = 1100;

  while (Date.now() - startedAt < durationMs) {
    const previewLabel = PREVIEW_POCKETS[Math.floor(Math.random() * PREVIEW_POCKETS.length)];
    setResultChip(element, previewLabel, rouletteClass(previewLabel));
    // eslint-disable-next-line no-await-in-loop
    await sleep(55);
  }

  setResultChip(element, finalLabel, finalClass);
}

function setResultChip(element, label, colorClass) {
  element.textContent = label;
  element.classList.remove(
    "roulette-number-idle",
    "roulette-number-red",
    "roulette-number-black",
    "roulette-number-green"
  );
  element.classList.add(`roulette-number-${colorClass}`);
}

function rouletteClass(label) {
  if (label === "0" || label === "00") {
    return "green";
  }

  const numeric = Number.parseInt(label, 10);
  return RED_NUMBERS.has(numeric) ? "red" : "black";
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function updateBlockSummary(height, timestamp, signature) {
  blockHeightEl.textContent = String(height);
  blockTimeEl.textContent = Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : "Unknown";
  blockSignatureEl.textContent = shorten(signature, 24);
  blockSeedEl.textContent = `${shorten(signature, 10)}:${height}`;
}

function pushHistory(entry) {
  if (seenSignatures.has(entry.signature)) {
    return false;
  }

  seenSignatures.add(entry.signature);
  spinHistory.unshift(entry);
  renderHistory();
  return true;
}

function renderHistory() {
  if (spinHistory.length === 0) {
    historyBody.innerHTML = '<tr><td colspan="6" class="muted">No spins yet.</td></tr>';
    return;
  }

  historyBody.innerHTML = spinHistory
    .map((entry) => {
      const blockTime = Number.isFinite(entry.blockTimestamp)
        ? new Date(entry.blockTimestamp).toLocaleString()
        : "Unknown";
      const detectedTime = Number.isFinite(entry.detectedAt)
        ? new Date(entry.detectedAt).toLocaleString()
        : "Unknown";

      return `<tr>
        <td class="mono">#${entry.height}</td>
        <td>${blockTime}</td>
        <td>${detectedTime}</td>
        <td class="mono">${shorten(entry.signature, 12)}</td>
        <td>${entry.singleLabel}</td>
        <td>${entry.doubleLabel}</td>
      </tr>`;
    })
    .join("");
}

function setStatus(message, tone) {
  rouletteStatusEl.textContent = message;
  rouletteStatusEl.classList.remove("ok", "bad", "warn");
  rouletteStatusEl.classList.add(tone);
}

function setBetResult(message, tone) {
  betResultLineEl.textContent = message;
  betResultLineEl.classList.remove("ok", "bad", "warn");
  betResultLineEl.classList.add(tone);
}

function setBettingStatus(message) {
  bettingStatusEl.textContent = message;
}

function shorten(value, visibleChars) {
  if (value.length <= visibleChars) {
    return value;
  }

  return `${value.slice(0, visibleChars)}...`;
}
