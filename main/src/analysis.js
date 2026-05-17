import {
  alignDynamicHr,
  computeErrorMetrics,
  computePhaseAgreement,
  integratePolarBeats,
  roundMetric
} from '../../src/metrics.js';
import { estimateMadanInterval } from '../../shared/algorithm/madan-interval.js';
import { PARAMS, RPPGPipeline } from '../../shared/algorithm/rppg-pipeline.js';

const PHASE_NAMES = ['BASELINE', 'RECOVERY'];
const INDEX_GROUPS = ['TOTAL', ...PHASE_NAMES];
const BEAT_METHODS = [
  ['cwt', 'cwtBeats'],
  ['ls', 'lsBeats'],
  ['madanPcaCwt', 'madanPcaCwtBeats'],
  ['madanPosCwt', 'madanPosCwtBeats'],
  ['upperFaceCwt', 'upperFaceCwtBeats'],
  ['upperFaceLs', 'upperFaceLsBeats'],
  ['upperFaceMadanPcaCwt', 'upperFaceMadanPcaCwtBeats'],
  ['upperFaceMadanPosCwt', 'upperFaceMadanPosCwtBeats']
];

export function summarizeSession(session) {
  const events = session.events ?? [];
  const polarSamples = session.polarSamples ?? [];
  const rppgSamples = session.rppgSamples ?? [];
  const trials = session.trials ?? [];
  const streams = {
    rppgSamples,
    rppgRawSamples: session.rppgRawSamples ?? [],
    upperFaceRppgSamples: session.upperFaceRppgSamples ?? [],
    upperFaceRppgRawSamples: session.upperFaceRppgRawSamples ?? []
  };

  const trialSummaries = trials
    .filter((trial) => trial.phase !== 'PRACTICE' && !trial.aborted)
    .map((trial) => summarizeTrial(trial, events, polarSamples, streams));

  return {
    sessionId: session.sessionId,
    participantId: session.participantId,
    createdAt: session.createdAt,
    language: session.language,
    polarConnected: polarSamples.length > 0,
    trialSummaries,
    beatCountIndices: computeBeatCountIndexGroups(trialSummaries),
    phaseAgreement: computeDynamicAgreement(events, trialSummaries, polarSamples, rppgSamples)
  };
}

function summarizeTrial(trial, events, polarSamples, streams) {
  const startEvent = findTrialEvent(events, 'trial_start', trial);
  const endEvent = findTrialEvent(events, 'trial_end', trial);
  const startMs = Number.isFinite(startEvent?.perfMs) ? startEvent.perfMs : trial.startPerfMs;
  const endMs = Number.isFinite(endEvent?.perfMs) ? endEvent.perfMs : trial.endPerfMs;
  const durationSec = trial.durationSec ?? ((endMs - startMs) / 1000);
  const polarBeats = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? integratePolarBeats(polarSamples, startMs, endMs)
    : null;
  const row = {
    trialId: trial.trialId,
    attemptId: trial.attemptId ?? null,
    phase: trial.phase,
    trialNumber: trial.trialNumber,
    durationSec: roundMetric(durationSec, 3),
    startPerfMs: roundMetric(startMs, 3),
    endPerfMs: roundMetric(endMs, 3),
    subjectiveBeats: trial.subjectiveBeats,
    polarBeats
  };
  const estimates = deriveTrialEstimates(trial, streams, startMs, endMs, durationSec);

  for (const [method, key] of BEAT_METHODS) {
    const value = roundMetric(estimates[key], 3);
    row[key] = value;
    row[`${method}Error`] = polarBeats === null ? null : computeErrorMetrics(value ?? 0, polarBeats);
    row[`${method}AlignmentIndex`] = alignmentIndex(value, polarBeats);
    row[`${method}InconsistencyIndex`] = inconsistencyIndex(value, polarBeats);
  }

  row.madanPcaCwtMedianBpm = roundMetric(estimates.madanPcaCwtMedianBpm, 3);
  row.madanPcaCwtQuality = estimates.madanPcaCwtQuality ?? null;
  row.madanPosCwtMedianBpm = roundMetric(estimates.madanPosCwtMedianBpm, 3);
  row.madanPosCwtQuality = estimates.madanPosCwtQuality ?? null;
  row.upperFaceMadanPcaCwtMedianBpm = roundMetric(estimates.upperFaceMadanPcaCwtMedianBpm, 3);
  row.upperFaceMadanPcaCwtQuality = estimates.upperFaceMadanPcaCwtQuality ?? null;
  row.upperFaceMadanPosCwtMedianBpm = roundMetric(estimates.upperFaceMadanPosCwtMedianBpm, 3);
  row.upperFaceMadanPosCwtQuality = estimates.upperFaceMadanPosCwtQuality ?? null;
  return row;
}

