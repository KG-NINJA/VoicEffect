const recordButton = document.getElementById("recordButton");
const stopButton = document.getElementById("stopButton");
const playOriginalButton = document.getElementById("playOriginalButton");
const processButton = document.getElementById("processButton");
const playProcessedButton = document.getElementById("playProcessedButton");
const presetSelect = document.getElementById("presetSelect");
const originalAudio = document.getElementById("originalAudio");
const processedAudio = document.getElementById("processedAudio");
const downloadLink = document.getElementById("downloadLink");
const message = document.getElementById("message");
const timer = document.getElementById("timer");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

let mediaRecorder;
let mediaStream;
let chunks = [];
let recordedBlob;
let recordedBuffer;
let processedBlob;
let timerId;
let startedAt = 0;

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setStatus(text, state = "") {
  statusText.textContent = text;
  statusDot.className = `status-dot ${state}`.trim();
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function startTimer() {
  startedAt = Date.now();
  timer.textContent = "00:00";
  timerId = window.setInterval(() => {
    timer.textContent = formatTime(Date.now() - startedAt);
  }, 250);
}

function stopTimer() {
  window.clearInterval(timerId);
  timerId = undefined;
}

function revokeUrl(element) {
  if (element.dataset.objectUrl) {
    URL.revokeObjectURL(element.dataset.objectUrl);
    delete element.dataset.objectUrl;
  }
}

function setAudioSource(element, blob) {
  revokeUrl(element);
  const url = URL.createObjectURL(blob);
  element.src = url;
  element.dataset.objectUrl = url;
}

function resetProcessed() {
  revokeUrl(processedAudio);
  revokeUrl(downloadLink);
  processedAudio.removeAttribute("src");
  processedAudio.load();
  processedBlob = undefined;
  playProcessedButton.disabled = true;
  downloadLink.removeAttribute("href");
  downloadLink.removeAttribute("download");
  downloadLink.classList.add("disabled");
  downloadLink.setAttribute("aria-disabled", "true");
}

function disablePlayback(disabled) {
  playOriginalButton.disabled = disabled || !recordedBlob;
  processButton.disabled = disabled || !recordedBuffer;
  playProcessedButton.disabled = disabled || !processedBlob;
  originalAudio.disabled = disabled;
  processedAudio.disabled = disabled;
}

function getRecorderMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function ensureSupported() {
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    throw new Error("マイク録音には HTTPS または localhost が必要です。");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("このブラウザはマイク取得に対応していません。");
  }
  if (!window.MediaRecorder) {
    throw new Error("このブラウザは MediaRecorder に対応していません。");
  }
  if (!AudioContextClass) {
    throw new Error("このブラウザは Web Audio API に対応していません。");
  }
}

async function decodeBlob(blob) {
  const audioContext = new AudioContextClass();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    await audioContext.close();
  }
}

async function startRecording() {
  try {
    ensureSupported();
    setMessage("");
    resetProcessed();
    recordedBlob = undefined;
    recordedBuffer = undefined;
    disablePlayback(true);
    revokeUrl(originalAudio);
    originalAudio.removeAttribute("src");
    originalAudio.load();

    // 録音中は再生を止めてハウリングを避ける。
    originalAudio.pause();
    processedAudio.pause();

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getRecorderMimeType();
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    chunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", handleRecordingStop, { once: true });
    mediaRecorder.start();
    startTimer();

    recordButton.disabled = true;
    stopButton.disabled = false;
    setStatus("録音中", "recording");
  } catch (error) {
    cleanupStream();
    recordButton.disabled = false;
    stopButton.disabled = true;
    disablePlayback(false);
    setStatus("エラー", "");
    setMessage(toJapaneseMicError(error), true);
  }
}

async function handleRecordingStop() {
  stopTimer();
  cleanupStream();
  recordButton.disabled = false;
  stopButton.disabled = true;

  try {
    recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
    if (!recordedBlob.size) throw new Error("録音データが空です。");
    setAudioSource(originalAudio, recordedBlob);
    recordedBuffer = await decodeBlob(recordedBlob);
    playOriginalButton.disabled = false;
    processButton.disabled = false;
    setStatus("録音完了", "ready");
    setMessage("録音できました。プリセットを選んで加工できます。");
  } catch (error) {
    setStatus("エラー", "");
    setMessage(`録音の読み込みに失敗しました。${error.message}`, true);
  }
}

function stopRecording() {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    disablePlayback(true);
    setStatus("処理中", "");
  }
}

function cleanupStream() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
}

function toJapaneseMicError(error) {
  if (error.name === "NotAllowedError") return "マイクの使用が許可されませんでした。ブラウザの権限設定を確認してください。";
  if (error.name === "NotFoundError") return "マイクが見つかりません。接続状態を確認してください。";
  if (error.name === "NotReadableError") return "マイクを使用できません。他のアプリが使用していないか確認してください。";
  return error.message || "マイクの取得に失敗しました。";
}

