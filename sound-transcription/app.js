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

setupTranscription();

function setupTranscription() {
  if (!state.supported) {
    transcribeButton.disabled = true;
    transcriptionStatus.textContent = "非対応";
    transcriptionHelp.textContent = "このブラウザは音声認識に対応していません。AndroidのChromeなどで開いてください。";
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = languageSelect.value;

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
    transcriptionStatus.textContent = "エラー";
    transcribeButton.classList.remove("is-recording");
    transcribeButton.innerHTML = '<span aria-hidden="true"></span> 文字起こし開始';
    transcriptionHelp.textContent = getRecognitionErrorMessage(event.error);
  });

  state.recognition = recognition;
}

function toggleTranscription() {
  if (!state.recognition) return;

  if (state.listening) {
    state.recognition.stop();
    return;
  }

  transcriptionHelp.textContent = "話した内容が下に表示されます。必要に応じてコピーまたは保存できます。";
  state.recognition.lang = languageSelect.value;

  try {
    state.recognition.start();
  } catch (error) {
    transcriptionStatus.textContent = "起動待ち";
  }
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
  transcriptionStatus.textContent = state.listening ? "聞き取り中" : "待機中";
}

function getRecognitionErrorMessage(errorCode) {
  const messages = {
    "audio-capture": "マイクが見つかりません。端末のマイク設定を確認してください。",
    "not-allowed": "マイクの使用が許可されていません。ブラウザの権限設定を確認してください。",
    network: "音声認識サービスに接続できません。通信状態を確認してください。",
    "no-speech": "音声を検出できませんでした。もう一度話してください。",
  };

  return messages[errorCode] || "文字起こしを開始できませんでした。ブラウザや権限設定を確認してください。";
}

if ("serviceWorker" in navigator) {
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("./service-worker.js").then((registration) => {
    registration.update();

    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;

      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  }).catch(() => {});
}
