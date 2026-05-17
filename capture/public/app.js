import { connectPolarH10 } from './polar-client.js';

const PHASES = [
  { phase: 'CALIBRATION', title: 'Calibration', seconds: 15, instructions: 'Sit still and face the camera.' },
  { phase: 'BASELINE', title: 'Baseline HR Measurement', seconds: 180, instructions: 'Sit still for 3 minutes.' },
  { phase: 'EXERCISE', title: 'Progressive High-Knee March', seconds: 180, instructions: 'Complete the progressive high-knee march.' },
  { phase: 'ACTIVE_RECOVERY', title: 'Active Recovery', seconds: 30, instructions: 'Walk gently in place.' },
  { phase: 'RECALIBRATION', title: 'Recalibration', seconds: 15, instructions: 'Sit down and face the camera.' },
  { phase: 'STEADY_DELAY', title: 'Steady Delay', seconds: 5, instructions: 'Stay still while the signal settles.' },
  { phase: 'RECOVERY', title: 'Recovery HR Measurement', seconds: 180, instructions: 'Sit still for 3 minutes.' }
];

const dom = Object.fromEntries([
  'participant-id', 'btn-create-session', 'btn-connect-polar', 'btn-simulate-polar',
  'btn-start-camera', 'btn-start-capture', 'status', 'phase-title', 'phase-timer',
  'phase-instructions', 'phase-progress', 'video-layer', 'events-list'
].map((id) => [camel(id), document.getElementById(id)]));

const state = {
  session: null,
  stream: null,
  recorder: null,
  chunkIndex: 0,
  uploadChain: Promise.resolve(),
  polarSamples: [],
  events: [],
  syncMarkers: [],
  mockPolarTimer: null,
  recordingStartedPerfMs: null,
  recordingStartedWallTime: null,
  videoMimeType: ''
};

dom.btnCreateSession.addEventListener('click', createSession);
dom.btnConnectPolar.addEventListener('click', connectPolar);
dom.btnSimulatePolar.addEventListener('click', simulatePolar);
dom.btnStartCamera.addEventListener('click', startCamera);
dom.btnStartCapture.addEventListener('click', startCapture);

async function createSession() {
  const participantId = dom.participantId.value.trim();
  if (!participantId) return dom.participantId.focus();
  const response = await fetch('/api/capture/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, language: 'en' })
  });
  state.session = await response.json();
  setStatus(`Session ${state.session.sessionId}`);
  dom.btnConnectPolar.disabled = false;
  dom.btnSimulatePolar.disabled = false;
  dom.btnStartCamera.disabled = false;
  logEvent('session_start');
}

async function connectPolar() {
  await connectPolarH10((sample) => recordPolarSample(sample.hrBpm, sample.rrIntervalsMs));
  setStatus('Polar H10 connected');
  logEvent('polar_connected');
}

function simulatePolar() {
  clearInterval(state.mockPolarTimer);
  state.mockPolarTimer = setInterval(() => {
    recordPolarSample(Math.round(78 + 12 * Math.sin(performance.now() / 12000)), []);
  }, 1000);
  setStatus('Simulated Polar running');
  logEvent('polar_mock_start');
}

function recordPolarSample(hrBpm, rrIntervalsMs = []) {
  state.polarSamples.push({
    wallTime: new Date().toISOString(),
    perfMs: round(performance.now()),
    hrBpm,
    rrIntervalsMs
  });
}

async function startCamera() {
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: 640, height: 480 },
    audio: false
  });
  dom.videoLayer.srcObject = state.stream;
  await dom.videoLayer.play();
  dom.btnStartCapture.disabled = false;
  setStatus('Camera running');
  logEvent('camera_start');
}

async function startCapture() {
  dom.btnStartCapture.disabled = true;
  startRecorder();
  for (const phase of PHASES) {
    await runPhase(phase);
  }
  await stopRecorder();
  await finalizeMetadata();
  setStatus(`Capture saved: capture/data/sessions/${state.session.sessionId}`);
  logEvent('session_finish');
}

