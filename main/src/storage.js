import { mkdir, readFile, writeFile, appendFile, access } from 'node:fs/promises';
import path from 'node:path';
import { flattenParticipantSummary, summarizeSession } from './analysis.js';
import { appendCsvLine, toCsv } from '../../src/csv.js';

const SUMMARY_COLUMNS = [
  'session_id',
  'participant_id',
  'created_at',
  'language',
  'polar_connected',
  'trial_count',
  ...beatCountSummaryColumns(),
  'trial_metrics_json',
  'beat_count_indices_json',
  'phase_metrics_json'
];

const RPPG_HR_COLUMNS = [
  'sessionId',
  'participantId',
  'wallTime',
  'perfMs',
  'phase',
  'cwtBpm',
  'lsBpm',
  'cwtRawBpm',
  'cwtGatedBpm',
  'cwtRawAccepted',
  'cwtGatedAccepted',
  'cwtRejectReason',
  'cwtPowerRatio',
  'cwtLsDivergenceBpm',
  'cwtJumpBpm',
  'cwtCoverageRatio',
  'targetFs',
  'roiMode',
  'roiComposition',
  'skinMode',
  'interEyeDeltaPct',
  'interEyeVelocityPctPerSec',
  'patchAreaDeltaPct',
  'scaleJump'
];

const RPPG_RAW_COLUMNS = [
  'sessionId',
  'participantId',
  'wallTime',
  'perfMs',
  'debugType',
  'phase',
  'rawR',
  'rawG',
  'rawB',
  'frameDeltaMs',
  'roiX',
  'roiY',
  'roiWidth',
  'roiHeight',
  'roiMode',
  'roiComposition',
  'skinMode',
  'skinPixelCount',
  'hardSkinPixelCount',
  'effectiveSkinPixelCount',
  'sampledPixelCount',
  'skinFraction',
  'hardSkinFraction',
  'effectiveSkinFraction',
  'rgbJump',
  'faceRollDeg',
  'interEyeDistancePx',
  'interEyeDeltaPct',
  'interEyeVelocityPctPerSec',
  'patchAreaPx',
  'patchAreaDeltaPct',
  'fixedSampleCount',
  'effectiveSkinSampleCount',
  'scaleJump',
  'roiMotionPx',
  'roiRegionSet',
  'roiCandidateCount',
  'callbackPerfMs',
  'resampledR',
  'resampledG',
  'resampledB',
  'filteredR',
  'filteredG',
  'filteredB',
  'meanR',
  'meanG',
  'meanB',
  'alpha',
  'posValue',
  'posBufferLength'
];

export async function createSession(dataRoot, { participantId, language }) {
  await mkdir(dataRoot, { recursive: true });
  const sessionId = `${safeId(participantId)}_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const createdAt = new Date().toISOString();
  const sessionDir = path.join(dataRoot, 'sessions', sessionId);
  await mkdir(sessionDir, { recursive: true });
  const manifest = { sessionId, participantId, language, createdAt };
  await writeJson(path.join(sessionDir, 'session.json'), manifest);
  return { ...manifest, sessionDir };
}

export async function finalizeSession(dataRoot, session) {
  const sessionDir = path.join(dataRoot, 'sessions', session.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const normalized = normalizeSession(session);
  const summary = summarizeSession(normalized);
  const participantRow = flattenParticipantSummary(summary);

  await writeJson(path.join(sessionDir, 'session.json'), {
    ...normalized,
    summary
  });
  await writeFile(path.join(sessionDir, 'polar_hr_1hz.csv'), toCsv(normalized.polarSamples, [
    'sessionId',
    'participantId',
    'wallTime',
    'perfMs',
    'hrBpm',
    'rrMsJson'
  ]));
  await writeFile(path.join(sessionDir, 'rppg_hr_1hz.csv'), toCsv(normalized.rppgSamples, RPPG_HR_COLUMNS));
  await writeFile(path.join(sessionDir, 'rppg_raw_signal.csv'), toCsv(normalized.rppgRawSamples, RPPG_RAW_COLUMNS));
  await writeFile(path.join(sessionDir, 'upper_face_rppg_hr_1hz.csv'), toCsv(normalized.upperFaceRppgSamples, RPPG_HR_COLUMNS));
  await writeFile(path.join(sessionDir, 'upper_face_rppg_raw_signal.csv'), toCsv(normalized.upperFaceRppgRawSamples, RPPG_RAW_COLUMNS));
  await writeFile(path.join(sessionDir, 'events.csv'), toCsv(normalized.events, [
    'sessionId',
    'participantId',
    'wallTime',
    'perfMs',
    'eventType',
    'phase',
    'trialId',
    'attemptId',
    'payloadJson'
  ]));
  await writeFile(path.join(sessionDir, 'trial_summary.csv'), toCsv(summary.trialSummaries));
  await appendParticipantSummary(dataRoot, participantRow);
  return summary;
}

async function appendParticipantSummary(dataRoot, row) {
  const summaryPath = path.join(dataRoot, 'participants_summary.csv');
  try {
    await access(summaryPath);
  } catch {
    await writeFile(summaryPath, `${SUMMARY_COLUMNS.join(',')}\n`);
  }
  await appendFile(summaryPath, appendCsvLine(row, SUMMARY_COLUMNS));
}

function normalizeSession(session) {
  const stamp = (row) => ({
    sessionId: session.sessionId,
    participantId: session.participantId,
    ...row
  });
  return {
    ...session,
    polarSamples: (session.polarSamples ?? []).map((sample) => ({
      ...stamp(sample),
      rrMsJson: sample.rrMsJson ?? JSON.stringify(sample.rrIntervalsMs ?? [])
    })),
    rppgSamples: (session.rppgSamples ?? []).map(stamp),
    rppgRawSamples: (session.rppgRawSamples ?? []).map(stamp),
    upperFaceRppgSamples: (session.upperFaceRppgSamples ?? []).map(stamp),
    upperFaceRppgRawSamples: (session.upperFaceRppgRawSamples ?? []).map(stamp),
    events: (session.events ?? []).map((event) => ({
      ...stamp(event),
      payloadJson: event.payloadJson ?? JSON.stringify(event.payload ?? {})
    })),
    trials: session.trials ?? []
  };
}

function beatCountSummaryColumns() {
  const scopes = ['total', 'baseline', 'recovery'];
  const methods = [
    'cwt',
    'ls',
    'madan_pca_cwt',
    'madan_pos_cwt',
    'upper_face_cwt',
    'upper_face_ls',
    'upper_face_madan_pca_cwt',
    'upper_face_madan_pos_cwt'
  ];
  const metrics = [
    'polar_beats',
    'rppg_beats',
    'signed_error',
    'absolute_error',
    'percent_error',
    'alignment_index',
    'inconsistency_index'
  ];
  return scopes.flatMap((scope) => methods.flatMap((method) => (
    metrics.map((metric) => `${scope}_${method}_${metric}`)
  )));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readManifest(dataRoot, sessionId) {
  const file = path.join(dataRoot, 'sessions', safeId(sessionId), 'session.json');
  return JSON.parse(await readFile(file, 'utf8'));
}

function safeId(value) {
  return String(value || 'participant')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
}
