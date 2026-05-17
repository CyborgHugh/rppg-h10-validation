import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { toCsv } from './csv.js';

const MAX_CHUNK_BYTES = 64 * 1024 * 1024;

export async function createCaptureSession(dataRoot, { participantId, language }) {
  await mkdir(dataRoot, { recursive: true });
  const createdAt = new Date().toISOString();
  const sessionId = `${safeId(participantId)}_${createdAt.replace(/[:.]/g, '-')}`;
  const sessionDir = sessionPath(dataRoot, sessionId);
  await mkdir(sessionDir, { recursive: true });
  const manifest = {
    sessionId,
    participantId,
    language: language === 'zh' ? 'zh' : 'en',
    createdAt,
    workflow: 'raw-capture',
    video: { finalized: false, chunks: 0, videoBytes: 0 }
  };
  await writeJson(path.join(sessionDir, 'recording_manifest.json'), manifest);
  return { ...manifest, sessionDir };
}

export async function appendVideoChunk(dataRoot, sessionId, chunk, { chunkIndex, mimeType = 'video/webm' }) {
  if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
  if (chunk.length > MAX_CHUNK_BYTES) throw new Error('video chunk exceeds maximum size');
  const sessionDir = sessionPath(dataRoot, sessionId);
  await mkdir(sessionDir, { recursive: true });
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0) throw new Error('chunkIndex must be a non-negative integer');
  const statePath = path.join(sessionDir, 'video_upload_state.json');
  const state = await readJson(statePath, { nextChunkIndex: 0, chunks: 0, bytes: 0, mimeType });
  if (index !== state.nextChunkIndex) {
    throw new Error(`unexpected chunk index ${index}; expected ${state.nextChunkIndex}`);
  }
  await appendFile(path.join(sessionDir, 'video.tmp'), chunk);
  const nextState = {
    nextChunkIndex: index + 1,
    chunks: state.chunks + 1,
    bytes: state.bytes + chunk.length,
    mimeType
  };
  await writeJson(statePath, nextState);
  return { ok: true, chunkIndex: index, chunks: nextState.chunks, bytes: nextState.bytes };
}

export async function finalizeCaptureVideo(dataRoot, sessionId, { chunkCount, mimeType = 'video/webm' } = {}) {
  const sessionDir = sessionPath(dataRoot, sessionId);
  const state = await readJson(path.join(sessionDir, 'video_upload_state.json'), null);
  if (!state) throw new Error('video upload has no chunks');
  if (Number.isInteger(chunkCount) && state.chunks !== chunkCount) {
    throw new Error(`video upload incomplete: got ${state.chunks}, expected ${chunkCount}`);
  }
  const tmpPath = path.join(sessionDir, 'video.tmp');
  const videoPath = path.join(sessionDir, 'video.webm');
  await rename(tmpPath, videoPath);
  const fileStat = await stat(videoPath);
  const manifest = await readJson(path.join(sessionDir, 'recording_manifest.json'), {});
  const nextManifest = {
    ...manifest,
    video: {
      finalized: true,
      fileName: 'video.webm',
      mimeType: mimeType || state.mimeType,
      chunks: state.chunks,
      videoBytes: fileStat.size,
      finalizedAt: new Date().toISOString()
    }
  };
  await writeJson(path.join(sessionDir, 'recording_manifest.json'), nextManifest);
  return nextManifest.video;
}

export async function finalizeCaptureMetadata(dataRoot, session) {
  const sessionDir = sessionPath(dataRoot, session.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const existingManifest = await readJson(path.join(sessionDir, 'recording_manifest.json'), {});
  const manifest = {
    ...existingManifest,
    sessionId: session.sessionId,
    participantId: session.participantId,
    language: session.language,
    workflow: 'raw-capture',
    recordingManifest: session.recordingManifest ?? {},
    finalizedAt: new Date().toISOString()
  };
  await writeJson(path.join(sessionDir, 'recording_manifest.json'), manifest);

  const stamp = (row) => ({
    sessionId: session.sessionId,
    participantId: session.participantId,
    ...row
  });
  const polarSamples = (session.polarSamples ?? []).map((sample) => ({
    ...stamp(sample),
    rrMsJson: sample.rrMsJson ?? JSON.stringify(sample.rrIntervalsMs ?? [])
  }));
  const rrRows = [];
  for (const sample of session.polarSamples ?? []) {
    for (const rrMs of sample.rrIntervalsMs ?? []) {
      rrRows.push(stamp({
        wallTime: sample.wallTime,
        perfMs: sample.perfMs,
        hrBpm: sample.hrBpm,
        rrMs
      }));
    }
  }
  await writeFile(path.join(sessionDir, 'polar_hr_1hz.csv'), toCsv(polarSamples, [
    'sessionId', 'participantId', 'wallTime', 'perfMs', 'hrBpm', 'rrMsJson'
  ]));
  await writeFile(path.join(sessionDir, 'polar_rr.csv'), toCsv(rrRows, [
    'sessionId', 'participantId', 'wallTime', 'perfMs', 'hrBpm', 'rrMs'
  ]));
  await writeFile(path.join(sessionDir, 'events.csv'), toCsv((session.events ?? []).map((event) => ({
    ...stamp(event),
    payloadJson: event.payloadJson ?? JSON.stringify(event.payload ?? {})
  })), [
    'sessionId', 'participantId', 'wallTime', 'perfMs', 'eventType', 'phase', 'intervalId', 'payloadJson'
  ]));
  await writeFile(path.join(sessionDir, 'sync_markers.csv'), toCsv((session.syncMarkers ?? []).map(stamp), [
    'sessionId', 'participantId', 'wallTime', 'perfMs', 'markerType', 'mediaTimeSec', 'payloadJson'
  ]));
  return manifest;
}

export async function readCaptureManifest(dataRoot, sessionId) {
  return readJson(path.join(sessionPath(dataRoot, sessionId), 'recording_manifest.json'), null);
}

export async function listCaptureSessions(dataRoot) {
  const sessionsDir = path.join(dataRoot, 'sessions');
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readJson(path.join(sessionsDir, entry.name, 'recording_manifest.json'), null);
    if (!manifest?.sessionId) continue;
    sessions.push({
      sessionId: manifest.sessionId,
      participantId: manifest.participantId,
      createdAt: manifest.createdAt,
      finalizedAt: manifest.finalizedAt,
      workflow: manifest.workflow,
      videoFinalized: Boolean(manifest.video?.finalized),
      videoBytes: manifest.video?.videoBytes ?? 0
    });
  }
  sessions.sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)));
  return sessions;
}

