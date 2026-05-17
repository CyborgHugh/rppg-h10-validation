import { PARAMS, RPPGPipeline } from '/shared/algorithm/rppg-pipeline.js';
import { estimateMadanInterval } from '/shared/algorithm/madan-interval.js';
import { connectPolarH10 } from './polar-client.js';
import {
  analyzeRoiCandidates,
  combinePrimaryRois,
  faceBoxFromLandmarks
} from '/shared/algorithm/roi-utils.js';

const TEXT = {
  en: {
    appTitle: 'Simplified rPPG x Polar H10 Validation',
    subtitle: 'Baseline, exercise, recalibration, and recovery interval validation',
    setup: 'Setup',
    participant: 'Participant',
    startSession: 'Start Session',
    connectPolar: 'Connect Polar H10',
    mockPolar: 'Simulate Polar',
    startCamera: 'Start Camera',
    saveSession: 'Save Session',
    polarH10: 'Polar H10',
    camera: 'Camera',
    signal: 'rPPG Signal',
    notConnected: 'Not connected',
    notStarted: 'Not started',
    currentPhase: 'Current phase',
    waiting: 'Waiting',
    setupInstructions: 'Create a session, connect Polar H10, then start the camera.',
    activeWindow: 'Active window',
    notRunning: 'Not running',
    startProtocol: 'Start Baseline Measurement',
    cameraPreview: 'Camera Preview',
    liveHr: 'Live HR Comparison',
    polar: 'Polar',
    events: 'Events',
    intervals: 'Interval Counts',
    intervalsPending: 'Intervals will appear during baseline and recovery.',
    participantSummary: 'Participant Summary',
    noResults: 'Summary will appear after the session is saved.',
    calibration: 'Signal Calibration',
    calibrationInstructions: 'Keep your face in view and stay still until the rPPG buffer is ready.',
    baseline: 'Baseline HR Measurement',
    baselineInstructions: 'Sit still and face the camera for 3 minutes.',
    exercise: 'Progressive High-Knee March',
    exerciseInstructions: 'Match each knee-up step to the metronome as the pace progresses.',
    activeRecovery: 'Active Recovery',
    activeRecoveryInstructions: 'Walk gently in place at 80 SPM for 30 seconds.',
    recalibration: 'Recalibration',
    recalibrationInstructions: 'Sit down, face the camera, and stay still until signal lock returns.',
    recovery: 'Recovery HR Measurement',
    recoveryInstructions: 'Sit still and face the camera for 3 minutes.',
    complete: 'Experiment Complete',
    saved: 'Session saved',
    locked: 'Locked',
    lost: 'Signal lost'
  },
  zh: {
    appTitle: '简化版 rPPG x Polar H10 验证',
    subtitle: '基线、运动、重校准与恢复期区间验证',
    setup: '设置',
    participant: '参与者',
    startSession: '开始会话',
    connectPolar: '连接 Polar H10',
    mockPolar: '模拟 Polar',
    startCamera: '开启摄像头',
    saveSession: '保存会话',
    polarH10: 'Polar H10',
    camera: '摄像头',
    signal: 'rPPG 信号',
    notConnected: '未连接',
    notStarted: '未启动',
    currentPhase: '当前阶段',
    waiting: '等待中',
    setupInstructions: '创建会话、连接 Polar H10，然后开启摄像头。',
    activeWindow: '当前窗口',
    notRunning: '未运行',
    startProtocol: '开始基线测量',
    cameraPreview: '摄像头预览',
    liveHr: '实时心率比较',
    polar: 'Polar',
    events: '事件',
    intervals: '区间计数',
    intervalsPending: '基线和恢复期开始后会显示区间。',
    participantSummary: '参与者汇总',
    noResults: '保存会话后会显示汇总。',
    calibration: '信号校准',
    calibrationInstructions: '请将脸部保持在画面内并保持静止，直到 rPPG 缓冲就绪。',
    baseline: '基线心率测量',
    baselineInstructions: '请静坐并面向摄像头 3 分钟。',
    exercise: '渐进式高抬腿',
    exerciseInstructions: '按照节拍器进行高抬腿，节奏会逐步加快。',
    activeRecovery: '主动恢复',
    activeRecoveryInstructions: '以 80 SPM 轻柔原地走动 30 秒。',
    recalibration: '重新校准',
    recalibrationInstructions: '请坐下、面向摄像头并保持静止，直到信号重新锁定。',
    recovery: '恢复期心率测量',
    recoveryInstructions: '请静坐并面向摄像头 3 分钟。',
    complete: '实验完成',
    saved: '会话已保存',
    locked: '已锁定',
    lost: '信号丢失'
  }
};

const dom = Object.fromEntries(
  [
    'language-select', 'participant-id', 'btn-session', 'btn-polar', 'btn-mock-polar',
    'btn-camera', 'btn-protocol', 'btn-save', 'polar-status', 'camera-status',
    'signal-status', 'phase-title', 'phase-instructions', 'phase-timer',
    'interval-label', 'phase-progress', 'video-layer', 'canvas-layer', 'hr-chart',
    'events-list', 'intervals-output', 'results-output', 'stick-figure',
    'arm-left', 'arm-right', 'leg-left', 'leg-right'
  ].map((id) => [camel(id), document.getElementById(id)])
);

