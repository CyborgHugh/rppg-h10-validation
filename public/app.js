import { PARAMS, RPPGPipeline } from './rppg-pipeline.js';
import { connectPolarH10 } from './polar-client.js';

const TEXT = {
  en: {
    appTitle: 'rPPG x Polar H10 Validation',
    subtitle: 'Local experiment runner for algorithm validation',
    setup: 'Setup',
    participant: 'Participant',
    startSession: 'Start Session',
    connectPolar: 'Connect Polar H10',
    mockPolar: 'Simulate Polar',
    startCamera: 'Start Camera',
    polarH10: 'Polar H10',
    camera: 'Camera',
    signal: 'rPPG Signal',
    notConnected: 'Not connected',
    notStarted: 'Not started',
    currentPhase: 'Current phase',
    waiting: 'Waiting',
    setupInstructions: 'Create a session, connect Polar H10, then start the camera.',
    recording: 'RECORDING',
    countPrompt: 'How many heartbeats did you count?',
    submit: 'Submit',
    startBaseline: 'Start Baseline HCT',
    startPractice: 'Start Practice Trial',
    startExercise: 'Start 3-Min Exercise',
    cameraPreview: 'Camera Preview',
    liveHr: 'Live HR Comparison',
    polar: 'Polar',
    events: 'Events',
    trialSummary: 'Trial Summary',
    noResults: 'Results will appear after the session is saved.',
    saveSession: 'Save Session',
    calibration: 'Signal Calibration',
    calibrationInstructions: 'Keep your face in view and stay still until the rPPG buffer is full.',
    baseline: 'Baseline HCT',
    baselineInstructions: 'Count your heartbeats silently without taking your pulse or checking a watch.',
    practice: 'Practice Trial',
    focus: 'Focus on your heartbeats...',
    count: 'COUNT',
    stop: 'STOP',
    rest: 'Rest',
    exercise: 'Activated State',
    exerciseInstructions: 'Stand up, push your chair back, and match each knee-up step to the metronome.',
    cooldown: 'Active Cool-Down',
    cooldownInstructions: 'Walk gently in place at 80 SPM.',
    preRecovery: 'Pre-Recovery',
    preRecoveryInstructions: 'Sit down immediately, face the camera, and stay perfectly still.',
    recovery: 'Recovery HCT',
    complete: 'Experiment Complete',
    locked: 'Locked',
    lost: 'Signal lost',
    saved: 'Session saved'
  },
  zh: {
    appTitle: 'rPPG x Polar H10 验证',
    subtitle: '本地算法验证实验运行器',
    setup: '设置',
    participant: '参与者',
    startSession: '开始会话',
    connectPolar: '连接 Polar H10',
    mockPolar: '模拟 Polar',
    startCamera: '开启摄像头',
    polarH10: 'Polar H10',
    camera: '摄像头',
    signal: 'rPPG 信号',
    notConnected: '未连接',
    notStarted: '未启动',
    currentPhase: '当前阶段',
    waiting: '等待中',
    setupInstructions: '创建会话、连接 Polar H10，然后开启摄像头。',
    recording: '记录中',
    countPrompt: '您数到了多少次心跳？',
    submit: '提交',
    startBaseline: '开始基线 HCT',
    startPractice: '开始练习测试',
    startExercise: '开始 3 分钟锻炼',
    cameraPreview: '摄像头预览',
    liveHr: '实时心率比较',
    polar: 'Polar',
    events: '事件',
    trialSummary: '测试汇总',
    noResults: '保存会话后会显示结果。',
    saveSession: '保存会话',
    calibration: '信号校准',
    calibrationInstructions: '请将脸部保持在画面内并保持静止，直到 rPPG 缓冲完成。',
    baseline: '基线 HCT',
    baselineInstructions: '请默默计算心跳，不要搭脉或看表。',
    practice: '练习测试',
    focus: '专注于您的心跳...',
    count: '开始计数',
    stop: '停止',
    rest: '休息',
    exercise: '激活状态',
    exerciseInstructions: '站起来，将椅子推后，并让每一步高抬腿都跟上节拍器。',
    cooldown: '积极冷身',
    cooldownInstructions: '以 80 SPM 轻柔原地走动。',
    preRecovery: '恢复前',
    preRecoveryInstructions: '请立即坐下，面向摄像头，并保持完全静止。',
    recovery: '恢复期 HCT',
    complete: '实验结束',
    locked: '已锁定',
    lost: '信号丢失',
    saved: '会话已保存'
  }
};

