import { PitchDetector } from "https://cdn.skypack.dev/pitchy";

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const keySelect = document.getElementById("keySelect");

const noteDisplay = document.getElementById("note");
const freqDisplay = document.getElementById("frequency");
const centsDisplay = document.getElementById("cents");
const targetNoteDisplay = document.getElementById("targetNote");
const pitchStatus = document.getElementById("pitchStatus");
const tunerNeedle = document.getElementById("tunerNeedle");

const canvas = document.getElementById("pitchCanvas");
const ctx = canvas.getContext("2d");
const pianoRollKeyboard = document.getElementById("pianoRollKeyboard");

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const MAJOR_SCALES = {
  "C":  ["C", "D", "E", "F", "G", "A", "B"],
  "G":  ["G", "A", "B", "C", "D", "E", "F#"],
  "D":  ["D", "E", "F#", "G", "A", "B", "C#"],
  "A":  ["A", "B", "C#", "D", "E", "F#", "G#"],
  "E":  ["E", "F#", "G#", "A", "B", "C#", "D#"],
  "B":  ["B", "C#", "D#", "E", "F#", "G#", "A#"],
  "F#": ["F#", "G#", "A#", "B", "C#", "D#", "F"],
  "C#": ["C#", "D#", "F", "F#", "G#", "A#", "C"],
  "F":  ["F", "G", "A", "Bb", "C", "D", "E"],
  "Bb": ["Bb", "C", "D", "Eb", "F", "G", "A"],
  "Eb": ["Eb", "F", "G", "Ab", "Bb", "C", "D"],
  "Ab": ["Ab", "Bb", "C", "Db", "Eb", "F", "G"],
  "Db": ["Db", "Eb", "F", "Gb", "Ab", "Bb", "C"]
};

const A4 = 440;
const MIN_MIDI = 48; // C3
const MAX_MIDI = 83; // B5
const visibleMidiNotes = [];
const pitchTrail = [];
const maxTrail = 260;

let audioContext = null;
let analyser = null;
let dataArray = null;
let detector = null;
let inputBufferLength = 4096;
let animationId = null;
let micStream = null;

let smoothedPitch = null;
let lastStableMidi = null;

// --------------------
// Music helpers
// --------------------
function midiToFreq(midi) {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / A4);
}

function normalizeNoteName(name) {
  return name.replace("Db", "C#")
             .replace("Eb", "D#")
             .replace("Gb", "F#")
             .replace("Ab", "G#")
             .replace("Bb", "A#");
}

function getDisplayNameForScale(noteName, scaleKey) {
  if (scaleKey === "none") return noteName;

  const scale = MAJOR_SCALES[scaleKey];
  if (!scale) return noteName;

  const normalizedTarget = normalizeNoteName(noteName);

  for (const scaleNote of scale) {
    if (normalizeNoteName(scaleNote) === normalizedTarget) {
      return scaleNote;
    }
  }

  return noteName;
}

function midiToNoteName(midi, scaleKey = "none") {
  const rounded = Math.round(midi);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const baseName = NOTE_NAMES_SHARP[pitchClass];
  const octave = Math.floor(rounded / 12) - 1;
  const displayName = getDisplayNameForScale(baseName, scaleKey);
  return `${displayName}${octave}`;
}

function isBlackKey(midi) {
  const n = ((midi % 12) + 12) % 12;
  return [1, 3, 6, 8, 10].includes(n);
}

function getCurrentScalePitchClasses() {
  const selected = keySelect.value;
  if (selected === "none") return null;

  const scale = MAJOR_SCALES[selected];
  return new Set(scale.map(note => normalizeNoteName(note)));
}

function isMidiInSelectedScale(midi) {
  const scaleSet = getCurrentScalePitchClasses();
  if (!scaleSet) return false;

  const pitchClass = ((midi % 12) + 12) % 12;
  const name = NOTE_NAMES_SHARP[pitchClass];
  return scaleSet.has(normalizeNoteName(name));
}

function getNearestScaleMidi(midiFloat) {
  const scaleSet = getCurrentScalePitchClasses();
  if (!scaleSet) return Math.round(midiFloat);

  let bestMidi = Math.round(midiFloat);
  let bestDist = Infinity;

  for (let midi = MIN_MIDI; midi <= MAX_MIDI; midi++) {
    const pitchClass = ((midi % 12) + 12) % 12;
    const name = NOTE_NAMES_SHARP[pitchClass];

    if (scaleSet.has(normalizeNoteName(name))) {
      const dist = Math.abs(midi - midiFloat);
      if (dist < bestDist) {
        bestDist = dist;
        bestMidi = midi;
      }
    }
  }

  return bestMidi;
}