function cloneBuffer(audioBuffer) {
  const copy = new AudioBuffer({
    length: audioBuffer.length,
    numberOfChannels: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate,
  });
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    copy.copyToChannel(audioBuffer.getChannelData(channel), channel);
  }
  return copy;
}

function reverseBuffer(audioBuffer) {
  const reversed = cloneBuffer(audioBuffer);
  for (let channel = 0; channel < reversed.numberOfChannels; channel += 1) {
    reversed.getChannelData(channel).reverse();
  }
  return reversed;
}

function makeDistortionCurve(amount = 70) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

async function renderWithPreset(sourceBuffer, preset) {
  if (preset === "reverse") return reverseBuffer(sourceBuffer);

  const rate = preset === "low" ? 0.72 : preset === "high" ? 1.35 : 1;
  const duration = sourceBuffer.duration / rate + (preset === "echo" ? 1.2 : 0.2);
  const context = new OfflineAudioContext(
    sourceBuffer.numberOfChannels,
    Math.ceil(duration * sourceBuffer.sampleRate),
    sourceBuffer.sampleRate,
  );
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = sourceBuffer;
  source.playbackRate.value = rate;

  // プリセットごとに軽いエフェクトチェーンを組み替える。
  if (preset === "robot") {
    const shaper = context.createWaveShaper();
    const filter = context.createBiquadFilter();
    shaper.curve = makeDistortionCurve(120);
    shaper.oversample = "4x";
    filter.type = "bandpass";
    filter.frequency.value = 950;
    filter.Q.value = 7;
    source.connect(shaper).connect(filter).connect(output);
  } else if (preset === "echo") {
    const delay = context.createDelay(1.5);
    const feedback = context.createGain();
    const wet = context.createGain();
    delay.delayTime.value = 0.28;
    feedback.gain.value = 0.38;
    wet.gain.value = 0.55;
    source.connect(output);
    source.connect(delay).connect(wet).connect(output);
    delay.connect(feedback).connect(delay);
  } else if (preset === "radio") {
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const shaper = context.createWaveShaper();
    highpass.type = "highpass";
    highpass.frequency.value = 420;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 2600;
    shaper.curve = makeDistortionCurve(28);
    source.connect(highpass).connect(lowpass).connect(shaper).connect(output);
  } else {
    source.connect(output);
  }

  output.connect(context.destination);
  source.start(0);
  return context.startRendering();
}

function audioBufferToWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const dataLength = audioBuffer.length * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(value) {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    offset += value.length;
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataLength, true); offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, channels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * channels * bytesPerSample, true); offset += 4;
  view.setUint16(offset, channels * bytesPerSample, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString("data");
  view.setUint32(offset, dataLength, true); offset += 4;

  const channelData = Array.from({ length: channels }, (_, channel) => audioBuffer.getChannelData(channel));
  for (let i = 0; i < audioBuffer.length; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function processAudio() {
  if (!recordedBuffer) return;
  try {
    processButton.disabled = true;
    playProcessedButton.disabled = true;
    setStatus("加工中", "");
    setMessage("音声を加工しています。");

    const renderedBuffer = await renderWithPreset(recordedBuffer, presetSelect.value);
    processedBlob = audioBufferToWav(renderedBuffer);
    setAudioSource(processedAudio, processedBlob);
    setAudioSource(downloadLink, processedBlob);
    downloadLink.href = downloadLink.dataset.objectUrl;
    downloadLink.download = `voicefect-${presetSelect.value}.wav`;
    downloadLink.classList.remove("disabled");
    downloadLink.setAttribute("aria-disabled", "false");
    playProcessedButton.disabled = false;
    setStatus("加工完了", "ready");
    setMessage("加工後音声を再生・ダウンロードできます。");
  } catch (error) {
    setStatus("エラー", "");
    setMessage(`加工に失敗しました。${error.message}`, true);
  } finally {
    processButton.disabled = !recordedBuffer;
  }
}

function playAudio(element) {
  element.currentTime = 0;
  element.play().catch(() => {
    setMessage("音声を再生できませんでした。ブラウザの音声設定を確認してください。", true);
  });
}

recordButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopRecording);
processButton.addEventListener("click", processAudio);
playOriginalButton.addEventListener("click", () => playAudio(originalAudio));
playProcessedButton.addEventListener("click", () => playAudio(processedAudio));
presetSelect.addEventListener("change", resetProcessed);

try {
  ensureSupported();
  setStatus("録音できます", "ready");
  setMessage("録音開始を押すとマイク許可を求めます。");
} catch (error) {
  recordButton.disabled = true;
  setStatus("非対応", "");
  setMessage(error.message, true);
}