const dom = Object.fromEntries(
  [
    'language-select', 'participant-id', 'btn-session', 'btn-polar', 'btn-mock-polar', 'btn-camera',
    'btn-baseline', 'btn-practice', 'btn-exercise', 'btn-save', 'polar-status', 'camera-status',
    'signal-status', 'phase-title', 'phase-instructions', 'phase-timer', 'trial-card',
    'trial-title', 'recording-pill', 'hct-input', 'hct-count-input', 'btn-submit-hct',
    'stick-figure', 'video-layer', 'canvas-layer', 'hr-chart', 'events-list', 'results-output',
    'arm-left', 'arm-right', 'leg-left', 'leg-right'
  ].map((id) => [camel(id), document.getElementById(id)])
);

const state = {
  language: 'en',
  session: null,
  currentPhase: 'SETUP',
  hctPhase: null,
  baselineTrials: shuffle([30, 45, 60]),
  recoveryTrials: [30, 30, 30, 30],
  currentTrialIndex: 0,
  currentTrialId: null,
  trialStartPerfMs: 0,
  trialDurationSec: 0,
  currentObjCwtBeats: 0,
  currentObjLsBeats: 0,
  recoveryStartPerfMs: 0,
  events: [],
  polarSamples: [],
  rppgSamples: [],
  trials: [],
  faceFound: false,
  faceLossTime: null,
  lastRppgSamplePerfMs: 0,
  lastPolarBpm: null,
  polarMockTimer: null,
  audioCtx: null
};

const video = dom.videoLayer;
const canvas = dom.canvasLayer;
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const chartCtx = dom.hrChart.getContext('2d');

const pipeline = new RPPGPipeline({
  onProgress: (percent) => {
    dom.signalStatus.textContent = `${percent}%`;
    dom.signalStatus.className = `status ${percent >= 100 ? 'ok' : 'warn'}`;
  },
  onReady: () => {
    if (state.currentPhase === 'CALIBRATION') {
      dom.signalStatus.textContent = `${t('locked')} ${pipeline.cwtBpm.toFixed(0)} BPM`;
      dom.btnBaseline.disabled = false;
      if (!state.events.some((event) => event.eventType === 'rppg_signal_lock')) {
        logEvent('rppg_signal_lock', { cwtBpm: pipeline.cwtBpm, lsBpm: pipeline.lsBpm });
      }
    }
  },
  onHr: (sample) => {
    if (['BASELINE', 'RECOVERY'].includes(state.currentPhase) && sample.t - state.lastRppgSamplePerfMs >= 1000) {
      state.lastRppgSamplePerfMs = sample.t;
      state.rppgSamples.push({
        wallTime: new Date().toISOString(),
        perfMs: round(sample.t),
        phase: state.currentPhase,
        cwtBpm: round(sample.cwtBpm),
        lsBpm: round(sample.lsBpm)
      });
      drawChart();
    }
  }
});

applyLanguage();
wireEvents();
setPhase('SETUP', t('waiting'), t('setupInstructions'));

function wireEvents() {
  dom.languageSelect.addEventListener('change', () => {
    state.language = dom.languageSelect.value;
    document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
    applyLanguage();
  });
  dom.btnSession.addEventListener('click', createSession);
  dom.btnPolar.addEventListener('click', connectPolar);
  dom.btnMockPolar.addEventListener('click', startMockPolar);
  dom.btnCamera.addEventListener('click', startCamera);
  dom.btnBaseline.addEventListener('click', startPhase1);
  dom.btnPractice.addEventListener('click', startHctTrial);
  dom.btnExercise.addEventListener('click', runExercise);
  dom.btnSubmitHct.addEventListener('click', submitHctCount);
  dom.btnSave.addEventListener('click', saveSession);
}

async function createSession() {
  const participantId = dom.participantId.value.trim();
  if (!participantId) {
    dom.participantId.focus();
    return;
  }
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, language: state.language })
  });
  if (!response.ok) throw new Error(await response.text());
  state.session = await response.json();
  logEvent('session_start', { language: state.language });
  dom.btnPolar.disabled = false;
  dom.btnMockPolar.disabled = false;
  dom.btnCamera.disabled = false;
  dom.btnSave.disabled = false;
  dom.btnSession.disabled = true;
}

