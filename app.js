const startButton = document.querySelector("#startButton");
const resetButton = document.querySelector("#resetButton");
const holdToggle = document.querySelector("#holdToggle");
const bearingText = document.querySelector("#bearingText");
const confidenceText = document.querySelector("#confidenceText");
const levelText = document.querySelector("#levelText");
const levelBar = document.querySelector("#levelBar");
const balanceText = document.querySelector("#balanceText");
const inputState = document.querySelector("#inputState");
const needle = document.querySelector("#needle");
const sweep = document.querySelector("#sweep");

const state = {
  audioContext: null,
  leftAnalyser: null,
  rightAnalyser: null,
  leftData: null,
  rightData: null,
  stream: null,
  isDirectionalInput: false,
  channelCount: null,
  running: false,
  lastEstimate: null,
};

const MIN_ACTIVE_DB = -58;
const BALANCE_THRESHOLD = 0.12;
const CONFIDENCE_GAIN = 3.8;

startButton.addEventListener("click", start);
resetButton.addEventListener("click", resetMeasurements);

async function start() {
  startButton.disabled = true;
  startButton.textContent = "測定中";

  try {
    await startAudio();
    state.running = true;
    requestAnimationFrame(tick);
  } catch (error) {
    startButton.disabled = false;
    startButton.textContent = "測定開始";
    bearingText.textContent = "開始失敗";
    confidenceText.textContent = error.message || "権限を確認してください";
  }
}

async function startAudio() {
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  state.audioContext = new AudioContext();
  const source = state.audioContext.createMediaStreamSource(state.stream);
  const splitter = state.audioContext.createChannelSplitter(2);
  state.leftAnalyser = state.audioContext.createAnalyser();
  state.rightAnalyser = state.audioContext.createAnalyser();
  state.leftAnalyser.fftSize = 2048;
  state.rightAnalyser.fftSize = 2048;
  state.leftData = new Float32Array(state.leftAnalyser.fftSize);
  state.rightData = new Float32Array(state.rightAnalyser.fftSize);

  source.connect(splitter);
  splitter.connect(state.leftAnalyser, 0);
  splitter.connect(state.rightAnalyser, 1);

  const [track] = state.stream.getAudioTracks();
  const settings = track?.getSettings?.() || {};
  state.channelCount = settings.channelCount || null;
  state.isDirectionalInput = state.channelCount !== null && state.channelCount >= 2;
  inputState.textContent = state.isDirectionalInput
    ? `ステレオ入力 ${state.channelCount}ch`
    : state.channelCount === 1
      ? "単一入力のため方向は不明"
      : "入力チャンネル確認中";
}

function tick(now) {
  if (!state.running || !state.leftAnalyser || !state.rightAnalyser) return;

  state.leftAnalyser.getFloatTimeDomainData(state.leftData);
  state.rightAnalyser.getFloatTimeDomainData(state.rightData);
  const leftRms = getRms(state.leftData);
  const rightRms = getRms(state.rightData);
  const rms = (leftRms + rightRms) / 2;
  const db = 20 * Math.log10(Math.max(rms, 0.00001));
  const levelPercent = clamp((db + 70) / 45, 0, 1);

  levelText.textContent = `${Math.round(db)} dB`;
  levelBar.style.width = `${Math.round(levelPercent * 100)}%`;

  if (!holdToggle.checked) {
    state.lastEstimate = estimateDirection(leftRms, rightRms, db);
  }

  renderEstimate(state.lastEstimate);
  requestAnimationFrame(tick);
}

function getRms(buffer) {
  let sum = 0;
  for (const value of buffer) {
    sum += value * value;
  }
  return Math.sqrt(sum / buffer.length);
}

function estimateDirection(leftRms, rightRms, db) {
  if (db < MIN_ACTIVE_DB) {
    balanceText.textContent = "--";
    return { label: "音が小さい", angle: 0, confidence: 0, directional: false };
  }

  const balance = (rightRms - leftRms) / Math.max(rightRms + leftRms, 0.000001);
  const hasUsableBalance = Math.abs(balance) >= BALANCE_THRESHOLD;

  if (!state.isDirectionalInput && !hasUsableBalance) {
    balanceText.textContent = "単一";
    inputState.textContent = state.channelCount === 1
      ? "単一入力のため方向は不明"
      : "左右差が取れません";
    return { label: "方向不明", angle: 0, confidence: 0, directional: false };
  }

  if (!state.isDirectionalInput && hasUsableBalance) {
    inputState.textContent = "左右差を検出";
  }

  const confidence = clamp((Math.abs(balance) - BALANCE_THRESHOLD) * CONFIDENCE_GAIN, 0, 1);
  balanceText.textContent = `${balance > 0 ? "+" : ""}${balance.toFixed(2)}`;

  if (Math.abs(balance) < BALANCE_THRESHOLD) {
    return { label: "正面付近", angle: 0, confidence: 0.35, directional: true };
  }

  return balance > 0
    ? { label: "右方向", angle: 90, confidence, directional: true }
    : { label: "左方向", angle: 270, confidence, directional: true };
}

function renderEstimate(estimate) {
  if (!estimate) {
    bearingText.textContent = "--";
    confidenceText.textContent = "マイク入力待機中";
    needle.style.opacity = "0.3";
    sweep.style.opacity = "0.16";
    return;
  }

  const confidencePercent = Math.round(estimate.confidence * 100);

  bearingText.textContent = estimate.label;
  confidenceText.textContent = estimate.directional
    ? `信頼度 ${confidencePercent}%`
    : "この入力では左右差を取れません";
  needle.style.transform = `rotate(${estimate.angle}deg)`;
  sweep.style.transform = `rotate(${estimate.angle}deg)`;
  needle.style.opacity = String(0.28 + estimate.confidence * 0.72);
  sweep.style.opacity = String(0.14 + estimate.confidence * 0.54);
}

function resetMeasurements() {
  state.lastEstimate = null;
  balanceText.textContent = "--";
  renderEstimate(null);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}