const state = {
  language: 'en',
  session: null,
  currentPhase: 'SETUP',
  events: [],
  polarSamples: [],
  rppgSamples: [],
  rppgDebugSamples: [],
  rppgRawSamples: [],
  rppgRoiCandidates: [],
  rppgSignalQualitySamples: [],
  cwtPowerDiagnostics: [],
  intervals: [],
  faceFound: false,
  faceLossTime: null,
  previousRoiCandidates: {},
  lastRppgSamplePerfMs: 0,
  lastPolarBpm: null,
  polarMockTimer: null,
  audioCtx: null,
  activeTimer: null,
  paceTimer: null,
  awaitingInitialLock: false,
  awaitingRecalibrationLock: false,
  protocolRunning: false
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
  onReady: (sample) => {
    if (state.currentPhase === 'CALIBRATION' && state.awaitingInitialLock) {
      state.awaitingInitialLock = false;
      setStatus(dom.signalStatus, `${t('locked')} ${sample.cwtBpm.toFixed(0)} BPM`, 'ok');
      dom.btnProtocol.disabled = false;
      logEvent('rppg_signal_lock', { cwtBpm: sample.cwtBpm, lsBpm: sample.lsBpm });
    }
    if (state.currentPhase === 'RECALIBRATION' && state.awaitingRecalibrationLock) {
      state.awaitingRecalibrationLock = false;
      setStatus(dom.signalStatus, `${t('locked')} ${sample.cwtBpm.toFixed(0)} BPM`, 'ok');
      logEvent('recalibration_signal_lock', { cwtBpm: sample.cwtBpm, lsBpm: sample.lsBpm });
      runSteadyDelay()
        .then(() => {
          logEvent('phase_end', {}, 'RECALIBRATION');
          return runMeasurementPhase('RECOVERY');
        })
        .then(finishExperiment);
    }
  },
  onHr: (sample) => {
    if (shouldStoreRppgSample(state.currentPhase) && sample.t - state.lastRppgSamplePerfMs >= 1000) {
      state.lastRppgSamplePerfMs = sample.t;
      state.rppgSamples.push({
        wallTime: new Date().toISOString(),
        perfMs: round(sample.t),
        phase: state.currentPhase,
        cwtBpm: round(sample.cwtBpm),
        lsBpm: round(sample.lsBpm),
        cwtRawBpm: round(sample.cwtRawBpm),
        cwtConstrainedBpm: round(sample.cwtConstrainedBpm),
        cwtSmoothedBpm: round(sample.cwtSmoothedBpm),
        cwtGatedBpm: round(sample.cwtGatedBpm),
        cwtAccepted: sample.cwtAccepted,
        cwtRawAccepted: sample.cwtRawAccepted,
        cwtGatedAccepted: sample.cwtGatedAccepted,
        cwtQuality: round(sample.cwtQuality),
        cwtRejectReason: sample.cwtRejectReason,
        cwtFallbackReason: sample.cwtFallbackReason,
        cwtPowerRatio: round(sample.cwtPowerRatio, 6),
        cwtLsDivergenceBpm: round(sample.cwtLsDivergenceBpm),
        cwtJumpBpm: round(sample.cwtJumpBpm),
        cwtCoverageRatio: round(sample.cwtCoverageRatio, 6),
        cwtDeltaBpm: round(sample.cwtDeltaBpm),
        cwtSearchLowBpm: round(sample.cwtSearchLowBpm),
        cwtSearchHighBpm: round(sample.cwtSearchHighBpm),
        targetFs: sample.targetFs,
        effectiveFrameRate: round(sample.effectiveFrameRate),
        frameGapCount: sample.frameGapCount,
        downsampleMode: sample.downsampleMode,
        antiAliasWindowMs: round(sample.antiAliasWindowMs),
        roiMode: sample.roiMode,
        roiComposition: sample.roiComposition,
        skinMode: sample.skinMode,
        interEyeDeltaPct: round(sample.interEyeDeltaPct),
        interEyeVelocityPctPerSec: round(sample.interEyeVelocityPctPerSec),
        patchAreaDeltaPct: round(sample.patchAreaDeltaPct),
        scaleJump: sample.scaleJump
      });
      state.rppgDebugSamples.push(buildRppgDebugSample(sample, 'hr_sample'));
      state.rppgSignalQualitySamples.push(buildSignalQualitySample(sample));
      state.cwtPowerDiagnostics.push(buildCwtPowerDiagnostic(sample));
      drawChart();
    }
  },
  onRawSample: (sample) => {
    if (shouldFeedRppg(state.currentPhase)) {
      state.rppgRawSamples.push({
        wallTime: new Date().toISOString(),
        phase: state.currentPhase,
        ...sample
      });
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
  dom.btnProtocol.addEventListener('click', startProtocol);
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
  dom.btnSession.disabled = true;
}

async function connectPolar() {
  try {
    await connectPolarH10((sample) => {
      recordPolarSample(sample.hrBpm, sample.rrIntervalsMs);
    });
    setStatus(dom.polarStatus, 'Connected', 'ok');
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
    const phaseBoost = state.currentPhase === 'EXERCISE' ? 45 : state.currentPhase === 'ACTIVE_RECOVERY' ? 25 : state.currentPhase === 'RECOVERY' ? 18 : 0;
    const bpm = Math.round(72 + phaseBoost + 8 * Math.sin(performance.now() / 17000));
    recordPolarSample(bpm, []);
  }, 1000);
}

function recordPolarSample(hrBpm, rrIntervalsMs) {
  state.lastPolarBpm = hrBpm;
  state.polarSamples.push({
    wallTime: new Date().toISOString(),
    perfMs: round(performance.now()),
    hrBpm,
    rrIntervalsMs
  });
  drawChart();
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
    state.awaitingInitialLock = true;
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
  if (!shouldFeedRppg(state.currentPhase)) return;

  const roi = extractFaceRoi(results);
  if (roi) {
    state.faceFound = true;
    state.faceLossTime = null;
    pipeline.pushFrame(roi.r, roi.g, roi.b, performance.now(), {
      phase: state.currentPhase,
      roiX: roi.x,
      roiY: roi.y,
      roiWidth: roi.width,
      roiHeight: roi.height,
      skinPixelCount: roi.skinPixelCount,
      sampledPixelCount: roi.sampledPixelCount,
      skinFraction: roi.skinFraction,
      hardSkinFraction: roi.hardSkinFraction,
      effectiveSkinPixelCount: roi.effectiveSkinPixelCount,
      effectiveSkinSampleCount: roi.effectiveSkinSampleCount,
      fixedSampleCount: roi.fixedSampleCount,
      roiMotionPx: roi.roiMotionPx,
      rgbJump: roi.rgbJump,
      faceRollDeg: roi.faceRollDeg,
      interEyeDistancePx: roi.interEyeDistancePx,
      interEyeDeltaPct: roi.interEyeDeltaPct,
      interEyeVelocityPctPerSec: roi.interEyeVelocityPctPerSec,
      patchAreaPx: roi.patchAreaPx,
      patchAreaDeltaPct: roi.patchAreaDeltaPct,
      scaleJump: roi.scaleJump,
      roiMode: roi.roiMode,
      skinMode: roi.skinMode,
      roiComposition: roi.roiComposition,
      roiRegionSet: roi.regionSet,
      roiCandidateCount: roi.candidateCount
    });
  } else {
    handleFaceLoss();
  }
}

function shouldFeedRppg(phase) {
  return ['CALIBRATION', 'BASELINE', 'RECALIBRATION', 'RECOVERY'].includes(phase);
}

function shouldStoreRppgSample(phase) {
  return ['BASELINE', 'RECOVERY'].includes(phase);
}

function extractFaceRoi(results) {
  if (!results.multiFaceLandmarks?.length) return null;
  const landmarks = results.multiFaceLandmarks[0];
  const width = canvas.width;
  const height = canvas.height;
  const faceBox = faceBoxFromLandmarks(landmarks, width, height);
  if (!faceBox) return null;
  const imageData = ctx.getImageData(0, 0, width, height);
  const perfMs = performance.now();
  const candidates = analyzeRoiCandidates({
    imageData,
    landmarks,
    faceBox,
    imageWidth: width,
    imageHeight: height,
    skinParams: PARAMS.skin,
    previousCandidates: state.previousRoiCandidates,
    mode: 'boxRectLegacy',
    skinMode: 'hardYcbcr',
    roiComposition: 'all',
    perfMs
  });
  state.previousRoiCandidates = Object.fromEntries(candidates.map((candidate) => [candidate.name, candidate]));
  const roi = combinePrimaryRois(candidates, { roiComposition: 'all' });

  const wallTime = new Date().toISOString();
  for (const candidate of candidates) {
    state.rppgRoiCandidates.push({
      wallTime,
      perfMs: round(perfMs),
      phase: state.currentPhase,
      roiName: candidate.name,
      roiMode: candidate.roiMode,
      roiComposition: candidate.roiComposition,
      skinMode: candidate.skinMode,
      roiX: candidate.x,
      roiY: candidate.y,
      roiWidth: candidate.width,
      roiHeight: candidate.height,
      roiCenterX: round(candidate.roiCenterX),
      roiCenterY: round(candidate.roiCenterY),
      roiMotionPx: round(candidate.roiMotionPx),
      rgbJump: round(candidate.rgbJump),
      faceRollDeg: round(candidate.faceRollDeg),
      interEyeDistancePx: round(candidate.interEyeDistancePx),
      interEyeDeltaPct: round(candidate.interEyeDeltaPct),
      interEyeVelocityPctPerSec: round(candidate.interEyeVelocityPctPerSec),
      patchAreaPx: round(candidate.patchAreaPx),
      patchAreaDeltaPct: round(candidate.patchAreaDeltaPct),
      fixedSampleCount: candidate.fixedSampleCount,
      effectiveSkinSampleCount: round(candidate.effectiveSkinSampleCount),
      scaleJump: candidate.scaleJump,
      polygonJson: candidate.polygonJson,
      normalizedPolygonJson: candidate.normalizedPolygonJson,
      skinPixelCount: candidate.skinPixelCount,
      hardSkinPixelCount: candidate.hardSkinPixelCount,
      effectiveSkinPixelCount: round(candidate.effectiveSkinPixelCount),
      sampledPixelCount: candidate.sampledPixelCount,
      skinFraction: round(candidate.skinFraction),
      hardSkinFraction: round(candidate.hardSkinFraction),
      effectiveSkinFraction: round(candidate.effectiveSkinFraction),
      skinFractionDelta: round(candidate.skinFractionDelta),
      accepted: candidate.accepted,
      rejectReason: candidate.rejectReason,
      roiR: round(candidate.r),
      roiG: round(candidate.g),
      roiB: round(candidate.b)
    });
  }

  if (!roi) return null;
  ctx.strokeStyle = 'rgba(219, 39, 119, .85)';
  ctx.lineWidth = 2;
  for (const candidate of candidates.filter((candidate) => candidate.accepted && candidate.name !== 'upperFace')) {
    if (candidate.shape === 'polygon' && candidate.points?.length) {
      ctx.beginPath();
      candidate.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeRect(candidate.x, candidate.y, candidate.width, candidate.height);
    }
  }
  return roi;
}

function handleFaceLoss() {
  if (state.faceFound) {
    state.faceLossTime = performance.now();
    state.faceFound = false;
  }
  if (state.faceLossTime && ['BASELINE', 'RECOVERY'].includes(state.currentPhase) && performance.now() - state.faceLossTime > 3000) {
    logEvent('face_loss_warning', { phase: state.currentPhase });
    setStatus(dom.signalStatus, t('lost'), 'danger');
  }
}

async function startProtocol() {
  if (state.protocolRunning) return;
  state.protocolRunning = true;
  dom.btnProtocol.disabled = true;
  dom.btnSave.disabled = true;
  state.intervals = [];
  renderIntervals();
  await runMeasurementPhase('BASELINE');
  await runExercise();
  await runActiveRecovery();
  runRecalibration();
}

async function runMeasurementPhase(phase) {
  const title = phase === 'BASELINE' ? t('baseline') : t('recovery');
  const instructions = phase === 'BASELINE' ? t('baselineInstructions') : t('recoveryInstructions');
  setPhase(phase, title, instructions);
  logEvent('phase_start', {}, phase);
  for (let index = 1; index <= 6; index += 1) {
    await runInterval(phase, index);
  }
  logEvent('phase_end', {}, phase);
}

function runInterval(phase, intervalNumber) {
  return new Promise((resolve) => {
    const intervalId = `${phase.toLowerCase()}-${intervalNumber}`;
    const durationSec = 30;
    const startPerfMs = performance.now();
    const posStartLength = pipeline.posBuffer.length;
    logEvent('interval_start', { durationSec }, phase, intervalId);
    updateIntervalLabel(phase, intervalNumber);
    runCountdown(durationSec, (remaining, elapsed) => {
      dom.phaseProgress.style.width = `${Math.min(100, ((intervalNumber - 1) * 30 + elapsed) / 180 * 100)}%`;
    }, () => {
      const endPerfMs = performance.now();
      const targetSamples = Math.floor(durationSec * pipeline.targetFs);
      const newSamples = Math.max(0, pipeline.posBuffer.length - posStartLength);
      const trialSignal = pipeline.posBuffer.slice(-Math.min(newSamples, targetSamples));
      const cwtBeats = pipeline.countBeatsCWT(trialSignal, targetSamples);
      state.rppgDebugSamples.push(buildRppgDebugSample({ t: endPerfMs, cwtBpm: pipeline.cwtBpm, lsBpm: pipeline.lsBpm }, 'interval_count', intervalId));
      const cwtTrust = summarizeIntervalCwtTrust(startPerfMs, endPerfMs);
      const intervalHrRows = pipeline.hrLog.filter((entry) => entry.t >= startPerfMs && entry.t <= endPerfMs);
      const validLs = intervalHrRows.map((entry) => entry.lsBpm);
      const avgLsHr = validLs.length ? validLs.reduce((sum, value) => sum + value, 0) / validLs.length : 0;
      const lsBeats = (avgLsHr / 60) * durationSec;
      const madan = estimateMadanForWindow(startPerfMs, endPerfMs, durationSec);
      const interval = {
        intervalId,
        phase,
        intervalNumber,
        startPerfMs: round(startPerfMs),
        endPerfMs: round(endPerfMs),
        cwtBeats: round(cwtBeats),
        cwtRawBeats: round(cwtBeats),
        cwtAcceptedRatio: cwtTrust.acceptedRatio,
        cwtMeanQuality: cwtTrust.meanQuality,
        cwtTrust: cwtTrust.trust,
        lsBeats: round(lsBeats),
        madanPcaCwtBeats: round(madan.pca.beatCount),
        madanPcaCwtMedianBpm: round(madan.pca.medianBpm),
        madanPcaCwtQuality: madan.pca.quality,
        madanPosCwtBeats: round(madan.pos.beatCount),
        madanPosCwtMedianBpm: round(madan.pos.medianBpm),
        madanPosCwtQuality: madan.pos.quality
      };
      state.intervals.push(interval);
      logEvent('interval_end', {
        cwtBeats,
        lsBeats,
        madanPcaCwtBeats: madan.pca.beatCount,
        madanPosCwtBeats: madan.pos.beatCount
      }, phase, intervalId);
      renderIntervals();
      resolve();
    });
  });
}

function runExercise() {
  return new Promise((resolve) => {
    setPhase('EXERCISE', t('exercise'), t('exerciseInstructions'));
    updateIntervalLabel('EXERCISE', null);
    logEvent('exercise_start');
    dom.phaseProgress.style.width = '0%';
    dom.stickFigure.classList.remove('hidden');
    let total = 180;
    let pace = 80;
    const setPace = (nextPace) => {
      pace = nextPace;
      logEvent('exercise_pace_change', { spm: pace });
      if (state.paceTimer) clearInterval(state.paceTimer);
      state.paceTimer = setInterval(() => { playTone(800, 0.1, 'square', 0.1); animateFigure(); }, 60000 / pace);
    };
    setPace(80);
    runCountdown(total, (remaining, elapsed) => {
      dom.phaseProgress.style.width = `${Math.min(100, elapsed / 180 * 100)}%`;
      if (remaining === 150) setPace(96);
      if (remaining === 120) setPace(112);
      if (remaining === 60) setPace(124);
    }, () => {
      clearInterval(state.paceTimer);
      state.paceTimer = null;
      dom.stickFigure.classList.add('hidden');
      logEvent('exercise_end');
      resolve();
    });
  });
}

function runActiveRecovery() {
  return new Promise((resolve) => {
    setPhase('ACTIVE_RECOVERY', t('activeRecovery'), t('activeRecoveryInstructions'));
    updateIntervalLabel('ACTIVE_RECOVERY', null);
    logEvent('active_recovery_start');
    dom.phaseProgress.style.width = '0%';
    state.paceTimer = setInterval(() => { playTone(650, 0.08, 'square', 0.08); animateFigure(); }, 60000 / 80);
    dom.stickFigure.classList.remove('hidden');
    runCountdown(30, (remaining, elapsed) => {
      dom.phaseProgress.style.width = `${Math.min(100, elapsed / 30 * 100)}%`;
    }, () => {
      clearInterval(state.paceTimer);
      state.paceTimer = null;
      dom.stickFigure.classList.add('hidden');
      logEvent('active_recovery_end');
      resolve();
    });
  });
}

function runRecalibration() {
  pipeline.reset();
  state.lastRppgSamplePerfMs = 0;
  state.awaitingRecalibrationLock = true;
  dom.phaseProgress.style.width = '0%';
  setPhase('RECALIBRATION', t('recalibration'), t('recalibrationInstructions'));
  logEvent('phase_start', {}, 'RECALIBRATION');
  logEvent('recalibration_start');
  dom.phaseTimer.textContent = '--';
  playTone(1000, 0.4, 'square', 0.2);
}

function runSteadyDelay() {
  return new Promise((resolve) => {
    updateIntervalLabel('RECALIBRATION_STEADY', null);
    dom.phaseProgress.style.width = '0%';
    runCountdown(5, (remaining, elapsed) => {
      dom.phaseProgress.style.width = `${Math.min(100, elapsed / 5 * 100)}%`;
    }, resolve);
  });
}

function finishExperiment() {
  state.protocolRunning = false;
  dom.phaseProgress.style.width = '100%';
  setPhase('DONE', t('complete'), t('saveSession'));
  updateIntervalLabel('DONE', null);
  logEvent('session_finish');
  dom.btnSave.disabled = false;
}

function summarizeIntervalCwtTrust(startPerfMs, endPerfMs) {
  const rows = state.rppgSignalQualitySamples.filter((sample) => (
    sample.perfMs >= startPerfMs && sample.perfMs <= endPerfMs && Number.isFinite(sample.cwtQuality)
  ));
  if (!rows.length) return { acceptedRatio: null, meanQuality: null, trust: 'unknown' };
  const accepted = rows.filter((sample) => sample.cwtAccepted).length;
  const acceptedRatio = accepted / rows.length;
  const meanQuality = rows.reduce((sum, sample) => sum + sample.cwtQuality, 0) / rows.length;
  return {
    acceptedRatio: round(acceptedRatio),
    meanQuality: round(meanQuality),
    trust: acceptedRatio >= 0.8 && meanQuality >= 0.65 ? 'high' : acceptedRatio >= 0.5 ? 'caution' : 'low'
  };
}

function estimateMadanForWindow(startPerfMs, endPerfMs, durationSec) {
  const windowSamples = state.rppgRawSamples.filter((sample) => sample.perfMs >= startPerfMs && sample.perfMs <= endPerfMs);
  return estimateMadanInterval({
    rgbSamples: windowSamples.filter((sample) => sample.debugType === 'frame'),
    posSamples: windowSamples.filter((sample) => sample.debugType === 'pos_sample'),
    startPerfMs,
    endPerfMs,
    durationSec
  });
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
    rppgDebugSamples: state.rppgDebugSamples,
    rppgRawSamples: state.rppgRawSamples,
    rppgRoiCandidates: state.rppgRoiCandidates,
    rppgSignalQualitySamples: state.rppgSignalQualitySamples,
    cwtPowerDiagnostics: state.cwtPowerDiagnostics,
    intervals: state.intervals
  };
  const response = await fetch(`/api/session/${encodeURIComponent(state.session.sessionId)}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Save failed');
  renderSummary(result.summary);
  setPhase('DONE', t('saved'), `${t('saved')}: simplified/data/sessions/${state.session.sessionId}`);
}

function renderIntervals(intervals = state.intervals) {
  if (!intervals.length) {
    dom.intervalsOutput.innerHTML = `<p class="muted">${t('intervalsPending')}</p>`;
    return;
  }
  const rows = intervals.map((interval) => `
    <tr>
      <td>${interval.intervalId}</td>
      <td>${interval.phase}</td>
      <td>${fmt(interval.cwtRawBeats ?? interval.cwtBeats)}</td>
      <td>${interval.cwtTrust ?? 'unknown'}</td>
      <td>${fmt(interval.lsBeats)}</td>
      <td>${fmt(interval.madanPcaCwtBeats)}</td>
      <td>${fmt(interval.madanPosCwtBeats)}</td>
    </tr>
  `).join('');
  dom.intervalsOutput.innerHTML = `
    <table>
      <thead><tr><th>Interval</th><th>Phase</th><th>CWT raw beats</th><th>CWT trust</th><th>LS beats</th><th>Madan PCA CWT</th><th>Madan POS CWT</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderSummary(summary) {
  const intervalRows = summary.intervalSummaries.map((interval) => `
    <tr>
      <td>${interval.intervalId}</td>
      <td>${interval.durationSec}</td>
      <td>${fmt(interval.polarBeats)}</td>
      <td>${fmt(interval.cwtRawBeats ?? interval.cwtBeats)}</td>
      <td>${fmt(interval.cwtError?.absolutePercentError)}</td>
      <td>${interval.cwtTrust ?? 'unknown'}</td>
      <td>${fmt(interval.lsBeats)}</td>
      <td>${fmt(interval.lsError?.absolutePercentError)}</td>
      <td>${fmt(interval.madanPcaCwtBeats)}</td>
      <td>${fmt(interval.madanPcaCwtError?.absolutePercentError)}</td>
      <td>${fmt(interval.madanPosCwtBeats)}</td>
      <td>${fmt(interval.madanPosCwtError?.absolutePercentError)}</td>
    </tr>
  `).join('');
  dom.intervalsOutput.innerHTML = `
    <table>
      <thead><tr><th>Interval</th><th>Duration</th><th>Polar beats</th><th>CWT raw beats</th><th>CWT raw APE %</th><th>CWT trust</th><th>LS beats</th><th>LS APE %</th><th>Madan PCA beats</th><th>Madan PCA APE %</th><th>Madan POS beats</th><th>Madan POS APE %</th></tr></thead>
      <tbody>${intervalRows}</tbody>
    </table>
  `;
  dom.resultsOutput.innerHTML = `
    ${renderCwtDiagnosticSummary(summary.intervalSummaries)}
    <div class="metric-grid">
      ${renderMetricCard('Total', summary.beatCountIndices.TOTAL)}
      ${renderMetricCard('Baseline', summary.beatCountIndices.BASELINE)}
      ${renderMetricCard('Recovery', summary.beatCountIndices.RECOVERY)}
    </div>
  `;
}

function renderCwtDiagnosticSummary(intervals) {
  const rows = intervals.map((interval) => `
    <tr>
      <td>${interval.intervalId}</td>
      <td>${interval.cwtTrust ?? 'unknown'}</td>
      <td>${fmt(interval.cwtAcceptedRatio)}</td>
      <td>${fmt(interval.cwtMeanQuality)}</td>
    </tr>
  `).join('');
  return `
    <h3>CWT diagnostics</h3>
    <table>
      <thead><tr><th>Interval</th><th>Trust</th><th>Accepted ratio</th><th>Mean quality</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMetricCard(title, group) {
  return `
    <div class="metric-card">
      <h3>${title}</h3>
      <dl>
        <dt>CWT alignment</dt><dd>${fmt(group.cwt.alignmentIndex)}</dd>
        <dt>CWT inconsistency</dt><dd>${fmt(group.cwt.inconsistencyIndex)}</dd>
        <dt>LS alignment</dt><dd>${fmt(group.ls.alignmentIndex)}</dd>
        <dt>LS inconsistency</dt><dd>${fmt(group.ls.inconsistencyIndex)}</dd>
        <dt>Madan PCA alignment</dt><dd>${fmt(group.madanPcaCwt?.alignmentIndex)}</dd>
        <dt>Madan PCA inconsistency</dt><dd>${fmt(group.madanPcaCwt?.inconsistencyIndex)}</dd>
        <dt>Madan POS alignment</dt><dd>${fmt(group.madanPosCwt?.alignmentIndex)}</dd>
        <dt>Madan POS inconsistency</dt><dd>${fmt(group.madanPosCwt?.inconsistencyIndex)}</dd>
      </dl>
    </div>
  `;
}

function logEvent(eventType, payload = {}, phase = state.currentPhase, intervalId = '') {
  if (!state.session && eventType !== 'session_start') return;
  const event = {
    wallTime: new Date().toISOString(),
    perfMs: round(performance.now()),
    eventType,
    phase,
    intervalId,
    payload
  };
  state.events.push(event);
  const item = document.createElement('li');
  item.textContent = `${new Date(event.wallTime).toLocaleTimeString()} - ${eventType}${intervalId ? ` - ${intervalId}` : ''}`;
  dom.eventsList.prepend(item);
}

function buildRppgDebugSample(sample, debugType, intervalId = '') {
  const cwt = pipeline.lastCwtDebug ?? {};
  const count = pipeline.lastCwtCountDebug ?? {};
  const frame = pipeline.lastFrameDebug ?? {};
  const diagnostic = pipeline.lastCwtDiagnostic ?? {};
  return {
    wallTime: new Date().toISOString(),
    perfMs: round(sample.t),
    debugType,
    phase: state.currentPhase,
    intervalId,
    cwtBpm: round(sample.cwtBpm),
    lsBpm: round(sample.lsBpm),
    cwtRawBpm: round(sample.cwtRawBpm ?? diagnostic.cwtRawBpm),
    cwtConstrainedBpm: round(sample.cwtConstrainedBpm ?? diagnostic.cwtConstrainedBpm),
    cwtSmoothedBpm: round(sample.cwtSmoothedBpm ?? diagnostic.cwtSmoothedBpm),
    cwtGatedBpm: round(sample.cwtGatedBpm ?? diagnostic.cwtGatedBpm),
    cwtAccepted: sample.cwtAccepted ?? diagnostic.cwtAccepted,
    cwtRawAccepted: sample.cwtRawAccepted ?? diagnostic.cwtRawAccepted,
    cwtGatedAccepted: sample.cwtGatedAccepted ?? diagnostic.cwtGatedAccepted,
    cwtQuality: round(sample.cwtQuality ?? diagnostic.cwtQuality),
    cwtRejectReason: sample.cwtRejectReason ?? diagnostic.cwtRejectReason,
    cwtFallbackReason: sample.cwtFallbackReason ?? diagnostic.cwtFallbackReason,
    cwtLsDivergenceBpm: round(sample.cwtLsDivergenceBpm ?? diagnostic.cwtLsDivergenceBpm),
    cwtJumpBpm: round(sample.cwtJumpBpm ?? diagnostic.cwtJumpBpm),
    cwtCoverageRatio: round(sample.cwtCoverageRatio ?? diagnostic.cwtCoverageRatio),
    cwtDeltaBpm: round(sample.cwtDeltaBpm ?? diagnostic.cwtDeltaBpm),
    cwtSearchLowBpm: round(sample.cwtSearchLowBpm ?? diagnostic.cwtSearchLowBpm),
    cwtSearchHighBpm: round(sample.cwtSearchHighBpm ?? diagnostic.cwtSearchHighBpm),
    roiR: round(frame.r),
    roiG: round(frame.g),
    roiB: round(frame.b),
    roiRegionSet: frame.roiRegionSet,
    roiMotionPx: round(frame.roiMotionPx),
    rgbJump: round(frame.rgbJump),
    faceRollDeg: round(frame.faceRollDeg),
    interEyeDistancePx: round(frame.interEyeDistancePx),
    interEyeDeltaPct: round(frame.interEyeDeltaPct),
    interEyeVelocityPctPerSec: round(frame.interEyeVelocityPctPerSec),
    patchAreaPx: round(frame.patchAreaPx),
    patchAreaDeltaPct: round(frame.patchAreaDeltaPct),
    fixedSampleCount: frame.fixedSampleCount,
    effectiveSkinSampleCount: round(frame.effectiveSkinSampleCount),
    scaleJump: frame.scaleJump,
    roiComposition: frame.roiComposition,
    roiSkinFraction: round(frame.skinFraction),
    cwtWindowSamples: cwt.windowSamples,
    cwtWindowSec: cwt.windowSec,
    cwtBestPower: cwt.bestPower,
    cwtSecondBpm: cwt.secondBpm,
    cwtSecondPower: cwt.secondPower,
    cwtPowerRatio: cwt.powerRatio,
    cwtSignalMedian: cwt.signalMedian,
    cwtSignalMad: cwt.signalMad,
    cwtSignalScale: cwt.signalScale,
    cwtSignalMaxAbsZ: cwt.signalMaxAbsZ,
    signalClippedFraction: cwt.signalClippedFraction,
    cwtCountRawPeaks: count.rawPeakCount,
    cwtCountValidPeaks: count.validPeakCount,
    cwtTopCandidatesJson: JSON.stringify(cwt.topCandidates ?? [])
  };
}

function buildSignalQualitySample(sample) {
  const cwt = pipeline.lastCwtDebug ?? {};
  const frame = pipeline.lastFrameDebug ?? {};
  return {
    wallTime: new Date().toISOString(),
    perfMs: round(sample.t),
    phase: state.currentPhase,
    roiRegionSet: frame.roiRegionSet,
    roiSkinFraction: round(frame.skinFraction),
    hardSkinFraction: round(frame.hardSkinFraction),
    effectiveSkinPixelCount: round(frame.effectiveSkinPixelCount),
    effectiveSkinSampleCount: round(frame.effectiveSkinSampleCount),
    fixedSampleCount: frame.fixedSampleCount,
    roiMotionPx: round(frame.roiMotionPx),
    rgbJump: round(frame.rgbJump),
    faceRollDeg: round(frame.faceRollDeg),
    interEyeDistancePx: round(frame.interEyeDistancePx),
    interEyeDeltaPct: round(frame.interEyeDeltaPct),
    interEyeVelocityPctPerSec: round(frame.interEyeVelocityPctPerSec),
    patchAreaPx: round(frame.patchAreaPx),
    patchAreaDeltaPct: round(frame.patchAreaDeltaPct),
    scaleJump: frame.scaleJump,
    roiComposition: frame.roiComposition,
    frameDeltaMs: round(frame.frameDeltaMs),
    effectiveFrameRate: round(frame.effectiveFrameRate),
    frameGapCount: frame.frameGapCount,
    targetFs: frame.targetFs,
    downsampleMode: frame.downsampleMode,
    antiAliasWindowMs: round(frame.antiAliasWindowMs),
    posValue: round(pipeline.posBuffer[pipeline.posBuffer.length - 1]),
    posBufferLength: pipeline.posBuffer.length,
    cwtLsDivergenceBpm: round(Math.abs((sample.cwtSmoothedBpm ?? sample.cwtBpm) - sample.lsBpm)),
    cwtAccepted: sample.cwtAccepted,
    cwtRawAccepted: sample.cwtRawAccepted,
    cwtGatedAccepted: sample.cwtGatedAccepted,
    cwtQuality: round(sample.cwtQuality),
    cwtRejectReason: sample.cwtRejectReason,
    cwtFallbackReason: sample.cwtFallbackReason,
    signalScale: cwt.signalScale,
    signalClippedFraction: cwt.signalClippedFraction
  };
}

function buildCwtPowerDiagnostic(sample) {
  const cwt = pipeline.lastCwtDebug ?? {};
  return {
    wallTime: new Date().toISOString(),
    perfMs: round(sample.t),
    phase: state.currentPhase,
    cwtRawBpm: round(sample.cwtRawBpm),
    cwtConstrainedBpm: round(sample.cwtConstrainedBpm),
    cwtGatedBpm: round(sample.cwtGatedBpm),
    cwtSmoothedBpm: round(sample.cwtSmoothedBpm),
    cwtAccepted: sample.cwtAccepted,
    cwtRawAccepted: sample.cwtRawAccepted,
    cwtGatedAccepted: sample.cwtGatedAccepted,
    cwtQuality: round(sample.cwtQuality),
    cwtRejectReason: sample.cwtRejectReason,
    cwtFallbackReason: sample.cwtFallbackReason,
    cwtLsDivergenceBpm: round(sample.cwtLsDivergenceBpm),
    cwtJumpBpm: round(sample.cwtJumpBpm),
    cwtCoverageRatio: round(sample.cwtCoverageRatio),
    cwtPowerRatio: cwt.powerRatio,
    cwtBestPower: cwt.bestPower,
    cwtSecondBpm: cwt.secondBpm,
    cwtSecondPower: cwt.secondPower,
    cwtSearchLowBpm: sample.cwtSearchLowBpm,
    cwtSearchHighBpm: sample.cwtSearchHighBpm,
    cwtTopCandidatesJson: JSON.stringify(cwt.topCandidates ?? [])
  };
}

function setPhase(phase, title, instructions) {
  state.currentPhase = phase;
  dom.phaseTitle.textContent = title;
  dom.phaseInstructions.textContent = instructions;
  if (!dom.phaseTimer.textContent || dom.phaseTimer.textContent === '--') dom.phaseTimer.textContent = '--';
}

function runCountdown(seconds, onTick, onDone) {
  if (state.activeTimer) clearInterval(state.activeTimer);
  let remaining = seconds;
  dom.phaseTimer.textContent = formatSeconds(remaining);
  onTick?.(remaining, 0);
  state.activeTimer = setInterval(() => {
    remaining -= 1;
    const elapsed = seconds - remaining;
    dom.phaseTimer.textContent = formatSeconds(remaining);
    onTick?.(remaining, elapsed);
    if (remaining <= 0) {
      clearInterval(state.activeTimer);
      state.activeTimer = null;
      onDone();
    }
  }, 1000);
}

function updateIntervalLabel(phase, intervalNumber) {
  if (phase === 'DONE') {
    dom.intervalLabel.textContent = t('notRunning');
    return;
  }
  dom.intervalLabel.textContent = intervalNumber ? `${phase} ${intervalNumber}/6` : phase;
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
function fmt(value) { return value === null || value === undefined ? '' : Number.isFinite(value) ? Number(value.toFixed(3)) : value; }
function formatSeconds(total) {
  const m = Math.floor(Math.max(0, total) / 60);
  const s = Math.max(0, total) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
