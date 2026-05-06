import { mkdir, readFile, writeFile, appendFile, access } from 'node:fs/promises';
import path from 'node:path';
import { flattenParticipantSummary, summarizeSession } from './analysis.js';
import { appendCsvLine, toCsv } from './csv.js';

const SUMMARY_COLUMNS = [
  'session_id',
  'participant_id',
  'created_at',
  'language',
  'polar_connected',
  'trial_count',
  'baseline_cwt_mae',
  'baseline_cwt_rmse',
  'baseline_cwt_bias',
  'baseline_cwt_pearson_r',
  'baseline_cwt_lin_ccc',
  'baseline_ls_mae',
  'baseline_ls_rmse',
  'baseline_ls_bias',
  'baseline_ls_pearson_r',
  'baseline_ls_lin_ccc',
  'recovery_cwt_mae',
  'recovery_cwt_rmse',
  'recovery_cwt_bias',
  'recovery_cwt_pearson_r',
  'recovery_cwt_lin_ccc',
  'recovery_ls_mae',
  'recovery_ls_rmse',
  'recovery_ls_bias',
  'recovery_ls_pearson_r',
  'recovery_ls_lin_ccc',
  'trial_metrics_json',
  'phase_metrics_json'
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
  await writeFile(path.join(sessionDir, 'rppg_hr_1hz.csv'), toCsv(normalized.rppgSamples, [
    'sessionId',
    'participantId',
    'wallTime',
    'perfMs',
    'phase',
    'cwtBpm',
    'lsBpm'
  ]));
  await writeFile(path.join(sessionDir, 'events.csv'), toCsv(normalized.events, [
    'sessionId',
    'participantId',
    'wallTime',
    'perfMs',
    'eventType',
    'phase',
    'trialId',
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
    events: (session.events ?? []).map((event) => ({
      ...stamp(event),
      payloadJson: event.payloadJson ?? JSON.stringify(event.payload ?? {})
    })),
    trials: session.trials ?? []
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
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
