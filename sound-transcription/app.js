const startButton = document.querySelector("#transcribeButton");
const stopButton = document.querySelector("#stopButton");
const distantModeToggle = document.querySelector("#distantModeToggle");
const languageSelect = document.querySelector("#languageSelect");
const copyTranscriptButton = document.querySelector("#copyTranscriptButton");
const downloadTranscriptButton = document.querySelector("#downloadTranscriptButton");
const clearTranscriptButton = document.querySelector("#clearTranscriptButton");
const transcriptText = document.querySelector("#transcriptText");
const transcriptionStatus = document.querySelector("#transcriptionStatus");
const transcriptionHelp = document.querySelector("#transcriptionHelp");
const levelText = document.querySelector("#levelText");
const levelBar = document.querySelector("#levelBar");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const state = {
  recognition: null,
  audioContext: null,
  analyser: null,
  levelData: null,
  monitorStream: null,
  levelFrame: 0,
  shouldListen: false,
  finalText: "",
  interimText: "",
  fallbackMode: false,
};

startButton.addEventListener("click", startTranscription);
stopButton.addEventListener("click", stopTranscription);
copyTranscriptButton.addEventListener("click", copyTranscript);
downloadTranscriptButton.addEventListener("click", downloadTranscript);
clearTranscriptButton.addEventListener("click", clearTranscript);
languageSelect.addEventListener("change", () => {
  if (state.recognition) {
    state.recognition.lang = languageSelect.value;
  }
});

cleanupOldServiceWorker();
setupTranscription();

function setupTranscription() {
  if (!window.isSecureContext) {
    enableFallback("HTTPSの公開URLで開いてください。");
    return;
  }

  if (!SpeechRecognition) {
    enableFallback("このブラウザはページ内の音声認識に対応していません。入力欄をタップし、キーボードのマイクボタンを使ってください。");
    return;
  }

  transcriptionStatus.textContent = "待機中";
  transcriptionHelp.textContent = "文字起こし開始を押して、マイクの使用を許可してください。";
}

function createRecognition() {
  const recognition = new SpeechRecognition();
  recognition.lang = languageSelect.value;
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    transcriptionStatus.textContent = "聞き取り中";
    transcriptionHelp.textContent = "話した内容が下に表示されます。止めるときは停止を押してください。";
    startButton.disabled = true;
    stopButton.disabled = false;
    startButton.classList.add("is-recording");
  };

  recognition.onresult = (event) => {
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) {
        state.finalText += `${text.trim()}\n`;
      } else {
        interim += text;
      }
    }

    state.interimText = interim.trim();
    renderTranscript();
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted" && !state.shouldListen) return;

    if (event.error === "no-speech" && state.shouldListen && distantModeToggle.checked) {
      transcriptionStatus.textContent = "聞き取り継続中";
      transcriptionHelp.textContent = "音が小さいため待機を続けています。スマホのマイク側を音源へ向けてください。";
      return;
    }

    if (event.error === "service-not-allowed" || event.error === "not-allowed") {
      enableFallback(getRecognitionErrorMessage(event.error));
      focusManualInput();
      return;
    }

    transcriptionStatus.textContent = "エラー";
    transcriptionHelp.textContent = getRecognitionErrorMessage(event.error);
  };

  recognition.onend = () => {
    if (state.shouldListen) {
      window.setTimeout(() => {
        try {
          state.recognition?.start();
        } catch (error) {
          transcriptionStatus.textContent = "再開待ち";
        }
      }, distantModeToggle.checked ? 120 : 300);
      return;
    }

    startButton.disabled = false;
    stopButton.disabled = true;
    startButton.classList.remove("is-recording");
    transcriptionStatus.textContent = transcriptText.value.trim() ? "停止中" : "待機中";
  };

  return recognition;
}

function startTranscription() {
  if (state.fallbackMode) {
    focusManualInput();
    return;
  }

  unlockAudio();
  state.shouldListen = true;
  state.recognition = createRecognition();

  try {
    state.recognition.start();
    startLevelMonitor();
  } catch (error) {
    transcriptionStatus.textContent = "エラー";
    transcriptionHelp.textContent = getStartErrorMessage(error);
    state.shouldListen = false;
    startButton.disabled = false;
    stopButton.disabled = true;
  }
}

function stopTranscription() {
  state.shouldListen = false;
  stopButton.disabled = true;
  stopLevelMonitor();

  try {
    state.recognition?.stop();
  } catch (error) {
    startButton.disabled = false;
    startButton.classList.remove("is-recording");
    transcriptionStatus.textContent = transcriptText.value.trim() ? "停止中" : "待機中";
  }
}

function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  try {
    state.audioContext ||= new AudioContext();
    if (state.audioContext.state === "suspended") {
      state.audioContext.resume();
    }

    const source = state.audioContext.createBufferSource();
    source.connect(state.audioContext.destination);
    source.start(0);
  } catch (error) {
    // Audio unlock is best-effort; speech recognition can still continue.
  }
}

