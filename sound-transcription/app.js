const transcribeButton = document.querySelector("#transcribeButton");
const languageSelect = document.querySelector("#languageSelect");
const copyTranscriptButton = document.querySelector("#copyTranscriptButton");
const downloadTranscriptButton = document.querySelector("#downloadTranscriptButton");
const clearTranscriptButton = document.querySelector("#clearTranscriptButton");
const transcriptText = document.querySelector("#transcriptText");
const transcriptionStatus = document.querySelector("#transcriptionStatus");
const transcriptionHelp = document.querySelector("#transcriptionHelp");

const state = {
  recognition: null,
  supported: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
  listening: false,
  finalText: "",
  interimText: "",
  nativeDictation: true,
};

transcribeButton.addEventListener("click", toggleTranscription);
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
    setNativeDictationMode("HTTPSの公開URLで開いてください。");
    return;
  }

  if (isAppleMobileBrowser() || !state.supported) {
    setNativeDictationMode("入力欄を開き、キーボードのマイクボタンで音声入力してください。");
    return;
  }

  state.nativeDictation = false;
  transcriptionStatus.textContent = "待機中";
  transcribeButton.innerHTML = '<span aria-hidden="true"></span> 文字起こし開始';
  transcriptionHelp.textContent = "文字起こし開始を押し、マイクの使用を許可してください。";
}

function isAppleMobileBrowser() {
  const ua = navigator.userAgent || "";
  const appleTouchDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    (/Apple/.test(navigator.vendor || "") && navigator.maxTouchPoints > 1);
  const iOSBrowser = /CriOS|FxiOS|EdgiOS|Version\/.+Mobile\/.+Safari/.test(ua);
  return appleTouchDevice || iOSBrowser;
}

function setNativeDictationMode(message) {
  state.nativeDictation = true;
  state.listening = false;
  state.recognition = null;
  transcriptionStatus.textContent = "端末入力";
  transcribeButton.classList.remove("is-recording");
  transcribeButton.innerHTML = '<span aria-hidden="true"></span> 入力欄を開く';
  transcriptionHelp.textContent = `iPhoneではページ内の音声認識を開始できない場合があります。${message}`;
}

function createRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = languageSelect.value;
  return recognition;
}

function attachRecognitionEvents(recognition) {
  recognition.addEventListener("audiostart", () => {
    transcriptionHelp.textContent = "マイク入力を確認しました。話した内容が下に表示されます。";
  });

  recognition.addEventListener("start", () => {
    state.listening = true;
    transcriptionStatus.textContent = "聞き取り中";
    transcribeButton.classList.add("is-recording");
    transcribeButton.innerHTML = '<span aria-hidden="true"></span> 停止';
  });

  recognition.addEventListener("result", (event) => {
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) {
        state.finalText += `${piece.trim()}\n`;
      } else {
        interim += piece;
      }
    }

    state.interimText = interim.trim();
    renderTranscript();
  });

  recognition.addEventListener("end", () => {
    state.listening = false;
    state.interimText = "";
    transcriptionStatus.textContent = transcriptText.value.trim() ? "停止中" : "待機中";
    transcribeButton.classList.remove("is-recording");
    transcribeButton.innerHTML = '<span aria-hidden="true"></span> 文字起こし開始';
    renderTranscript();
  });

  recognition.addEventListener("error", (event) => {
    state.listening = false;
    transcribeButton.classList.remove("is-recording");

    if (isAppleMobileBrowser() || event.error === "service-not-allowed") {
      setNativeDictationMode("入力欄をタップし、キーボードのマイクボタンを使ってください。");
      focusManualDictation();
      return;
    }

    transcriptionStatus.textContent = "エラー";
    transcribeButton.innerHTML = '<span aria-hidden="true"></span> 文字起こし開始';
    transcriptionHelp.textContent = getRecognitionErrorMessage(event.error);
  });
}

async function toggleTranscription() {
  if (state.nativeDictation) {
    focusManualDictation();
    return;
  }

  if (state.listening) {
    state.recognition?.stop();
    return;
  }

  transcriptionStatus.textContent = "準備中";
  transcriptionHelp.textContent = "マイクの使用許可を確認しています。";

  try {
    await ensureMicrophonePermission();
    state.recognition = createRecognition();
    attachRecognitionEvents(state.recognition);
    state.recognition.start();
  } catch (error) {
    if (isAppleMobileBrowser()) {
      setNativeDictationMode("入力欄をタップし、キーボードのマイクボタンを使ってください。");
      focusManualDictation();
      return;
    }

    state.listening = false;
    transcriptionStatus.textContent = "エラー";
    transcribeButton.classList.remove("is-recording");
    transcribeButton.innerHTML = '<span aria-hidden="true"></span> 文字起こし開始';
    transcriptionHelp.textContent = getStartErrorMessage(error);
  }
}

function focusManualDictation() {
  transcriptionStatus.textContent = "入力できます";
  transcriptionHelp.textContent = "キーボードが開いたら、マイクボタンを押して話してください。入力された文章はコピーや保存ができます。";
  transcriptText.focus();
  transcriptText.setSelectionRange(transcriptText.value.length, transcriptText.value.length);
}

async function ensureMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) return;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
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
  transcriptionStatus.textContent = state.nativeDictation ? "端末入力" : state.listening ? "聞き取り中" : "待機中";
}

function getRecognitionErrorMessage(errorCode) {
  const messages = {
    "audio-capture": "マイクが見つかりません。端末のマイク設定を確認してください。",
    "not-allowed": "マイクの使用が許可されていません。ブラウザの権限設定を確認してください。",
    aborted: "音声認識が中断されました。もう一度「文字起こし開始」を押してください。",
    "language-not-supported": "選択した言語はこのブラウザで使えません。日本語またはEnglishを切り替えて試してください。",
    network: "音声認識サービスに接続できません。通信状態を確認してください。",
    "no-speech": "音声を検出できませんでした。もう一度話してください。",
    "service-not-allowed": "このブラウザではページ内の音声認識を利用できません。入力欄を開いて端末の音声入力を使ってください。",
  };

  return messages[errorCode] || `文字起こしを開始できませんでした。エラー: ${errorCode || "不明"}。`;
}

function getStartErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return "マイクの使用が許可されていません。ブラウザの権限設定でマイクを許可してください。";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "マイクが見つかりません。端末のマイク設定を確認してください。";
  }

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