async function connectPolar() {
  try {
    await connectPolarH10((sample) => {
      state.lastPolarBpm = sample.hrBpm;
      state.polarSamples.push({
        wallTime: new Date().toISOString(),
        perfMs: round(performance.now()),
        hrBpm: sample.hrBpm,
        rrIntervalsMs: sample.rrIntervalsMs
      });
      drawChart();
    });
    setStatus(dom.polarStatus, `Connected`, 'ok');
    logEvent('polar_connected');
  } catch (error) {
    setStatus(dom.polarStatus, error.message, 'danger');
    logEvent('polar_connect_error', { message: error.message });
  }
}

function startMockPolar() {
  if (state.polarMockTimer) {
    clearInterval(state.polarMockTimer);
    state.polarMockTimer = null;
    return;
  }
  setStatus(dom.polarStatus, 'Simulated 1Hz', 'ok');
  logEvent('polar_mock_start');
  state.polarMockTimer = setInterval(() => {
    const bpm = Math.round(72 + 28 * Math.sin(performance.now() / 24000) + (state.currentPhase === 'EXERCISE' ? 35 : 0));
    state.lastPolarBpm = bpm;
    state.polarSamples.push({
      wallTime: new Date().toISOString(),
      perfMs: round(performance.now()),
      hrBpm: bpm,
      rrIntervalsMs: []
    });
    drawChart();
  }, 1000);
}

async function startCamera() {
  dom.btnCamera.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    faceMesh.onResults(onResults);
    const camera = new Camera(video, {
      onFrame: async () => faceMesh.send({ image: video }),
      width: 640,
      height: 480
    });
    await camera.start();
    setStatus(dom.cameraStatus, 'Running', 'ok');
    pipeline.reset();
    logEvent('camera_start');
    setPhase('CALIBRATION', t('calibration'), t('calibrationInstructions'));
  } catch (error) {
    setStatus(dom.cameraStatus, error.message, 'danger');
    dom.btnCamera.disabled = false;
  }
}

function onResults(results) {
  if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  if (canvas.width === 0) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  if (!['CALIBRATION', 'BASELINE', 'PRE_RECOVERY', 'RECOVERY'].includes(state.currentPhase)) return;

  const roi = extractFaceRoi(results);
  if (roi) {
    state.faceFound = true;
    state.faceLossTime = null;
    pipeline.pushFrame(roi.r, roi.g, roi.b, performance.now());
  } else {
    handleFaceLoss();
  }
}

function extractFaceRoi(results) {
  if (!results.multiFaceLandmarks?.length) return null;
  const landmarks = results.multiFaceLandmarks[0];
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const pt of landmarks) {
    minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
  }
  const width = canvas.width;
  const height = canvas.height;
  let x0 = Math.max(0, Math.floor(minX * width));
  let y0 = Math.max(0, Math.floor(minY * height));
  let w = Math.min(width - x0, Math.floor((maxX - minX) * width));
  let h = Math.min(height - y0, Math.floor((maxY - minY) * height * 0.6));
  ctx.strokeStyle = 'rgba(219, 39, 119, .85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, w, h);
  const imageData = ctx.getImageData(0, 0, width, height);
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (let y = y0; y < y0 + h; y += 2) {
    for (let x = x0; x < x0 + w; x += 2) {
      const idx = (y * width + x) * 4;
      const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
      const yVal = 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255;
      const cb = 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255;
      const cr = 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255;
      if (yVal > PARAMS.skin.yMin && cb >= PARAMS.skin.cbMin && cb <= PARAMS.skin.cbMax && cr >= PARAMS.skin.crMin && cr <= PARAMS.skin.crMax) {
        rSum += r; gSum += g; bSum += b; count += 1;
      }
    }
  }
  return count > (w * h / 4) * 0.05 ? { r: rSum / count, g: gSum / count, b: bSum / count } : null;
}

function handleFaceLoss() {
  if (state.faceFound) {
    state.faceLossTime = performance.now();
    state.faceFound = false;
  }
  if (state.faceLossTime && ['BASELINE', 'RECOVERY'].includes(state.currentPhase) && performance.now() - state.faceLossTime > 3000) {
    logEvent('trial_abort_face_loss', { trialId: state.currentTrialId });
    alert('Camera lost face tracking for more than 3 seconds. The current trial will restart.');
    startHctTrial();
  }
}

