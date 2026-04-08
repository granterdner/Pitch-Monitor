const startBtn = document.getElementById("startBtn");
const noteDisplay = document.getElementById("note");
const freqDisplay = document.getElementById("frequency");
const centsDisplay = document.getElementById("cents");
const targetNoteDisplay = document.getElementById("targetNote");
const pitchStatus = document.getElementById("pitchStatus");
const tunerNeedle = document.getElementById("tunerNeedle");
const pianoContainer = document.getElementById("piano");

const canvas = document.getElementById("pitchCanvas");
const ctx = canvas.getContext("2d");

let audioContext;
let analyser;
let dataArray;
let animationId;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const A4 = 440;
const MIN_MIDI = 48; // C3
const MAX_MIDI = 83; // B5
const visibleMidiNotes = [];
const pitchTrail = [];
const maxTrail = 240;

let smoothedPitch = null;
let currentMidi = null;

function midiToFreq(midi) {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / A4);
}

function midiToNoteName(midi) {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

function getNoteData(freq) {
  const midiFloat = freqToMidi(freq);
  const midiRounded = Math.round(midiFloat);
  const noteName = NOTE_NAMES[((midiRounded % 12) + 12) % 12];
  const octave = Math.floor(midiRounded / 12) - 1;
  const targetFreq = midiToFreq(midiRounded);
  const cents = 1200 * Math.log2(freq / targetFreq);

  return {
    freq,
    midiFloat,
    midiRounded,
    noteName,
    octave,
    cents,
    targetFreq
  };
}

function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  let rms = 0;

  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }

  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.012) return -1;

  let bestOffset = -1;
  let bestCorrelation = 0;
  const correlations = new Array(SIZE).fill(0);

  for (let offset = 8; offset < SIZE / 2; offset++) {
    let correlation = 0;

    for (let i = 0; i < SIZE / 2; i++) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }

    correlation = 1 - correlation / (SIZE / 2);
    correlations[offset] = correlation;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestCorrelation > 0.9 && bestOffset !== -1) {
    return sampleRate / bestOffset;
  }

  return -1;
}

function resizeCanvasForDisplay() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function buildVisibleNotes() {
  visibleMidiNotes.length = 0;
  for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi--) {
    visibleMidiNotes.push(midi);
  }
}

function isBlackKey(midi) {
  const n = ((midi % 12) + 12) % 12;
  return [1, 3, 6, 8, 10].includes(n);
}

function buildPiano() {
  pianoContainer.innerHTML = "";

  for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi--) {
    const key = document.createElement("div");
    key.className = `piano-key ${isBlackKey(midi) ? "black" : "white"}`;
    key.dataset.midi = midi;

    const left = document.createElement("span");
    left.textContent = midiToNoteName(midi);

    const right = document.createElement("span");
    right.textContent = `${midiToFreq(midi).toFixed(1)} Hz`;

    key.appendChild(left);
    key.appendChild(right);
    pianoContainer.appendChild(key);
  }
}

function updatePianoHighlight(midiRounded) {
  const keys = pianoContainer.querySelectorAll(".piano-key");
  keys.forEach(key => {
    key.classList.toggle("active", Number(key.dataset.midi) === midiRounded);
  });
}

function centsToStatus(cents) {
  const abs = Math.abs(cents);
  if (abs < 8) return { text: "In tune", color: "var(--success)" };
  if (cents < 0) return { text: "Flat", color: "var(--warning)" };
  return { text: "Sharp", color: "var(--danger)" };
}

function updateReadout(data) {
  noteDisplay.textContent = `${data.noteName}${data.octave}`;
  freqDisplay.textContent = `${data.freq.toFixed(2)} Hz`;
  centsDisplay.textContent = `${data.cents > 0 ? "+" : ""}${Math.round(data.cents)} cents`;
  targetNoteDisplay.textContent = `${data.noteName}${data.octave} • ${data.targetFreq.toFixed(2)} Hz`;

  const status = centsToStatus(data.cents);
  pitchStatus.textContent = status.text;
  pitchStatus.style.color = "#effcff";
  pitchStatus.style.background = `${status.color}22`;
  pitchStatus.style.borderColor = `${status.color}55`;

  const clamped = Math.max(-50, Math.min(50, data.cents));
  const percent = ((clamped + 50) / 100) * 100;
  tunerNeedle.style.left = `${percent}%`;

  updatePianoHighlight(data.midiRounded);
}

