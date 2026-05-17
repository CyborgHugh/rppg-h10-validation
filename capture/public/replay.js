import { ALGORITHM_MANIFEST } from '/shared/algorithm/manifest.js';
import { PARAMS, RPPGPipeline } from '/shared/algorithm/rppg-pipeline.js';
import { estimateMadanInterval } from '/shared/algorithm/madan-interval.js';
import {
  ROI_COMPOSITIONS,
  ROI_MODES,
  SKIN_MODES,
  analyzeRoiCandidates,
  combinePrimaryRois,
  faceBoxFromLandmarks
} from '/shared/algorithm/roi-utils.js';

const dom = Object.fromEntries([
  'session-id', 'session-list', 'btn-load-sessions', 'btn-load', 'btn-run', 'btn-run-all-sessions',
  'status', 'video-layer', 'canvas-layer', 'hr-chart'
].map((id) => [camel(id), document.getElementById(id)]));

const ctx = dom.canvasLayer.getContext('2d', { willReadFrequently: true });
const chartCtx = dom.hrChart.getContext('2d');
const FIXED_REPLAY_CONFIG = {
  label: 'legacy_regions_30fps_hard',
  roiMode: ROI_MODES.BOX_RECT_LEGACY,
  roiComposition: ROI_COMPOSITIONS.ALL,
  skinMode: SKIN_MODES.HARD_YCBCR,
  targetFs: 30,
  cwtMode: 'raw+gated',
  regionComparisons: ['foreheadCheek', 'foreheadOnly', 'cheeksOnly', 'upperFace']
};

let manifest = null;
let faceMesh = null;
let previousPrimaryRoiCandidates = {};
let previousUpperFaceRoiCandidates = {};
let recordingStartPerfMs = 0;
let availableSessions = [];
let activeReplayConfig = { ...FIXED_REPLAY_CONFIG };
let pipeline = createPrimaryPipeline(activeReplayConfig);
let upperFacePipeline = createUpperFacePipeline(activeReplayConfig);
let foreheadOnlyPipeline = createRegionPipeline('foreheadOnly', ROI_COMPOSITIONS.FOREHEAD_ONLY, activeReplayConfig);
let cheeksOnlyPipeline = createRegionPipeline('cheeksOnly', ROI_COMPOSITIONS.CHEEKS_ONLY, activeReplayConfig);
let replay = createReplayState();

dom.btnLoadSessions.addEventListener('click', loadSessionList);
dom.btnLoad.addEventListener('click', loadSession);
dom.btnRun.addEventListener('click', () => runReplayVariant(FIXED_REPLAY_CONFIG));
dom.btnRunAllSessions.addEventListener('click', runAllSessionsReplay);

async function loadSession() {
  const sessionId = dom.sessionId.value.trim() || dom.sessionList.value;
  if (!sessionId) return dom.sessionId.focus();
  await loadSessionById(sessionId);
}

async function loadSessionById(sessionId) {
  manifest = await fetch(`/api/capture/session/${encodeURIComponent(sessionId)}/manifest`).then((res) => res.json());
  recordingStartPerfMs = number(manifest.recordingManifest?.recordingStartedPerfMs) ?? 0;
  dom.sessionId.value = sessionId;
  dom.sessionList.value = sessionId;
  dom.videoLayer.src = `/api/capture/session/${encodeURIComponent(sessionId)}/video`;
  await dom.videoLayer.play().catch(() => {});
  dom.videoLayer.pause();
  dom.btnRun.disabled = false;
  setStatus(`Loaded ${sessionId}`);
}

async function loadSessionList() {
  const payload = await fetch('/api/capture/sessions').then((res) => res.json());
  availableSessions = (payload.sessions ?? []).filter((session) => session.videoFinalized);
  dom.sessionList.innerHTML = '';
  for (const session of availableSessions) {
    const option = document.createElement('option');
    option.value = session.sessionId;
    option.textContent = session.sessionId;
    dom.sessionList.append(option);
  }
  if (availableSessions.length && !dom.sessionId.value.trim()) {
    dom.sessionId.value = availableSessions[0].sessionId;
  }
  setStatus(`Found ${availableSessions.length} finalized capture session(s)`);
}

async function runAllSessionsReplay() {
  if (!availableSessions.length) await loadSessionList();
  if (!availableSessions.length) {
    setStatus('No finalized capture sessions found');
    return;
  }
  dom.btnRun.disabled = true;
  dom.btnRunAllSessions.disabled = true;
  try {
    for (const [index, session] of availableSessions.entries()) {
      setStatus(`Session ${index + 1}/${availableSessions.length}: ${session.sessionId}`);
      await loadSessionById(session.sessionId);
      await runReplayVariant(FIXED_REPLAY_CONFIG);
    }
    setStatus(`All-session replay complete: ${availableSessions.length} session(s) saved`);
  } finally {
    dom.btnRun.disabled = false;
    dom.btnRunAllSessions.disabled = false;
  }
}