function startPhase1() {
  state.hctPhase = 'BASELINE';
  state.currentTrialIndex = -1;
  dom.btnBaseline.classList.add('hidden');
  dom.btnPractice.classList.remove('hidden');
  setPhase('BASELINE_READY', t('baseline'), t('baselineInstructions'));
  logEvent('baseline_instructions');
}

function startHctTrial() {
  dom.btnPractice.classList.add('hidden');
  dom.btnExercise.classList.add('hidden');
  dom.trialCard.classList.remove('hidden');
  dom.hctInput.classList.add('hidden');
  dom.recordingPill.classList.add('hidden');
  dom.trialTitle.textContent = t('focus');
  const isBaseline = state.hctPhase === 'BASELINE';
  const isPractice = isBaseline && state.currentTrialIndex === -1;
  const duration = isPractice ? 15 : isBaseline ? state.baselineTrials[state.currentTrialIndex] : state.recoveryTrials[state.currentTrialIndex];
  const phase = isPractice ? 'PRACTICE' : state.hctPhase;
  const trialNumber = isPractice ? 0 : state.currentTrialIndex + 1;
  state.trialDurationSec = duration;
  state.currentTrialId = isPractice ? 'practice' : `${state.hctPhase.toLowerCase()}-${trialNumber}`;
  if (state.hctPhase === 'BASELINE' && state.currentTrialIndex === 0 && !state.events.some((event) => event.eventType === 'phase_start' && event.phase === 'BASELINE')) {
    logEvent('phase_start', {}, 'BASELINE');
  }
  logEvent('trial_hint', { durationSec: duration }, phase, state.currentTrialId);
  setPhase(phase, isPractice ? t('practice') : `${t(state.hctPhase === 'BASELINE' ? 'baseline' : 'recovery')} ${trialNumber}`, t('focus'));

  setTimeout(() => {
    dom.trialTitle.textContent = t('count');
    dom.recordingPill.classList.remove('hidden');
    playTone(1000, 0.4, 'square', 2.0);
    pipeline.hrLog = [];
    const initialPosLength = pipeline.posBuffer.length;
    state.trialStartPerfMs = performance.now();
    logEvent('trial_start', { durationSec: duration }, phase, state.currentTrialId);
    setCountdown(duration, () => {
      playTone(500, 0.4, 'square', 2.0);
      dom.trialTitle.textContent = t('stop');
      dom.recordingPill.classList.add('hidden');
      const targetSamples = Math.floor(duration * PARAMS.targetFs);
      const trialSignal = pipeline.posBuffer.slice(-Math.min(pipeline.posBuffer.length - initialPosLength, targetSamples));
      state.currentObjCwtBeats = pipeline.countBeatsCWT(trialSignal, targetSamples);
      const validLs = pipeline.hrLog.filter((entry) => entry.t > state.trialStartPerfMs).map((entry) => entry.lsBpm);
      const avgLsHr = validLs.length ? validLs.reduce((sum, value) => sum + value, 0) / validLs.length : 0;
      state.currentObjLsBeats = (avgLsHr / 60) * duration;
      logEvent('trial_end', { cwtBeats: state.currentObjCwtBeats, lsBeats: state.currentObjLsBeats }, phase, state.currentTrialId);
      dom.hctInput.classList.remove('hidden');
      dom.hctCountInput.value = '';
      dom.hctCountInput.focus();
    });
  }, 3000);
}

function submitHctCount() {
  const subjectiveBeats = Number.parseInt(dom.hctCountInput.value, 10) || 0;
  const phase = state.hctPhase;
  const isPractice = phase === 'BASELINE' && state.currentTrialIndex === -1;
  logEvent('participant_input', { subjectiveBeats }, isPractice ? 'PRACTICE' : phase, state.currentTrialId);
  if (!isPractice) {
    state.trials.push({
      trialId: state.currentTrialId,
      phase,
      trialNumber: state.currentTrialIndex + 1,
      durationSec: state.trialDurationSec,
      startPerfMs: round(state.trialStartPerfMs),
      endPerfMs: round(performance.now()),
      subjectiveBeats,
      cwtBeats: round(state.currentObjCwtBeats),
      lsBeats: round(state.currentObjLsBeats)
    });
  }
  state.currentTrialIndex += 1;
  if (phase === 'BASELINE') {
    if (state.currentTrialIndex < state.baselineTrials.length) return runItiAndNext();
    logEvent('phase_end', {}, 'BASELINE');
    dom.trialCard.classList.add('hidden');
    dom.btnExercise.classList.remove('hidden');
    setPhase('EXERCISE_READY', t('exercise'), t('exerciseInstructions'));
  } else if (state.currentTrialIndex < state.recoveryTrials.length) {
    return runItiAndNext();
  } else {
    logEvent('phase_end', {}, 'RECOVERY');
    finishExperiment();
  }
}