async function startLevelMonitor() {
  if (!distantModeToggle.checked || !navigator.mediaDevices?.getUserMedia) return;

  try {
    stopLevelMonitor();
    state.monitorStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    state.audioContext ||= new AudioContext();
    if (state.audioContext.state === "suspended") {
      await state.audioContext.resume();
    }

    const source = state.audioContext.createMediaStreamSource(state.monitorStream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 1024;
    state.levelData = new Uint8Array(state.analyser.fftSize);
    source.connect(state.analyser);
    updateLevelMeter();
  } catch (error) {
    levelText.textContent = "確認不可";
  }
}

function stopLevelMonitor() {
  if (state.levelFrame) {
    cancelAnimationFrame(state.levelFrame);
    state.levelFrame = 0;
  }

  if (state.monitorStream) {
    state.monitorStream.getTracks().forEach((track) => track.stop());
    state.monitorStream = null;
  }

  state.analyser = null;
  state.levelData = null;
  levelText.textContent = "停止中";
  levelBar.style.width = "0%";
}

function updateLevelMeter() {
  if (!state.analyser || !state.levelData) return;

  state.analyser.getByteTimeDomainData(state.levelData);
  let sum = 0;

  for (const value of state.levelData) {
    const centered = value - 128;
    sum += centered * centered;
  }

  const rms = Math.sqrt(sum / state.levelData.length) / 128;
  const percent = Math.min(100, Math.round(rms * 240));
  levelBar.style.width = `${percent}%`;

  if (percent < 8) {
    levelText.textContent = "小さい";
  } else if (percent < 28) {
    levelText.textContent = "聞き取り中";
  } else {
    levelText.textContent = "十分";
  }

  state.levelFrame = requestAnimationFrame(updateLevelMeter);
}

function enableFallback(message) {
  state.fallbackMode = true;
  state.shouldListen = false;
  startButton.disabled = false;
  stopButton.disabled = true;
  startButton.classList.remove("is-recording");
  startButton.innerHTML = '<span aria-hidden="true"></span> 入力欄を開く';
  transcriptionStatus.textContent = "端末入力";
  transcriptionHelp.textContent = message;
  levelText.textContent = "端末入力";
}

function focusManualInput() {
  transcriptionStatus.textContent = "入力できます";
  transcriptionHelp.textContent = "キーボードが開いたら、マイクボタンを押して話してください。入力された文章はコピーや保存ができます。";
  transcriptText.focus();
  transcriptText.setSelectionRange(transcriptText.value.length, transcriptText.value.length);
}

function renderTranscript() {
  const divider = state.finalText && state.interimText ? "\n" : "";
  transcriptText.value = `${state.finalText}${divider}${state.interimText}`.trimStart();
  transcriptText.scrollTop = transcriptText.scrollHeight;
}

async function copyTranscript() {
  const text = transcriptText.value.trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    transcriptText.select();
    document.execCommand("copy");
  }

  transcriptionStatus.textContent = "コピー済み";
}

function downloadTranscript() {
  const text = transcriptText.value.trim();
  if (!text) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([`${text}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `transcript-${timestamp}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  transcriptionStatus.textContent = "保存しました";
}

function clearTranscript() {
  state.finalText = "";
  state.interimText = "";
  transcriptText.value = "";
  transcriptionStatus.textContent = state.fallbackMode ? "端末入力" : state.shouldListen ? "聞き取り中" : "待機中";
}

function getRecognitionErrorMessage(errorCode) {
  const messages = {
    "audio-capture": "マイクが見つかりません。端末のマイク設定を確認してください。",
    "not-allowed": "マイクの使用が許可されていません。入力欄を開いて、キーボードのマイクボタンを使ってください。",
    aborted: "音声認識が中断されました。もう一度開始してください。",
    "language-not-supported": "選択した言語はこのブラウザで使えません。言語を切り替えて試してください。",
    network: "音声認識サービスに接続できません。通信状態を確認してください。",
    "no-speech": "音声を検出できませんでした。もう一度話してください。",
    "service-not-allowed": "このブラウザではページ内の音声認識を利用できません。入力欄を開いて端末の音声入力を使ってください。",
  };

  return messages[errorCode] || `文字起こしを開始できませんでした。エラー: ${errorCode || "不明"}。`;
}

function getStartErrorMessage(error) {
  if (error?.name === "InvalidStateError") {
    return "音声認識がまだ停止処理中です。少し待ってからもう一度押してください。";
  }

  return `文字起こしを開始できませんでした。エラー: ${error?.name || error?.message || "不明"}。`;
}

function cleanupOldServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => {});
  }

  if ("caches" in window) {
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name.startsWith("transcription-only-") || name.startsWith("sound-bearing-transcription-"))
        .map((name) => caches.delete(name))))
      .catch(() => {});
  }
}