function getNoteData(freq) {
  const midiFloat = freqToMidi(freq);
  const midiRounded = Math.round(midiFloat);
  const targetMidi = getNearestScaleMidi(midiFloat);
  const targetFreq = midiToFreq(targetMidi);
  const cents = 1200 * Math.log2(freq / targetFreq);

  const pitchClass = ((midiRounded % 12) + 12) % 12;
  const noteNameBase = NOTE_NAMES_SHARP[pitchClass];
  const noteNameDisplay = getDisplayNameForScale(noteNameBase, keySelect.value);
  const octave = Math.floor(midiRounded / 12) - 1;

  return {
    freq,
    midiFloat,
    midiRounded,
    noteName: noteNameDisplay,
    octave,
    cents,
    targetMidi,
    targetFreq,
    targetNoteName: midiToNoteName(targetMidi, keySelect.value),
    inScale: isMidiInSelectedScale(midiRounded)
  };
}

// --------------------
// Pitchy detection
// --------------------
function detectPitchWithPitchy() {
  if (!analyser || !detector || !dataArray) return null;

  analyser.getFloatTimeDomainData(dataArray);

  const [pitch, clarity] = detector.findPitch(dataArray, audioContext.sampleRate);

  // Tune these thresholds if you want more or less sensitivity
  if (!pitch || !Number.isFinite(pitch)) return null;
  if (pitch < 70 || pitch > 1200) return null;
  if (clarity < 0.88) return null;

  return { pitch, clarity };
}

// --------------------
// Canvas / keyboard layout
// --------------------
function buildVisibleNotes() {
  visibleMidiNotes.length = 0;
  for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi--) {
    visibleMidiNotes.push(midi);
  }
}

function resizeCanvasForDisplay() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function getLaneHeight() {
  return canvas.clientHeight / visibleMidiNotes.length;
}

function buildRollKeyboard() {
  pianoRollKeyboard.innerHTML = "";
  const laneHeight = getLaneHeight();

  for (let index = 0; index < visibleMidiNotes.length; index++) {
    const midi = visibleMidiNotes[index];
    const key = document.createElement("div");
    key.className = `roll-key ${isBlackKey(midi) ? "black" : "white"}`;
    key.dataset.midi = midi;
    key.style.top = `${index * laneHeight}px`;
    key.style.height = `${laneHeight}px`;

    const noteSpan = document.createElement("span");
    noteSpan.textContent = midiToNoteName(midi, keySelect.value);

    key.appendChild(noteSpan);
    pianoRollKeyboard.appendChild(key);
  }

  updateKeyboardScaleHighlight();
}

function updateKeyboardScaleHighlight() {
  const keys = pianoRollKeyboard.querySelectorAll(".roll-key");
  keys.forEach((key) => {
    const midi = Number(key.dataset.midi);
    key.classList.toggle("in-key", isMidiInSelectedScale(midi));
    key.classList.toggle("active", midi === lastStableMidi);
    key.firstChild.textContent = midiToNoteName(midi, keySelect.value);
  });
}

function updateKeyboardActive(midiRounded) {
  lastStableMidi = midiRounded;
  const keys = pianoRollKeyboard.querySelectorAll(".roll-key");
  keys.forEach((key) => {
    key.classList.toggle("active", Number(key.dataset.midi) === midiRounded);
  });
}

// --------------------
// UI updates
// --------------------
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
  targetNoteDisplay.textContent = `${data.targetNoteName} • ${data.targetFreq.toFixed(2)} Hz`;

  const status = centsToStatus(data.cents);
  pitchStatus.textContent =
    data.inScale || keySelect.value === "none"
      ? status.text
      : `${status.text} • out of key`;

  pitchStatus.style.color = "#effcff";
  pitchStatus.style.background = `${status.color}22`;
  pitchStatus.style.borderColor = `${status.color}55`;

  const clamped = Math.max(-50, Math.min(50, data.cents));
  const percent = ((clamped + 50) / 100) * 100;
  tunerNeedle.style.left = `${percent}%`;

  updateKeyboardActive(data.midiRounded);
}

function showNoPitch() {
  noteDisplay.textContent = "--";
  freqDisplay.textContent = "0.00 Hz";
  centsDisplay.textContent = "0 cents";
  targetNoteDisplay.textContent = keySelect.value === "none" ? "--" : `${keySelect.value} Major`;
  pitchStatus.textContent = audioContext ? "Listening..." : "Ready";
  pitchStatus.style.background = "rgba(103, 232, 249, 0.12)";
  pitchStatus.style.borderColor = "rgba(103, 232, 249, 0.2)";
  tunerNeedle.style.left = "50%";
  updateKeyboardActive(null);
}

