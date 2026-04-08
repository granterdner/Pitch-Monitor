const startBtn = document.getElementById("startBtn");
const noteDisplay = document.getElementById("note");
const freqDisplay = document.getElementById("frequency");
const centsDisplay = document.getElementById("cents");
const canvas = document.getElementById("graph");
const ctx = canvas.getContext("2d");

let audioContext;
let analyser;
let dataArray;
let bufferLength;

const noteStrings = ["C", "C#", "D", "D#", "E", "F",
                     "F#", "G", "G#", "A", "A#", "B"];

let pitchHistory = [];

// Convert frequency → note
function getNote(frequency) {
  const A4 = 440;
  const noteNum = 12 * (Math.log2(frequency / A4));
  const noteIndex = Math.round(noteNum) + 69;
  const noteName = noteStrings[noteIndex % 12];
  const octave = Math.floor(noteIndex / 12) - 1;
  return { noteName, octave, noteIndex };
}

// Calculate cents
function getCents(frequency, noteIndex) {
  const reference = 440 * Math.pow(2, (noteIndex - 69) / 12);
  return Math.floor(1200 * Math.log2(frequency / reference));
}

// Autocorrelation pitch detection
function autoCorrelate(buffer, sampleRate) {
  let SIZE = buffer.length;
  let rms = 0;

  for (let i = 0; i < SIZE; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = SIZE - 1, threshold = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buffer[SIZE - i]) < threshold) {
      r2 = SIZE - i;
      break;
    }
  }

  buffer = buffer.slice(r1, r2);
  SIZE = buffer.length;

  let c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE - i; j++) {
      c[i] = c[i] + buffer[j] * buffer[j + i];
    }
  }

  let d = 0;
  while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }

  let T0 = maxpos;
  return sampleRate / T0;
}

// Draw graph
function drawGraph(value) {
  pitchHistory.push(value);
  if (pitchHistory.length > canvas.width) {
    pitchHistory.shift();
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.beginPath();
  ctx.moveTo(0, canvas.height);

  for (let i = 0; i < pitchHistory.length; i++) {
    let y = canvas.height - pitchHistory[i] / 5;
    ctx.lineTo(i, y);
  }

  ctx.strokeStyle = "#22c55e";
  ctx.stroke();
}

function updatePitch() {
  analyser.getFloatTimeDomainData(dataArray);
  let pitch = autoCorrelate(dataArray, audioContext.sampleRate);

  if (pitch !== -1) {
    const { noteName, octave, noteIndex } = getNote(pitch);
    const cents = getCents(pitch, noteIndex);

    noteDisplay.innerText = noteName + octave;
    freqDisplay.innerText = pitch.toFixed(2) + " Hz";
    centsDisplay.innerText = cents + " cents";

    drawGraph(pitch);
  }

  requestAnimationFrame(updatePitch);
}

// Start mic
startBtn.onclick = async () => {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();

  analyser.fftSize = 2048;
  bufferLength = analyser.fftSize;
  dataArray = new Float32Array(bufferLength);

  source.connect(analyser);

  updatePitch();
};