async function runReplayVariant(config) {
  if (!manifest) throw new Error('Load a session before replay');
  activeReplayConfig = { ...config };
  resetReplayState(activeReplayConfig);
  replay.events = await fetchCsv(`/api/capture/session/${encodeURIComponent(manifest.sessionId)}/events.csv`).catch(() => []);
  replay.polarSamples = await fetchCsv(`/api/capture/session/${encodeURIComponent(manifest.sessionId)}/polar_hr_1hz.csv`).catch(() => []);
  faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
  faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  faceMesh.onResults(onFaceResults);
  pipeline = createPrimaryPipeline(activeReplayConfig);
  upperFacePipeline = createUpperFacePipeline(activeReplayConfig);
  foreheadOnlyPipeline = createRegionPipeline('foreheadOnly', ROI_COMPOSITIONS.FOREHEAD_ONLY, activeReplayConfig);
  cheeksOnlyPipeline = createRegionPipeline('cheeksOnly', ROI_COMPOSITIONS.CHEEKS_ONLY, activeReplayConfig);
  pipeline.reset();
  upperFacePipeline.reset();
  foreheadOnlyPipeline.reset();
  cheeksOnlyPipeline.reset();
  dom.videoLayer.currentTime = 0;
  await dom.videoLayer.play();
  setStatus(`Replay running: ${activeReplayConfig.label}`);
  await processVideoUntilEnded();
  buildIntervalSummaries();
  const response = await fetch(`/api/capture/session/${encodeURIComponent(manifest.sessionId)}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replayId: `replay_${activeReplayConfig.label}_${new Date().toISOString().replace(/[:.]/g, '-')}`,
      algorithmManifest: ALGORITHM_MANIFEST,
      replayConfig: activeReplayConfig,
      ...replay
    })
  });
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json();
  setStatus(`Replay saved: ${result.replayId}`);
  return result;
}

function createPrimaryPipeline(config) {
  let instance;
  instance = new RPPGPipeline({
    targetFs: config.targetFs,
    roiMode: config.roiMode,
    skinMode: config.skinMode,
    cwtMode: config.cwtMode,
    onHr: (sample) => {
      if (sample.t - (instance.lastReplayStoreMs ?? 0) < 1000) return;
      instance.lastReplayStoreMs = sample.t;
      replay.rppgSamples.push({
        wallTime: new Date().toISOString(),
        perfMs: round(sample.t),
        phase: phaseAt(sample.t),
        cwtBpm: round(sample.cwtBpm),
        lsBpm: round(sample.lsBpm),
        cwtRawBpm: round(sample.cwtRawBpm),
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
        targetFs: sample.targetFs,
        effectiveFrameRate: round(sample.effectiveFrameRate),
        frameGapCount: sample.frameGapCount,
        downsampleMode: sample.downsampleMode,
        antiAliasWindowMs: round(sample.antiAliasWindowMs),
        roiMode: sample.roiMode,
        skinMode: sample.skinMode,
        roiComposition: sample.roiComposition,
        interEyeDeltaPct: round(sample.interEyeDeltaPct),
        interEyeVelocityPctPerSec: round(sample.interEyeVelocityPctPerSec),
        patchAreaDeltaPct: round(sample.patchAreaDeltaPct),
        scaleJump: sample.scaleJump
      });
      replay.rppgDebugSamples.push(buildRppgDebugSample(sample));
      replay.rppgSignalQualitySamples.push(buildSignalQualitySample(sample));
      replay.cwtPowerDiagnostics.push(buildCwtPowerDiagnostic(sample));
      drawChart(sample.t);
    },
    onRawSample: (sample) => {
      recordRegionAlgorithmSample('foreheadCheek', sample);
    }
  });
  return instance;
}

function createUpperFacePipeline(config) {
  let instance;
  instance = new RPPGPipeline({
    targetFs: config.targetFs,
    roiMode: ROI_MODES.BOX_RECT_LEGACY,
    skinMode: SKIN_MODES.HARD_YCBCR,
    cwtMode: config.cwtMode,
    onHr: (sample) => {
      if (sample.t - (instance.lastReplayStoreMs ?? 0) < 1000) return;
      instance.lastReplayStoreMs = sample.t;
      replay.upperFaceRppgSamples.push({
        wallTime: new Date().toISOString(),
        perfMs: round(sample.t),
        phase: phaseAt(sample.t),
        upperFaceCwtBpm: round(sample.cwtBpm),
        upperFaceLsBpm: round(sample.lsBpm),
        upperFaceCwtRawBpm: round(sample.cwtRawBpm),
        upperFaceCwtGatedBpm: round(sample.cwtGatedBpm),
        upperFaceCwtSmoothedBpm: round(sample.cwtSmoothedBpm),
        upperFaceCwtAccepted: sample.cwtAccepted,
        upperFaceCwtRawAccepted: sample.cwtRawAccepted,
        upperFaceCwtGatedAccepted: sample.cwtGatedAccepted,
        upperFaceCwtQuality: round(sample.cwtQuality)
      });
    },
    onRawSample: (sample) => {
      recordRegionAlgorithmSample('upperFace', sample);
    }
  });
  return instance;
}

function createRegionPipeline(regionKey, roiComposition, config) {
  let instance;
  instance = new RPPGPipeline({
    targetFs: config.targetFs,
    roiMode: ROI_MODES.BOX_RECT_LEGACY,
    skinMode: SKIN_MODES.HARD_YCBCR,
    cwtMode: config.cwtMode,
    onHr: (sample) => {
      if (sample.t - (instance.lastReplayStoreMs ?? 0) < 1000) return;
      instance.lastReplayStoreMs = sample.t;
      replay[`${regionKey}RppgSamples`].push({
        wallTime: new Date().toISOString(),
        perfMs: round(sample.t),
        phase: phaseAt(sample.t),
        [`${regionKey}CwtBpm`]: round(sample.cwtBpm),
        [`${regionKey}LsBpm`]: round(sample.lsBpm),
        [`${regionKey}CwtRawBpm`]: round(sample.cwtRawBpm),
        [`${regionKey}CwtGatedBpm`]: round(sample.cwtGatedBpm),
        [`${regionKey}CwtSmoothedBpm`]: round(sample.cwtSmoothedBpm),
        [`${regionKey}CwtAccepted`]: sample.cwtAccepted,
        [`${regionKey}CwtRawAccepted`]: sample.cwtRawAccepted,
        [`${regionKey}CwtGatedAccepted`]: sample.cwtGatedAccepted,
        [`${regionKey}CwtQuality`]: round(sample.cwtQuality),
        roiComposition
      });
    },
    onRawSample: (sample) => {
      recordRegionAlgorithmSample(regionKey, sample);
    }
  });
  return instance;
}

function processVideoUntilEnded() {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(endPoll);
      dom.videoLayer.removeEventListener('ended', finish);
      dom.videoLayer.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      if (finished) return;
      finished = true;
      clearInterval(endPoll);
      dom.videoLayer.removeEventListener('ended', finish);
      dom.videoLayer.removeEventListener('error', fail);
      reject(new Error('Replay video failed'));
    };
    const step = async () => {
      if (finished || dom.videoLayer.ended) return finish();
      try {
        await faceMesh.send({ image: dom.videoLayer });
      } catch (error) {
        return fail(error);
      }
      if (finished || dom.videoLayer.ended) return finish();
      if (dom.videoLayer.requestVideoFrameCallback) {
        dom.videoLayer.requestVideoFrameCallback(step);
      } else {
        setTimeout(step, 33);
      }
    };
    dom.videoLayer.addEventListener('ended', finish);
    dom.videoLayer.addEventListener('error', fail);
    const endPoll = setInterval(() => {
      if (dom.videoLayer.ended || (Number.isFinite(dom.videoLayer.duration) && dom.videoLayer.currentTime >= dom.videoLayer.duration - 0.05)) {
        finish();
      }
    }, 500);
    step();
  });
}

function onFaceResults(results) {
  if (!dom.videoLayer.videoWidth) return;
  dom.canvasLayer.width = dom.videoLayer.videoWidth;
  dom.canvasLayer.height = dom.videoLayer.videoHeight;
  ctx.drawImage(results.image, 0, 0, dom.canvasLayer.width, dom.canvasLayer.height);
  const rois = extractFaceRois(results);
  if (!rois) return;
  const perfMs = capturePerfMsForVideoTime(dom.videoLayer.currentTime);
  const phase = phaseAt(perfMs);
  if (rois.primaryRoi) {
    pipeline.pushFrame(rois.primaryRoi.r, rois.primaryRoi.g, rois.primaryRoi.b, perfMs, {
      phase,
      roiX: rois.primaryRoi.x,
      roiY: rois.primaryRoi.y,
      roiWidth: rois.primaryRoi.width,
      roiHeight: rois.primaryRoi.height,
      skinPixelCount: rois.primaryRoi.skinPixelCount,
      sampledPixelCount: rois.primaryRoi.sampledPixelCount,
      skinFraction: rois.primaryRoi.skinFraction,
      hardSkinFraction: rois.primaryRoi.hardSkinFraction,
      effectiveSkinPixelCount: rois.primaryRoi.effectiveSkinPixelCount,
      effectiveSkinSampleCount: rois.primaryRoi.effectiveSkinSampleCount,
      fixedSampleCount: rois.primaryRoi.fixedSampleCount,
      roiMotionPx: rois.primaryRoi.roiMotionPx,
      rgbJump: rois.primaryRoi.rgbJump,
      faceRollDeg: rois.primaryRoi.faceRollDeg,
      interEyeDistancePx: rois.primaryRoi.interEyeDistancePx,
      interEyeDeltaPct: rois.primaryRoi.interEyeDeltaPct,
      interEyeVelocityPctPerSec: rois.primaryRoi.interEyeVelocityPctPerSec,
      patchAreaPx: rois.primaryRoi.patchAreaPx,
      patchAreaDeltaPct: rois.primaryRoi.patchAreaDeltaPct,
      scaleJump: rois.primaryRoi.scaleJump,
      roiMode: rois.primaryRoi.roiMode,
      skinMode: rois.primaryRoi.skinMode,
      roiComposition: rois.primaryRoi.roiComposition,
      roiRegionSet: rois.primaryRoi.regionSet,
      roiCandidateCount: rois.primaryRoi.candidateCount
    });
  }
  if (rois.upperFaceRoi) {
    upperFacePipeline.pushFrame(rois.upperFaceRoi.r, rois.upperFaceRoi.g, rois.upperFaceRoi.b, perfMs, {
      phase,
      roiX: rois.upperFaceRoi.x,
      roiY: rois.upperFaceRoi.y,
      roiWidth: rois.upperFaceRoi.width,
      roiHeight: rois.upperFaceRoi.height,
      skinPixelCount: rois.upperFaceRoi.skinPixelCount,
      sampledPixelCount: rois.upperFaceRoi.sampledPixelCount,
      skinFraction: rois.upperFaceRoi.skinFraction,
      roiMotionPx: rois.upperFaceRoi.roiMotionPx,
      roiMode: ROI_MODES.BOX_RECT_LEGACY,
      skinMode: SKIN_MODES.HARD_YCBCR,
      roiComposition: ROI_COMPOSITIONS.ALL,
      roiRegionSet: 'upperFace',
      roiCandidateCount: 1
    });
  }
  if (rois.foreheadOnlyRoi) {
    pushRegionFrame(foreheadOnlyPipeline, rois.foreheadOnlyRoi, perfMs, phase, ROI_COMPOSITIONS.FOREHEAD_ONLY);
  }
  if (rois.cheeksOnlyRoi) {
    pushRegionFrame(cheeksOnlyPipeline, rois.cheeksOnlyRoi, perfMs, phase, ROI_COMPOSITIONS.CHEEKS_ONLY);
  }
}

function pushRegionFrame(regionPipeline, roi, perfMs, phase, roiComposition) {
  regionPipeline.pushFrame(roi.r, roi.g, roi.b, perfMs, {
    phase,
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
    roiMode: ROI_MODES.BOX_RECT_LEGACY,
    skinMode: SKIN_MODES.HARD_YCBCR,
    roiComposition,
    roiRegionSet: roi.regionSet,
    roiCandidateCount: roi.candidateCount
  });
}

function extractFaceRois(results) {
  if (!results.multiFaceLandmarks?.length) return null;
  const landmarks = results.multiFaceLandmarks[0];
  const faceBox = faceBoxFromLandmarks(landmarks, dom.canvasLayer.width, dom.canvasLayer.height);
  if (!faceBox) return null;
  const imageData = ctx.getImageData(0, 0, dom.canvasLayer.width, dom.canvasLayer.height);
  const perfMs = capturePerfMsForVideoTime(dom.videoLayer.currentTime);
  const candidates = analyzeRoiCandidates({
    imageData,
    landmarks,
    faceBox,
    imageWidth: dom.canvasLayer.width,
    imageHeight: dom.canvasLayer.height,
    skinParams: PARAMS.skin,
    previousCandidates: previousPrimaryRoiCandidates,
    mode: ROI_MODES.BOX_RECT_LEGACY,
    skinMode: SKIN_MODES.HARD_YCBCR,
    roiComposition: ROI_COMPOSITIONS.ALL,
    perfMs
  });
  previousPrimaryRoiCandidates = Object.fromEntries(candidates.map((candidate) => [candidate.name, candidate]));
  const legacyCandidates = analyzeRoiCandidates({
    imageData,
    faceBox,
    skinParams: PARAMS.skin,
    previousCandidates: previousUpperFaceRoiCandidates,
    mode: ROI_MODES.BOX_RECT_LEGACY,
    skinMode: SKIN_MODES.HARD_YCBCR,
    roiComposition: ROI_COMPOSITIONS.ALL,
    perfMs
  });
  previousUpperFaceRoiCandidates = Object.fromEntries(legacyCandidates.map((candidate) => [candidate.name, candidate]));
  for (const candidate of candidates) recordRoiCandidate(candidate, perfMs);
  const upperFace = legacyCandidates.find((candidate) => candidate.name === 'upperFace' && candidate.accepted);
  if (upperFace) recordRoiCandidate({ ...upperFace, roiName: 'upperFaceLegacy', name: 'upperFaceLegacy' }, perfMs);
  const primaryRoi = combinePrimaryRois(candidates, { roiComposition: ROI_COMPOSITIONS.ALL });
  const foreheadOnlyRoi = combinePrimaryRois(candidates, { roiComposition: ROI_COMPOSITIONS.FOREHEAD_ONLY });
  const cheeksOnlyRoi = combinePrimaryRois(candidates, { roiComposition: ROI_COMPOSITIONS.CHEEKS_ONLY });
  if (primaryRoi) {
    ctx.strokeStyle = 'rgba(219, 39, 119, .85)';
    ctx.lineWidth = 2;
    candidates.filter((candidate) => candidate.accepted && candidate.name !== 'upperFace').forEach(drawCandidate);
  }
  return {
    primaryRoi,
    upperFaceRoi: upperFace ? {
      r: upperFace.r,
      g: upperFace.g,
      b: upperFace.b,
      x: upperFace.x,
      y: upperFace.y,
      width: upperFace.width,
      height: upperFace.height,
      skinPixelCount: upperFace.skinPixelCount,
      sampledPixelCount: upperFace.sampledPixelCount,
      skinFraction: upperFace.skinFraction,
      roiMotionPx: upperFace.roiMotionPx,
      regionSet: 'upperFace',
      candidateCount: 1
    } : null,
    foreheadOnlyRoi,
    cheeksOnlyRoi
  };
}

function recordRoiCandidate(candidate, perfMs) {
  replay.rppgRoiCandidates.push({
    wallTime: new Date().toISOString(),
    perfMs: round(perfMs),
    phase: phaseAt(perfMs),
    roiName: candidate.roiName ?? candidate.name,
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
    faceScalePx: round(candidate.faceScalePx),
    patchAreaPx: round(candidate.patchAreaPx),
    patchAreaDeltaPct: round(candidate.patchAreaDeltaPct),
    fixedSampleCount: candidate.fixedSampleCount,
    effectiveSkinSampleCount: round(candidate.effectiveSkinSampleCount),
    scaleJump: candidate.scaleJump,
    polygonJson: candidate.polygonJson,
    normalizedPolygonJson: candidate.normalizedPolygonJson,
    skinPixelCount: round(candidate.skinPixelCount),
    hardSkinPixelCount: round(candidate.hardSkinPixelCount),
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

function drawCandidate(candidate) {
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

function buildIntervalSummaries() {
  replay.intervalSummaries = [];
  for (const phase of ['BASELINE', 'RECOVERY']) {
    const start = replay.events.find((event) => event.eventType === 'phase_start' && event.phase === phase);
    const end = replay.events.find((event) => event.eventType === 'phase_end' && event.phase === phase);
    if (!start || !end) continue;
    const startMs = number(start.perfMs);
    const endMs = number(end.perfMs);
    for (let index = 0; index < 6; index += 1) {
      const a = startMs + index * 30000;
      const b = Math.min(endMs, a + 30000);
      const samples = replay.rppgSamples.filter((sample) => sample.perfMs >= a && sample.perfMs <= b);
      const upperFaceSamples = replay.upperFaceRppgSamples.filter((sample) => sample.perfMs >= a && sample.perfMs <= b);
      const foreheadOnlySamples = replay.foreheadOnlyRppgSamples.filter((sample) => sample.perfMs >= a && sample.perfMs <= b);
      const cheeksOnlySamples = replay.cheeksOnlyRppgSamples.filter((sample) => sample.perfMs >= a && sample.perfMs <= b);
      const durationSec = (b - a) / 1000;
      const foreheadCheekCwtRawBeats = bpmToBeats(mean(samples.map((sample) => sample.cwtBpm)), durationSec);
      const foreheadCheekLsBeats = bpmToBeats(mean(samples.map((sample) => sample.lsBpm)), durationSec);
      const foreheadOnlyCwtRawBeats = bpmToBeats(mean(foreheadOnlySamples.map((sample) => sample.foreheadOnlyCwtBpm)), durationSec);
      const foreheadOnlyLsBeats = bpmToBeats(mean(foreheadOnlySamples.map((sample) => sample.foreheadOnlyLsBpm)), durationSec);
      const cheeksOnlyCwtRawBeats = bpmToBeats(mean(cheeksOnlySamples.map((sample) => sample.cheeksOnlyCwtBpm)), durationSec);
      const cheeksOnlyLsBeats = bpmToBeats(mean(cheeksOnlySamples.map((sample) => sample.cheeksOnlyLsBpm)), durationSec);
      const upperFaceCwtRawBeats = bpmToBeats(mean(upperFaceSamples.map((sample) => sample.upperFaceCwtBpm)), durationSec);
      const upperFaceLsBeats = bpmToBeats(mean(upperFaceSamples.map((sample) => sample.upperFaceLsBpm)), durationSec);
      const foreheadCheekMadan = estimateMadanForRegion('foreheadCheek', a, b, durationSec);
      const foreheadOnlyMadan = estimateMadanForRegion('foreheadOnly', a, b, durationSec);
      const cheeksOnlyMadan = estimateMadanForRegion('cheeksOnly', a, b, durationSec);
      const upperFaceMadan = estimateMadanForRegion('upperFace', a, b, durationSec);
      const acceptedCount = samples.filter((sample) => sample.cwtGatedAccepted).length;
      replay.intervalSummaries.push({
        intervalId: `${phase.toLowerCase()}-${index + 1}`,
        phase,
        intervalNumber: index + 1,
        startPerfMs: round(a),
        endPerfMs: round(b),
        durationSec: round(durationSec),
        polarBeats: round(integratePolarBeats(replay.polarSamples, a, b)),
        cwtBeats: foreheadCheekCwtRawBeats,
        cwtRawBeats: foreheadCheekCwtRawBeats,
        lsBeats: foreheadCheekLsBeats,
        madanPcaCwtBeats: round(foreheadCheekMadan.pca.beatCount),
        madanPcaCwtMedianBpm: round(foreheadCheekMadan.pca.medianBpm),
        madanPcaCwtQuality: foreheadCheekMadan.pca.quality,
        madanPosCwtBeats: round(foreheadCheekMadan.pos.beatCount),
        madanPosCwtMedianBpm: round(foreheadCheekMadan.pos.medianBpm),
        madanPosCwtQuality: foreheadCheekMadan.pos.quality,
        foreheadCheekCwtBeats: foreheadCheekCwtRawBeats,
        foreheadCheekCwtRawBeats,
        foreheadCheekLsBeats,
        foreheadCheekMadanPcaCwtBeats: round(foreheadCheekMadan.pca.beatCount),
        foreheadCheekMadanPcaCwtMedianBpm: round(foreheadCheekMadan.pca.medianBpm),
        foreheadCheekMadanPcaCwtQuality: foreheadCheekMadan.pca.quality,
        foreheadCheekMadanPosCwtBeats: round(foreheadCheekMadan.pos.beatCount),
        foreheadCheekMadanPosCwtMedianBpm: round(foreheadCheekMadan.pos.medianBpm),
        foreheadCheekMadanPosCwtQuality: foreheadCheekMadan.pos.quality,
        foreheadOnlyCwtBeats: foreheadOnlyCwtRawBeats,
        foreheadOnlyCwtRawBeats,
        foreheadOnlyLsBeats,
        foreheadOnlyMadanPcaCwtBeats: round(foreheadOnlyMadan.pca.beatCount),
        foreheadOnlyMadanPcaCwtMedianBpm: round(foreheadOnlyMadan.pca.medianBpm),
        foreheadOnlyMadanPcaCwtQuality: foreheadOnlyMadan.pca.quality,
        foreheadOnlyMadanPosCwtBeats: round(foreheadOnlyMadan.pos.beatCount),
        foreheadOnlyMadanPosCwtMedianBpm: round(foreheadOnlyMadan.pos.medianBpm),
        foreheadOnlyMadanPosCwtQuality: foreheadOnlyMadan.pos.quality,
        cheeksOnlyCwtBeats: cheeksOnlyCwtRawBeats,
        cheeksOnlyCwtRawBeats,
        cheeksOnlyLsBeats,
        cheeksOnlyMadanPcaCwtBeats: round(cheeksOnlyMadan.pca.beatCount),
        cheeksOnlyMadanPcaCwtMedianBpm: round(cheeksOnlyMadan.pca.medianBpm),
        cheeksOnlyMadanPcaCwtQuality: cheeksOnlyMadan.pca.quality,
        cheeksOnlyMadanPosCwtBeats: round(cheeksOnlyMadan.pos.beatCount),
        cheeksOnlyMadanPosCwtMedianBpm: round(cheeksOnlyMadan.pos.medianBpm),
        cheeksOnlyMadanPosCwtQuality: cheeksOnlyMadan.pos.quality,
        upperFaceCwtBeats: upperFaceCwtRawBeats,
        upperFaceCwtRawBeats,
        upperFaceLsBeats,
        upperFaceMadanPcaCwtBeats: round(upperFaceMadan.pca.beatCount),
        upperFaceMadanPcaCwtMedianBpm: round(upperFaceMadan.pca.medianBpm),
        upperFaceMadanPcaCwtQuality: upperFaceMadan.pca.quality,
        upperFaceMadanPosCwtBeats: round(upperFaceMadan.pos.beatCount),
        upperFaceMadanPosCwtMedianBpm: round(upperFaceMadan.pos.medianBpm),
        upperFaceMadanPosCwtQuality: upperFaceMadan.pos.quality,
        cwtAcceptedRatio: samples.length ? round(acceptedCount / samples.length, 6) : null,
        targetFs: activeReplayConfig.targetFs,
        roiMode: activeReplayConfig.roiMode,
        roiComposition: activeReplayConfig.roiComposition,
        skinMode: activeReplayConfig.skinMode
      });
    }
  }
}

function buildRppgDebugSample(sample) {
  const cwt = pipeline.lastCwtDebug ?? {};
  return {
    wallTime: new Date().toISOString(),
    perfMs: round(sample.t),
    phase: phaseAt(sample.t),
    cwtBpm: round(sample.cwtBpm),
    lsBpm: round(sample.lsBpm),
    cwtRawBpm: round(sample.cwtRawBpm),
    cwtGatedBpm: round(sample.cwtGatedBpm),
    cwtSmoothedBpm: round(sample.cwtSmoothedBpm),
    cwtRawAccepted: sample.cwtRawAccepted,
    cwtGatedAccepted: sample.cwtGatedAccepted,
    cwtAccepted: sample.cwtAccepted,
    cwtQuality: round(sample.cwtQuality),
    cwtRejectReason: sample.cwtRejectReason,
    cwtFallbackReason: sample.cwtFallbackReason,
    cwtPowerRatio: cwt.powerRatio,
    scaleJump: sample.scaleJump,
    interEyeDeltaPct: round(sample.interEyeDeltaPct),
    interEyeVelocityPctPerSec: round(sample.interEyeVelocityPctPerSec),
    cwtTopCandidatesJson: JSON.stringify(cwt.topCandidates ?? [])
  };
}

function recordRegionAlgorithmSample(regionKey, sample) {
  const region = replay.regionIntervalSamples?.[regionKey];
  if (!region) return;
  const row = {
    ...sample,
    perfMs: number(sample.perfMs)
  };
  if (!Number.isFinite(row.perfMs)) return;
  if (sample.debugType === 'frame') {
    region.rgb.push(row);
  } else if (sample.debugType === 'pos_sample') {
    region.pos.push(row);
  }
}

function estimateMadanForRegion(regionKey, startPerfMs, endPerfMs, durationSec) {
  const region = replay.regionIntervalSamples?.[regionKey] ?? { rgb: [], pos: [] };
  return estimateMadanInterval({
    rgbSamples: region.rgb,
    posSamples: region.pos,
    startPerfMs,
    endPerfMs,
    durationSec
  });
}

function buildSignalQualitySample(sample) {
  const frame = pipeline.lastFrameDebug ?? {};
  return {
    wallTime: new Date().toISOString(),
    perfMs: round(sample.t),
    phase: phaseAt(sample.t),
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
    cwtCoverageRatio: round(sample.cwtCoverageRatio, 6),
    cwtAccepted: sample.cwtAccepted,
    cwtQuality: round(sample.cwtQuality)
  };
}

function buildCwtPowerDiagnostic(sample) {
  const cwt = pipeline.lastCwtDebug ?? {};
  return {
    wallTime: new Date().toISOString(),
    perfMs: round(sample.t),
    phase: phaseAt(sample.t),
    cwtRawBpm: round(sample.cwtRawBpm),
    cwtConstrainedBpm: cwt.constrainedBestBpm,
    cwtGatedBpm: round(sample.cwtGatedBpm),
    cwtSmoothedBpm: round(sample.cwtSmoothedBpm),
    cwtPowerRatio: cwt.powerRatio,
    cwtConstrainedPowerRatio: cwt.constrainedPowerRatio,
    cwtRawAccepted: sample.cwtRawAccepted,
    cwtGatedAccepted: sample.cwtGatedAccepted,
    cwtRejectReason: sample.cwtRejectReason,
    cwtFallbackReason: sample.cwtFallbackReason,
    cwtLsDivergenceBpm: round(sample.cwtLsDivergenceBpm),
    cwtJumpBpm: round(sample.cwtJumpBpm),
    cwtTopCandidatesJson: JSON.stringify(cwt.topCandidates ?? [])
  };
}

function phaseAt(perfMs) {
  const starts = replay.events.filter((event) => event.eventType === 'phase_start');
  for (const start of starts) {
    const end = replay.events.find((event) => (
      event.eventType === 'phase_end'
      && event.phase === start.phase
      && number(event.perfMs) >= number(start.perfMs)
    ));
    if (number(start.perfMs) <= perfMs && (!end || perfMs <= number(end.perfMs))) {
      return start.phase;
    }
  }
  return '';
}

function capturePerfMsForVideoTime(videoTimeSec) {
  return recordingStartPerfMs + videoTimeSec * 1000;
}

function resetReplayState(config = activeReplayConfig) {
  replay = createReplayState();
  replay.replayConfig = config;
  previousPrimaryRoiCandidates = {};
  previousUpperFaceRoiCandidates = {};
  drawChart(recordingStartPerfMs);
}

function createReplayState() {
  return {
    rppgSamples: [],
    upperFaceRppgSamples: [],
    foreheadOnlyRppgSamples: [],
    cheeksOnlyRppgSamples: [],
    rppgDebugSamples: [],
    rppgRoiCandidates: [],
    rppgSignalQualitySamples: [],
    cwtPowerDiagnostics: [],
    intervalSummaries: [],
    regionIntervalSamples: {
      foreheadCheek: { rgb: [], pos: [] },
      upperFace: { rgb: [], pos: [] },
      foreheadOnly: { rgb: [], pos: [] },
      cheeksOnly: { rgb: [], pos: [] }
    },
    events: [],
    polarSamples: [],
    replayConfig: activeReplayConfig
  };
}

function configFromControls() {
  return FIXED_REPLAY_CONFIG;
}

function integratePolarBeats(samples, startMs, endMs) {
  const usable = samples
    .map((sample) => ({ perfMs: number(sample.perfMs), hrBpm: number(sample.hrBpm) }))
    .filter((sample) => Number.isFinite(sample.perfMs) && Number.isFinite(sample.hrBpm))
    .sort((a, b) => a.perfMs - b.perfMs);
  if (!usable.length || endMs <= startMs) return null;
  let beats = 0;
  for (let i = 0; i < usable.length; i += 1) {
    const sample = usable[i];
    const next = usable[i + 1];
    const segmentStart = Math.max(startMs, sample.perfMs);
    const segmentEnd = Math.min(endMs, next ? next.perfMs : sample.perfMs + 1000);
    if (segmentEnd > segmentStart) beats += sample.hrBpm * ((segmentEnd - segmentStart) / 60000);
  }
  return beats;
}

function drawChart(currentPerfMs) {
  const width = dom.hrChart.width;
  const height = dom.hrChart.height;
  chartCtx.clearRect(0, 0, width, height);
  chartCtx.fillStyle = '#fbfdff';
  chartCtx.fillRect(0, 0, width, height);
  chartCtx.strokeStyle = '#d8e0ea';
  chartCtx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = 20 + i * ((height - 40) / 4);
    chartCtx.beginPath();
    chartCtx.moveTo(40, y);
    chartCtx.lineTo(width - 10, y);
    chartCtx.stroke();
  }
  const windowMs = 180000;
  const polar = replay.polarSamples
    .map((sample) => ({ x: number(sample.perfMs), y: number(sample.hrBpm) }))
    .filter((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y) && currentPerfMs - sample.x <= windowMs && sample.x <= currentPerfMs);
  const rppg = replay.rppgSamples.filter((sample) => currentPerfMs - sample.perfMs <= windowMs);
  drawSeries(polar, '#0f9f8f', currentPerfMs, windowMs);
  drawSeries(rppg.map((sample) => ({ x: sample.perfMs, y: sample.cwtBpm })), '#db2777', currentPerfMs, windowMs);
  drawSeries(rppg.map((sample) => ({ x: sample.perfMs, y: sample.cwtGatedBpm })), '#f59e0b', currentPerfMs, windowMs);
  drawSeries(rppg.map((sample) => ({ x: sample.perfMs, y: sample.lsBpm })), '#2563eb', currentPerfMs, windowMs);
}

function drawSeries(points, color, currentPerfMs, windowMs) {
  const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (usable.length < 2) return;
  const width = dom.hrChart.width;
  const height = dom.hrChart.height;
  const xFor = (x) => 40 + ((x - (currentPerfMs - windowMs)) / windowMs) * (width - 55);
  const yFor = (y) => height - 20 - ((Math.max(45, Math.min(180, y)) - 45) / 135) * (height - 40);
  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  usable.forEach((point, index) => {
    const x = xFor(point.x);
    const y = yFor(point.y);
    if (index === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();
}

async function fetchCsv(url) {
  const response = await fetch(url);
  if (!response.ok) return [];
  const text = await response.text();
  const rows = [];
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine) return rows;
  const headers = splitCsvLine(headerLine);
  for (const line of lines) {
    const cells = splitCsvLine(line);
    rows.push(Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
  }
  return rows;
}

function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function bpmToBeats(bpm, durationSec) {
  return Number.isFinite(bpm) ? round(bpm * durationSec / 60) : null;
}

function setStatus(message) {
  dom.status.textContent = message;
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function camel(id) {
  return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