function runItiAndNext() {
  dom.hctInput.classList.add('hidden');
  dom.trialTitle.textContent = t('rest');
  setCountdown(10, startHctTrial);
}

function runExercise() {
  setPhase('EXERCISE', t('exercise'), t('exerciseInstructions'));
  logEvent('exercise_start');
  dom.stickFigure.classList.remove('hidden');
  let total = 180;
  let pace = 80;
  let interval = null;
  const setPace = (nextPace) => {
    pace = nextPace;
    logEvent('exercise_pace_change', { spm: pace });
    if (interval) clearInterval(interval);
    interval = setInterval(() => { playTone(800, 0.1, 'square', 0.1); animateFigure(); }, 60000 / pace);
  };
  setPace(80);
  const timer = setInterval(() => {
    total -= 1;
    dom.phaseTimer.textContent = formatSeconds(total);
    if (total === 150) setPace(96);
    if (total === 120) setPace(112);
    if (total === 60) setPace(124);
    if (total <= 0) {
      clearInterval(timer);
      clearInterval(interval);
      dom.stickFigure.classList.add('hidden');
      runCooldown();
    }
  }, 1000);
}

function runCooldown() {
  setPhase('COOLDOWN', t('cooldown'), t('cooldownInstructions'));
  logEvent('cooldown_start');
  setCountdown(30, runPreRecovery);
}

function runPreRecovery() {
  pipeline.reset();
  setPhase('PRE_RECOVERY', t('preRecovery'), t('preRecoveryInstructions'));
  logEvent('pre_recovery_start');
  playTone(1000, 0.4, 'square', 0.2);
  setCountdown(10, startRecoveryPhase);
}

function startRecoveryPhase() {
  state.hctPhase = 'RECOVERY';
  state.currentTrialIndex = 0;
  state.recoveryStartPerfMs = performance.now();
  logEvent('phase_start', {}, 'RECOVERY');
  startHctTrial();
}

function finishExperiment() {
  setPhase('DONE', t('complete'), t('saveSession'));
  logEvent('session_finish');
  dom.trialCard.classList.add('hidden');
  dom.btnSave.disabled = false;
}