export async function saveReplayResult(dataRoot, sessionId, replay) {
  const replayId = safeId(replay.replayId || `replay_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const replayDir = path.join(sessionPath(dataRoot, sessionId), 'replays', replayId);
  await mkdir(replayDir, { recursive: true });
  const sourceAlgorithm = await sharedAlgorithmSourceManifest(replay.sharedDir);
  const manifest = {
    replayId,
    sessionId,
    createdAt: new Date().toISOString(),
    replayConfig: replay.replayConfig ?? {},
    algorithmManifest: {
      ...(replay.algorithmManifest ?? {}),
      sourceHash: replay.algorithmManifest?.sourceHash ?? sourceAlgorithm.sourceHash,
      sourceFiles: sourceAlgorithm.sourceFiles
    },
    eventWindowSource: 'capture-events'
  };
  await writeJson(path.join(replayDir, 'replay_manifest.json'), manifest);
  await writeFile(path.join(replayDir, 'rppg_hr_1hz.csv'), toCsv(replay.rppgSamples ?? [], [
    'wallTime', 'perfMs', 'phase',
    'cwtBpm', 'lsBpm', 'cwtRawBpm', 'cwtSmoothedBpm', 'cwtGatedBpm',
    'cwtAccepted', 'cwtRawAccepted', 'cwtGatedAccepted', 'cwtQuality',
    'cwtRejectReason', 'cwtFallbackReason', 'cwtPowerRatio', 'cwtLsDivergenceBpm',
    'cwtJumpBpm', 'cwtCoverageRatio', 'targetFs', 'effectiveFrameRate',
    'frameGapCount', 'downsampleMode', 'antiAliasWindowMs', 'roiMode', 'roiComposition',
    'skinMode', 'interEyeDeltaPct', 'interEyeVelocityPctPerSec', 'patchAreaDeltaPct', 'scaleJump'
  ]));
  await writeFile(path.join(replayDir, 'rppg_forehead_only_1hz.csv'), toCsv(replay.foreheadOnlyRppgSamples ?? []));
  await writeFile(path.join(replayDir, 'rppg_cheeks_only_1hz.csv'), toCsv(replay.cheeksOnlyRppgSamples ?? []));
  await writeFile(path.join(replayDir, 'rppg_upper_face_1hz.csv'), toCsv(replay.upperFaceRppgSamples ?? []));
  await writeFile(path.join(replayDir, 'interval_summary.csv'), toCsv(replay.intervalSummaries ?? []));
  await writeFile(path.join(replayDir, 'rppg_debug.csv'), toCsv(replay.rppgDebugSamples ?? []));
  await writeFile(path.join(replayDir, 'rppg_roi_candidates.csv'), toCsv(replay.rppgRoiCandidates ?? []));
  await writeFile(path.join(replayDir, 'rppg_signal_quality.csv'), toCsv(replay.rppgSignalQualitySamples ?? []));
  await writeFile(path.join(replayDir, 'cwt_power_diagnostics.csv'), toCsv(replay.cwtPowerDiagnostics ?? []));
  await writeFile(path.join(replayDir, 'events.csv'), toCsv(replay.events ?? []));
  return { ok: true, replayId, replayDir, manifest };
}

export function sessionPath(dataRoot, sessionId) {
  const safe = safeId(sessionId);
  if (safe !== sessionId) throw new Error('invalid sessionId');
  return path.join(dataRoot, 'sessions', safe);
}

async function sharedAlgorithmSourceManifest(sharedDir = path.resolve('shared')) {
  const files = ['algorithm/rppg-pipeline.js', 'algorithm/roi-utils.js', 'algorithm/madan-interval.js', 'algorithm/manifest.js'];
  const hash = createHash('sha256');
  const sourceFiles = [];
  for (const file of files) {
    const fullPath = path.join(sharedDir, file);
    const content = await readFile(fullPath).catch(() => Buffer.alloc(0));
    hash.update(file);
    hash.update(content);
    sourceFiles.push({ file, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return { sourceHash: hash.digest('hex'), sourceFiles };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function safeId(value) {
  return String(value || 'participant')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
}