function deriveTrialEstimates(trial, streams, startMs, endMs, durationSec) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(durationSec) || durationSec <= 0) {
    return { ...trial };
  }
  const primaryMadan = estimateMadanForSamples(streams.rppgRawSamples, startMs, endMs, durationSec);
  const upperFaceMadan = estimateMadanForSamples(streams.upperFaceRppgRawSamples, startMs, endMs, durationSec);
  return {
    ...trial,
    cwtBeats: firstFinite(
      countCwtBeats(streams.rppgRawSamples, startMs, endMs, durationSec),
      trial.cwtBeats
    ),
    lsBeats: firstFinite(
      estimateLsBeats(streams.rppgSamples, startMs, endMs, durationSec),
      trial.lsBeats
    ),
    upperFaceCwtBeats: firstFinite(
      countCwtBeats(streams.upperFaceRppgRawSamples, startMs, endMs, durationSec),
      trial.upperFaceCwtBeats
    ),
    upperFaceLsBeats: firstFinite(
      estimateLsBeats(streams.upperFaceRppgSamples, startMs, endMs, durationSec),
      trial.upperFaceLsBeats
    ),
    madanPcaCwtBeats: firstFinite(primaryMadan.pca.beatCount, trial.madanPcaCwtBeats),
    madanPcaCwtMedianBpm: firstFinite(primaryMadan.pca.medianBpm, trial.madanPcaCwtMedianBpm),
    madanPcaCwtQuality: primaryMadan.pca.quality === 'ok' ? primaryMadan.pca.quality : trial.madanPcaCwtQuality,
    madanPosCwtBeats: firstFinite(primaryMadan.pos.beatCount, trial.madanPosCwtBeats),
    madanPosCwtMedianBpm: firstFinite(primaryMadan.pos.medianBpm, trial.madanPosCwtMedianBpm),
    madanPosCwtQuality: primaryMadan.pos.quality === 'ok' ? primaryMadan.pos.quality : trial.madanPosCwtQuality,
    upperFaceMadanPcaCwtBeats: firstFinite(upperFaceMadan.pca.beatCount, trial.upperFaceMadanPcaCwtBeats),
    upperFaceMadanPcaCwtMedianBpm: firstFinite(upperFaceMadan.pca.medianBpm, trial.upperFaceMadanPcaCwtMedianBpm),
    upperFaceMadanPcaCwtQuality: upperFaceMadan.pca.quality === 'ok' ? upperFaceMadan.pca.quality : trial.upperFaceMadanPcaCwtQuality,
    upperFaceMadanPosCwtBeats: firstFinite(upperFaceMadan.pos.beatCount, trial.upperFaceMadanPosCwtBeats),
    upperFaceMadanPosCwtMedianBpm: firstFinite(upperFaceMadan.pos.medianBpm, trial.upperFaceMadanPosCwtMedianBpm),
    upperFaceMadanPosCwtQuality: upperFaceMadan.pos.quality === 'ok' ? upperFaceMadan.pos.quality : trial.upperFaceMadanPosCwtQuality
  };
}