async function saveSession() {
  if (!state.session) return;
  dom.btnSave.disabled = true;
  const payload = {
    ...state.session,
    language: state.language,
    events: state.events,
    polarSamples: state.polarSamples,
    rppgSamples: state.rppgSamples,
    trials: state.trials
  };
  const response = await fetch(`/api/session/${encodeURIComponent(state.session.sessionId)}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Save failed');
  renderSummary(result.summary);
  setPhase('DONE', t('saved'), `${t('saved')}: data/sessions/${state.session.sessionId}`);
}

function renderSummary(summary) {
  const rows = summary.trialSummaries.map((trial) => `
    <tr>
      <td>${trial.trialId}</td>
      <td>${trial.durationSec}</td>
      <td>${fmt(trial.subjectiveBeats)}</td>
      <td>${fmt(trial.polarBeats)}</td>
      <td>${fmt(trial.cwtBeats)}</td>
      <td>${fmt(trial.cwtError?.absolutePercentError)}</td>
      <td>${fmt(trial.lsBeats)}</td>
      <td>${fmt(trial.lsError?.absolutePercentError)}</td>
    </tr>
  `).join('');
  dom.resultsOutput.innerHTML = `
    <table>
      <thead><tr><th>Trial</th><th>Duration</th><th>Subjective</th><th>Polar beats</th><th>CWT beats</th><th>CWT APE %</th><th>LS beats</th><th>LS APE %</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function logEvent(eventType, payload = {}, phase = state.currentPhase, trialId = state.currentTrialId) {
  if (!state.session && eventType !== 'session_start') return;
  const event = {
    wallTime: new Date().toISOString(),
    perfMs: round(performance.now()),
    eventType,
    phase,
    trialId,
    payload
  };
  state.events.push(event);
  const item = document.createElement('li');
  item.textContent = `${new Date(event.wallTime).toLocaleTimeString()} · ${eventType}${trialId ? ` · ${trialId}` : ''}`;
  dom.eventsList.prepend(item);
}

function setPhase(phase, title, instructions) {
  state.currentPhase = phase;
  dom.phaseTitle.textContent = title;
  dom.phaseInstructions.textContent = instructions;
  if (!dom.phaseTimer.textContent || dom.phaseTimer.textContent === '--') dom.phaseTimer.textContent = '--';
}

function setCountdown(seconds, onDone) {
  let remaining = seconds;
  dom.phaseTimer.textContent = formatSeconds(remaining);
  const timer = setInterval(() => {
    remaining -= 1;
    dom.phaseTimer.textContent = formatSeconds(remaining);
    if (remaining <= 0) {
      clearInterval(timer);
      onDone();
    }
  }, 1000);
}

function animateFigure() {
  const up = dom.legLeft.getAttribute('d').includes('L 30 60');
  if (up) {
    dom.legLeft.setAttribute('d', 'M 50 60 L 40 80 L 30 90');
    dom.legRight.setAttribute('d', 'M 50 60 L 70 60 L 70 90');
    dom.armLeft.setAttribute('d', 'M 50 40 L 30 50 L 20 40');
    dom.armRight.setAttribute('d', 'M 50 40 L 70 30 L 80 20');
  } else {
    dom.legLeft.setAttribute('d', 'M 50 60 L 30 60 L 30 90');
    dom.legRight.setAttribute('d', 'M 50 60 L 60 80 L 70 90');
    dom.armLeft.setAttribute('d', 'M 50 40 L 30 30 L 20 20');
    dom.armRight.setAttribute('d', 'M 50 40 L 70 50 L 80 40');
  }
}

function drawChart() {
  const width = dom.hrChart.width;
  const height = dom.hrChart.height;
  chartCtx.clearRect(0, 0, width, height);
  chartCtx.fillStyle = '#fbfdff';
  chartCtx.fillRect(0, 0, width, height);
  chartCtx.strokeStyle = '#d8e0ea';
  chartCtx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = 20 + i * ((height - 40) / 4);
    chartCtx.beginPath(); chartCtx.moveTo(40, y); chartCtx.lineTo(width - 10, y); chartCtx.stroke();
  }
  const now = performance.now();
  const windowMs = 180000;
  const polar = state.polarSamples.filter((s) => now - s.perfMs <= windowMs);
  const rppg = state.rppgSamples.filter((s) => now - s.perfMs <= windowMs);
  drawSeries(polar.map((s) => ({ x: s.perfMs, y: s.hrBpm })), '#0f9f8f', now, windowMs);
  drawSeries(rppg.map((s) => ({ x: s.perfMs, y: s.cwtBpm })), '#db2777', now, windowMs);
  drawSeries(rppg.map((s) => ({ x: s.perfMs, y: s.lsBpm })), '#2563eb', now, windowMs);
}

function drawSeries(points, color, now, windowMs) {
  if (points.length < 2) return;
  const width = dom.hrChart.width;
  const height = dom.hrChart.height;
  const xFor = (x) => 40 + ((x - (now - windowMs)) / windowMs) * (width - 55);
  const yFor = (y) => height - 20 - ((Math.max(45, Math.min(180, y)) - 45) / 135) * (height - 40);
  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(point.x);
    const y = yFor(point.y);
    if (index === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();
}

function playTone(freq, dur, type = 'sine', vol = 1) {
  state.audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  const osc = state.audioCtx.createOscillator();
  const gain = state.audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, state.audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + dur);
  osc.connect(gain);
  gain.connect(state.audioCtx.destination);
  osc.start();
  osc.stop(state.audioCtx.currentTime + dur);
}

function applyLanguage() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (TEXT[state.language][key]) node.textContent = TEXT[state.language][key];
  });
}

function t(key) { return TEXT[state.language][key] ?? key; }
function camel(id) { return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function setStatus(node, text, kind) { node.textContent = text; node.className = `status ${kind}`; }
function round(value, digits = 3) { return Number.isFinite(value) ? Number(value.toFixed(digits)) : value; }
function fmt(value) { return value === null || value === undefined ? '' : Number.isFinite(value) ? Number(value.toFixed(2)) : value; }
function formatSeconds(total) {
  const m = Math.floor(Math.max(0, total) / 60);
  const s = Math.max(0, total) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