function startRecorder() {
  const options = chooseRecorderOptions();
  state.videoMimeType = options.mimeType || 'video/webm';
  state.recordingStartedPerfMs = performance.now();
  state.recordingStartedWallTime = new Date().toISOString();
  state.recorder = new MediaRecorder(state.stream, options);
  state.recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return;
    const chunkIndex = state.chunkIndex++;
    state.uploadChain = state.uploadChain.then(() => uploadChunk(event.data, chunkIndex));
  });
  state.recorder.start(1000);
  addSyncMarker('recording_start');
  logEvent('recording_start', { mimeType: state.videoMimeType });
}

function stopRecorder() {
  return new Promise((resolve, reject) => {
    state.recorder.addEventListener('stop', async () => {
      try {
        addSyncMarker('recording_stop');
        await state.uploadChain;
        const response = await fetch(`/api/capture/session/${encodeURIComponent(state.session.sessionId)}/finalize-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chunkCount: state.chunkIndex, mimeType: state.videoMimeType })
        });
        if (!response.ok) throw new Error(await response.text());
        resolve();
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    state.recorder.stop();
  });
}

async function uploadChunk(blob, chunkIndex) {
  const response = await fetch(`/api/capture/session/${encodeURIComponent(state.session.sessionId)}/video-chunk?chunkIndex=${chunkIndex}`, {
    method: 'POST',
    headers: { 'Content-Type': state.videoMimeType },
    body: blob
  });
  if (!response.ok) throw new Error(await response.text());
}

async function finalizeMetadata() {
  const response = await fetch(`/api/capture/session/${encodeURIComponent(state.session.sessionId)}/finalize-metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...state.session,
      recordingManifest: {
        recordingStartedPerfMs: round(state.recordingStartedPerfMs),
        recordingStartedWallTime: state.recordingStartedWallTime,
        recordingStoppedPerfMs: round(performance.now()),
        recordingStoppedWallTime: new Date().toISOString(),
        videoMimeType: state.videoMimeType,
        videoWidth: dom.videoLayer.videoWidth,
        videoHeight: dom.videoLayer.videoHeight,
        chunkCount: state.chunkIndex
      },
      polarSamples: state.polarSamples,
      events: state.events,
      syncMarkers: state.syncMarkers
    })
  });
  if (!response.ok) throw new Error(await response.text());
}

function runPhase({ phase, title, seconds, instructions }) {
  return new Promise((resolve) => {
    dom.phaseTitle.textContent = title;
    dom.phaseInstructions.textContent = instructions;
    logEvent('phase_start', { durationSec: seconds }, phase);
    let remaining = seconds;
    const started = performance.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((performance.now() - started) / 1000);
      remaining = Math.max(0, seconds - elapsed);
      dom.phaseTimer.textContent = formatSeconds(remaining);
      dom.phaseProgress.style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`;
      if (remaining <= 0) {
        clearInterval(timer);
        logEvent('phase_end', { durationSec: seconds }, phase);
        resolve();
      }
    }, 250);
  });
}

function logEvent(eventType, payload = {}, phase = '', intervalId = '') {
  const event = {
    wallTime: new Date().toISOString(),
    perfMs: round(performance.now()),
    eventType,
    phase,
    intervalId,
    payload
  };
  state.events.push(event);
  const li = document.createElement('li');
  li.textContent = `${new Date(event.wallTime).toLocaleTimeString()} ${eventType} ${phase}`;
  dom.eventsList.prepend(li);
}

function addSyncMarker(markerType, payload = {}) {
  state.syncMarkers.push({
    wallTime: new Date().toISOString(),
    perfMs: round(performance.now()),
    markerType,
    mediaTimeSec: round(dom.videoLayer.currentTime),
    payloadJson: JSON.stringify(payload)
  });
}

function chooseRecorderOptions() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : {};
}

function setStatus(message) {
  dom.status.textContent = message;
}

function formatSeconds(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function camel(id) {
  return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