function countCwtBeats(rawSamples, startMs, endMs, durationSec) {
  const posValues = windowRows(rawSamples, startMs, endMs)
    .filter((sample) => sample.debugType === 'pos_sample' && Number.isFinite(Number(sample.posValue)))
    .map((sample) => Number(sample.posValue));
  if (!posValues.length) return null;
  const targetSamples = Math.floor(durationSec * PARAMS.targetFs);
  return new RPPGPipeline().countBeatsCWT(posValues, targetSamples);
}

function estimateLsBeats(hrSamples, startMs, endMs, durationSec) {
  const values = windowRows(hrSamples, startMs, endMs)
    .map((sample) => Number(sample.lsBpm))
    .filter(Number.isFinite);
  if (!values.length) return null;
  const avgLsHr = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (avgLsHr / 60) * durationSec;
}

function estimateMadanForSamples(samples, startMs, endMs, durationSec) {
  const windowSamples = windowRows(samples, startMs, endMs);
  return estimateMadanInterval({
    rgbSamples: windowSamples.filter((sample) => sample.debugType === 'frame'),
    posSamples: windowSamples.filter((sample) => sample.debugType === 'pos_sample'),
    startPerfMs: startMs,
    endPerfMs: endMs,
    durationSec
  });
}

function windowRows(samples, startMs, endMs) {
  return (samples ?? [])
    .map((sample) => ({ ...sample, perfMs: Number(sample.perfMs ?? sample.t) }))
    .filter((sample) => Number.isFinite(sample.perfMs) && sample.perfMs >= startMs && sample.perfMs <= endMs);
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function findTrialEvent(events, eventType, trial) {
  const candidates = events.filter((event) => (
    event.eventType === eventType
    && event.trialId === trial.trialId
    && (!trial.attemptId || event.attemptId === trial.attemptId || event.payload?.attemptId === trial.attemptId)
  ));
  return trial.attemptId ? candidates[0] : candidates[candidates.length - 1];
}

function computeDynamicAgreement(events, trialSummaries, polarSamples, rppgSamples) {
  const phaseAgreement = {};
  const alignedByPhase = {};
  for (const phase of PHASE_NAMES) {
    const window = phaseWindow(phase, events, trialSummaries);
    const aligned = window
      ? alignDynamicHr(polarSamples, rppgSamples, window.startMs, window.endMs)
      : [];
    alignedByPhase[phase] = aligned;
    phaseAgreement[phase] = {
      cwt: computePhaseAgreement(aligned, 'cwtBpm'),
      ls: computePhaseAgreement(aligned, 'lsBpm')
    };
  }
  const totalAligned = PHASE_NAMES.flatMap((phase) => alignedByPhase[phase]);
  phaseAgreement.TOTAL = {
    cwt: computePhaseAgreement(totalAligned, 'cwtBpm'),
    ls: computePhaseAgreement(totalAligned, 'lsBpm')
  };
  return phaseAgreement;
}

function phaseWindow(phase, events, trialSummaries) {
  const start = events.find((event) => event.eventType === 'phase_start' && event.phase === phase);
  const end = events.find((event) => event.eventType === 'phase_end' && event.phase === phase);
  if (start && end) return { startMs: start.perfMs, endMs: end.perfMs };

  const phaseTrials = trialSummaries.filter((trial) => trial.phase === phase);
  if (!phaseTrials.length) return null;
  const starts = phaseTrials.map((trial) => trial.startPerfMs).filter(Number.isFinite);
  const ends = phaseTrials.map((trial) => trial.endPerfMs).filter(Number.isFinite);
  if (!starts.length || !ends.length) return null;
  const startMs = phase === 'RECOVERY'
    ? recoveryWindowStart(events, Math.min(...starts))
    : Math.min(...starts);
  return { startMs, endMs: Math.max(...ends) };
}

function recoveryWindowStart(events, firstRecoveryTrialStartMs) {
  const lock = [...events]
    .reverse()
    .find((event) => event.eventType === 'pre_recovery_rppg_signal_lock' && Number.isFinite(event.perfMs));
  const preRecoveryStart = [...events]
    .reverse()
    .find((event) => event.eventType === 'pre_recovery_start' && Number.isFinite(event.perfMs));
  return lock?.perfMs ?? preRecoveryStart?.perfMs ?? firstRecoveryTrialStartMs;
}

function computeBeatCountIndexGroups(trialSummaries) {
  const groups = {};
  for (const group of INDEX_GROUPS) {
    const rows = group === 'TOTAL'
      ? trialSummaries
      : trialSummaries.filter((trial) => trial.phase === group);
    groups[group] = {};
    for (const [method, key] of BEAT_METHODS) {
      groups[group][method] = computeBeatCountIndices(rows, key);
    }
  }
  return groups;
}

export function computeBeatCountIndices(rows, estimateKey) {
  const usable = rows.filter((row) => (
    Number.isFinite(row.polarBeats) && Number.isFinite(row[estimateKey])
  ));
  const totalPolarBeats = roundMetric(sum(usable, 'polarBeats'), 3);
  const totalRppgBeats = roundMetric(sum(usable, estimateKey), 3);

  if (!usable.length || totalPolarBeats === 0) {
    return {
      totalPolarBeats,
      totalRppgBeats,
      signedError: null,
      absoluteError: null,
      percentError: null,
      alignmentIndex: null,
      inconsistencyIndex: null
    };
  }

  const signedError = totalRppgBeats - totalPolarBeats;
  const absoluteError = Math.abs(signedError);
  const inconsistency = absoluteError / totalPolarBeats;
  return {
    totalPolarBeats,
    totalRppgBeats,
    signedError: roundMetric(signedError),
    absoluteError: roundMetric(absoluteError),
    percentError: roundMetric((signedError / totalPolarBeats) * 100),
    alignmentIndex: roundMetric(1 - inconsistency),
    inconsistencyIndex: roundMetric(inconsistency)
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key] : 0), 0);
}