function showNoPitch() {
  noteDisplay.textContent = "--";
  freqDisplay.textContent = "0.00 Hz";
  centsDisplay.textContent = "0 cents";
  targetNoteDisplay.textContent = "--";
  pitchStatus.textContent = "Listening...";
  pitchStatus.style.background = "rgba(103, 232, 249, 0.12)";
  pitchStatus.style.borderColor = "rgba(103, 232, 249, 0.2)";
  tunerNeedle.style.left = "50%";
  updatePianoHighlight(null);
}

function getYForMidi(midiFloat) {
  const total = MAX_MIDI - MIN_MIDI + 1;
  const laneHeight = canvas.clientHeight / total;
  return (MAX_MIDI - midiFloat + 0.5) * laneHeight;
}

function drawBackgroundGrid() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const total = visibleMidiNotes.length;
  const laneHeight = h / total;

  ctx.clearRect(0, 0, w, h);

  for (let i = 0; i < total; i++) {
    const midi = visibleMidiNotes[i];
    const y = i * laneHeight;
    const black = isBlackKey(midi);

    ctx.fillStyle = black ? "rgba(82, 98, 124, 0.20)" : "rgba(255,255,255,0.03)";
    if (i % 2 === 0 && !black) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
    }
    ctx.fillRect(0, y, w, laneHeight);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();

    ctx.fillStyle = black ? "rgba(225,235,255,0.9)" : "rgba(180,197,225,0.9)";
    ctx.font = "12px Inter, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(midiToNoteName(midi), 12, y + laneHeight / 2);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(0, h - 1);
  ctx.lineTo(w, h - 1);
  ctx.stroke();
}

function drawPitchTrail() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  drawBackgroundGrid();

  if (pitchTrail.length < 2) return;

  const stepX = w / Math.max(1, maxTrail - 1);

  for (let i = 1; i < pitchTrail.length; i++) {
    const prev = pitchTrail[i - 1];
    const curr = pitchTrail[i];

    if (prev === null || curr === null) continue;

    const x1 = (i - 1) * stepX;
    const x2 = i * stepX;
    const y1 = getYForMidi(prev);
    const y2 = getYForMidi(curr);

    const alpha = i / pitchTrail.length;
    ctx.strokeStyle = `rgba(103, 232, 249, ${0.2 + alpha * 0.8})`;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  const latest = pitchTrail[pitchTrail.length - 1];
  if (latest !== null) {
    const x = (pitchTrail.length - 1) * stepX;
    const y = getYForMidi(latest);

    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(103,232,249,0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function pushPitchPoint(midiFloatOrNull) {
  pitchTrail.push(midiFloatOrNull);
  if (pitchTrail.length > maxTrail) {
    pitchTrail.shift();
  }
}

function updatePitch() {
  analyser.getFloatTimeDomainData(dataArray);
  const detected = autoCorrelate(dataArray, audioContext.sampleRate);

  if (detected !== -1 && detected >= 70 && detected <= 1200) {
    smoothedPitch = smoothedPitch == null ? detected : smoothedPitch * 0.82 + detected * 0.18;
    const data = getNoteData(smoothedPitch);
    currentMidi = data.midiRounded;
    updateReadout(data);
    pushPitchPoint(data.midiFloat);
  } else {
    smoothedPitch = null;
    currentMidi = null;
    showNoPitch();
    pushPitchPoint(null);
  }

  drawPitchTrail();
  animationId = requestAnimationFrame(updatePitch);
}

async function startMonitoring() {
  if (audioContext) return;

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Float32Array(analyser.fftSize);

    source.connect(analyser);

    startBtn.textContent = "Monitoring...";
    startBtn.disabled = true;

    updatePitch();
  } catch (error) {
    alert("Microphone access failed. Please allow mic access and try again.");
    console.error(error);
  }
}

window.addEventListener("resize", () => {
  resizeCanvasForDisplay();
  drawPitchTrail();
});

startBtn.addEventListener("click", startMonitoring);

buildVisibleNotes();
buildPiano();
resizeCanvasForDisplay();
drawPitchTrail();
showNoPitch();