// --------------------
// Drawing
// --------------------
function getYForMidi(midiFloat) {
  const laneHeight = getLaneHeight();
  return (MAX_MIDI - midiFloat + 0.5) * laneHeight;
}

function drawBackgroundGrid() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const laneHeight = getLaneHeight();

  ctx.clearRect(0, 0, w, h);

  for (let i = 0; i < visibleMidiNotes.length; i++) {
    const midi = visibleMidiNotes[i];
    const y = i * laneHeight;
    const black = isBlackKey(midi);
    const inKey = isMidiInSelectedScale(midi);

    let fill = black ? "rgba(78, 91, 116, 0.18)" : "rgba(255,255,255,0.03)";
    if (!black && i % 2 === 0) fill = "rgba(255,255,255,0.05)";
    if (inKey) fill = black ? "rgba(103,232,249,0.12)" : "rgba(103,232,249,0.08)";

    ctx.fillStyle = fill;
    ctx.fillRect(0, y, w, laneHeight);

    ctx.strokeStyle = inKey ? "rgba(103,232,249,0.18)" : "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();

    ctx.fillStyle = inKey
      ? "rgba(210,247,255,0.92)"
      : (black ? "rgba(225,235,255,0.9)" : "rgba(180,197,225,0.9)");
    ctx.font = "12px Inter, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(midiToNoteName(midi, keySelect.value), 10, y + laneHeight / 2);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(0, h - 1);
  ctx.lineTo(w, h - 1);
  ctx.stroke();
}

function drawSmoothTrail() {
  drawBackgroundGrid();

  const points = [];
  const stepX = canvas.clientWidth / Math.max(1, maxTrail - 1);

  for (let i = 0; i < pitchTrail.length; i++) {
    if (pitchTrail[i] !== null) {
      points.push({
        x: i * stepX,
        y: getYForMidi(pitchTrail[i])
      });
    }
  }

  if (points.length < 2) return;

  ctx.save();
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(126, 240, 255, 0.95)";
  ctx.shadowColor = "rgba(103,232,249,0.30)";
  ctx.shadowBlur = 12;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    ctx.quadraticCurveTo(current.x, current.y, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();

  const latestTrailValue = pitchTrail[pitchTrail.length - 1];
  if (latestTrailValue !== null) {
    const latestX = (pitchTrail.length - 1) * stepX;
    const latestY = getYForMidi(latestTrailValue);

    ctx.beginPath();
    ctx.arc(latestX, latestY, 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(latestX, latestY, 16, 0, Math.PI * 2);
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

function clearPitchTrail() {
  pitchTrail.length = 0;
}

// --------------------
// Main update loop
// --------------------
function updatePitch() {
  if (!analyser || !audioContext || !detector) return;

  const result = detectPitchWithPitchy();

  if (result) {
    const detected = result.pitch;

    smoothedPitch = smoothedPitch == null
      ? detected
      : smoothedPitch * 0.84 + detected * 0.16;

    const data = getNoteData(smoothedPitch);
    updateReadout(data);
    pushPitchPoint(data.midiFloat);
  } else {
    smoothedPitch = null;
    showNoPitch();
    pushPitchPoint(null);
  }

  drawSmoothTrail();
  animationId = requestAnimationFrame(updatePitch);
}

// --------------------
// Controls
// --------------------
async function startMonitoring() {
  if (audioContext) return;

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const source = audioContext.createMediaStreamSource(micStream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = inputBufferLength;
    analyser.smoothingTimeConstant = 0;

    dataArray = new Float32Array(analyser.fftSize);
    detector = PitchDetector.forFloat32Array(analyser.fftSize);

    source.connect(analyser);

    clearPitchTrail();
    smoothedPitch = null;

    startBtn.disabled = true;
    stopBtn.disabled = false;

    pitchStatus.textContent = "Listening...";
    animationId = requestAnimationFrame(updatePitch);
  } catch (error) {
    alert("Microphone access failed. Please allow microphone access and try again.");
    console.error(error);
  }
}

function stopMonitoring() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  analyser = null;
  dataArray = null;
  detector = null;
  smoothedPitch = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;

  showNoPitch();
  drawSmoothTrail();
}

function handleScaleChange() {
  updateKeyboardScaleHighlight();
  drawSmoothTrail();

  if (!audioContext) {
    showNoPitch();
  }
}

// --------------------
// Init
// --------------------
window.addEventListener("resize", () => {
  resizeCanvasForDisplay();
  buildRollKeyboard();
  drawSmoothTrail();
});

startBtn.addEventListener("click", startMonitoring);
stopBtn.addEventListener("click", stopMonitoring);
keySelect.addEventListener("change", handleScaleChange);

buildVisibleNotes();
resizeCanvasForDisplay();
buildRollKeyboard();
drawSmoothTrail();
showNoPitch();