function alignmentIndex(estimate, polarBeats) {
  const inconsistency = inconsistencyIndex(estimate, polarBeats);
  return inconsistency === null ? null : roundMetric(1 - inconsistency);
}

function inconsistencyIndex(estimate, polarBeats) {
  if (!Number.isFinite(estimate) || !Number.isFinite(polarBeats) || polarBeats === 0) return null;
  return roundMetric(Math.abs(estimate - polarBeats) / polarBeats);
}

export function flattenParticipantSummary(summary) {
  const row = {
    session_id: summary.sessionId,
    participant_id: summary.participantId,
    created_at: summary.createdAt,
    language: summary.language,
    polar_connected: summary.polarConnected,
    trial_count: summary.trialSummaries.length,
    trial_metrics_json: JSON.stringify(summary.trialSummaries),
    beat_count_indices_json: JSON.stringify(summary.beatCountIndices),
    phase_metrics_json: JSON.stringify(summary.beatCountIndices)
  };

  for (const scope of INDEX_GROUPS) {
    const scopeKey = scope.toLowerCase();
    for (const [method] of BEAT_METHODS) {
      const indices = summary.beatCountIndices[scope][method];
      const methodKey = methodNameForColumn(method);
      row[`${scopeKey}_${methodKey}_polar_beats`] = indices.totalPolarBeats;
      row[`${scopeKey}_${methodKey}_rppg_beats`] = indices.totalRppgBeats;
      row[`${scopeKey}_${methodKey}_signed_error`] = indices.signedError;
      row[`${scopeKey}_${methodKey}_absolute_error`] = indices.absoluteError;
      row[`${scopeKey}_${methodKey}_percent_error`] = indices.percentError;
      row[`${scopeKey}_${methodKey}_alignment_index`] = indices.alignmentIndex;
      row[`${scopeKey}_${methodKey}_inconsistency_index`] = indices.inconsistencyIndex;
    }
  }

  return row;
}

function methodNameForColumn(method) {
  return method
    .replace(/^upperFace/, 'upper_face_')
    .replace('madanPcaCwt', 'madan_pca_cwt')
    .replace('madanPosCwt', 'madan_pos_cwt')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/__+/g, '_')
    .replace(/_$/, '');
}
