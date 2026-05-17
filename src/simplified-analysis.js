import {
  alignDynamicHr,
  computeErrorMetrics,
  computePhaseAgreement,
  integratePolarBeats,
  roundMetric
} from './metrics.js';

const MEASUREMENT_PHASES = ['BASELINE', 'RECOVERY'];
const INDEX_GROUPS = ['TOTAL', ...MEASUREMENT_PHASES];

export function summarizeSimplifiedSession(session) {
  const events = session.events ?? [];
  const polarSamples = session.polarSamples ?? [];
  const rppgSamples = session.rppgSamples ?? [];
  const intervals = session.intervals ?? [];

  const intervalSummaries = intervals.map((interval) => summarizeInterval(interval, polarSamples));
  const phaseAgreement = computeDynamicAgreement(events, intervalSummaries, polarSamples, rppgSamples);
  const beatCountIndices = computeBeatCountIndexGroups(intervalSummaries);

  return {
    sessionId: session.sessionId,
    participantId: session.participantId,
    createdAt: session.createdAt,
    language: session.language,
    workflow: 'simplified',
    polarConnected: polarSamples.length > 0,
    intervalSummaries,
    beatCountIndices,
    phaseAgreement
  };
}

function summarizeInterval(interval, polarSamples) {
  const startMs = interval.startPerfMs;
  const endMs = interval.endPerfMs;
  const durationSec = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? (endMs - startMs) / 1000
    : interval.durationSec;
  const polarBeats = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? integratePolarBeats(polarSamples, startMs, endMs)
    : null;
  const cwtBeats = roundMetric(interval.cwtBeats, 3);
  const lsBeats = roundMetric(interval.lsBeats, 3);
  const madanPcaCwtBeats = roundMetric(interval.madanPcaCwtBeats, 3);
  const madanPosCwtBeats = roundMetric(interval.madanPosCwtBeats, 3);

  return {
    intervalId: interval.intervalId,
    phase: interval.phase,
    intervalNumber: interval.intervalNumber,
    durationSec: roundMetric(durationSec, 3),
    startPerfMs: roundMetric(startMs, 3),
    endPerfMs: roundMetric(endMs, 3),
    polarBeats,
    cwtBeats,
    cwtRawBeats: roundMetric(interval.cwtRawBeats, 3),
    cwtAcceptedRatio: roundMetric(interval.cwtAcceptedRatio, 3),
    cwtMeanQuality: roundMetric(interval.cwtMeanQuality, 3),
    cwtTrust: interval.cwtTrust ?? null,
    cwtError: polarBeats === null ? null : computeErrorMetrics(cwtBeats ?? 0, polarBeats),
    lsBeats,
    lsError: polarBeats === null ? null : computeErrorMetrics(lsBeats ?? 0, polarBeats),
    madanPcaCwtBeats,
    madanPcaCwtMedianBpm: roundMetric(interval.madanPcaCwtMedianBpm, 3),
    madanPcaCwtQuality: interval.madanPcaCwtQuality ?? null,
    madanPcaCwtError: polarBeats === null ? null : computeErrorMetrics(madanPcaCwtBeats ?? 0, polarBeats),
    madanPosCwtBeats,
    madanPosCwtMedianBpm: roundMetric(interval.madanPosCwtMedianBpm, 3),
    madanPosCwtQuality: interval.madanPosCwtQuality ?? null,
    madanPosCwtError: polarBeats === null ? null : computeErrorMetrics(madanPosCwtBeats ?? 0, polarBeats)
  };
}

function computeDynamicAgreement(events, intervalSummaries, polarSamples, rppgSamples) {
  const alignedByPhase = {};
  const phaseAgreement = {};
  for (const phase of MEASUREMENT_PHASES) {
    const window = phaseWindow(phase, events, intervalSummaries);
    const aligned = window
      ? alignDynamicHr(polarSamples, rppgSamples, window.startMs, window.endMs)
      : [];
    alignedByPhase[phase] = aligned;
    phaseAgreement[phase] = {
      cwt: computePhaseAgreement(aligned, 'cwtBpm'),
      ls: computePhaseAgreement(aligned, 'lsBpm')
    };
  }

  const totalAligned = MEASUREMENT_PHASES.flatMap((phase) => alignedByPhase[phase]);
  phaseAgreement.TOTAL = {
    cwt: computePhaseAgreement(totalAligned, 'cwtBpm'),
    ls: computePhaseAgreement(totalAligned, 'lsBpm')
  };
  return phaseAgreement;
}

function phaseWindow(phase, events, intervalSummaries) {
  const start = events.find((event) => event.eventType === 'phase_start' && event.phase === phase);
  const end = events.find((event) => event.eventType === 'phase_end' && event.phase === phase);
  if (start && end) return { startMs: start.perfMs, endMs: end.perfMs };

  const phaseIntervals = intervalSummaries.filter((interval) => interval.phase === phase);
  const starts = phaseIntervals.map((interval) => interval.startPerfMs).filter(Number.isFinite);
  const ends = phaseIntervals.map((interval) => interval.endPerfMs).filter(Number.isFinite);
  if (!starts.length || !ends.length) return null;
  return { startMs: Math.min(...starts), endMs: Math.max(...ends) };
}

function computeBeatCountIndexGroups(intervalSummaries) {
  const groups = {};
  for (const group of INDEX_GROUPS) {
    const rows = group === 'TOTAL'
      ? intervalSummaries
      : intervalSummaries.filter((interval) => interval.phase === group);
    groups[group] = {
      cwt: computeBeatCountIndices(rows, 'cwtBeats'),
      ls: computeBeatCountIndices(rows, 'lsBeats'),
      madanPcaCwt: computeBeatCountIndices(rows, 'madanPcaCwtBeats'),
      madanPosCwt: computeBeatCountIndices(rows, 'madanPosCwtBeats')
    };
  }
  return groups;
}

export function computeBeatCountIndices(intervalSummaries, estimateKey) {
  const usable = intervalSummaries.filter((interval) => (
    Number.isFinite(interval.polarBeats) && Number.isFinite(interval[estimateKey])
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
  const inconsistencyIndex = absoluteError / totalPolarBeats;
  return {
    totalPolarBeats,
    totalRppgBeats,
    signedError: roundMetric(signedError),
    absoluteError: roundMetric(absoluteError),
    percentError: roundMetric((signedError / totalPolarBeats) * 100),
    alignmentIndex: roundMetric(1 - inconsistencyIndex),
    inconsistencyIndex: roundMetric(inconsistencyIndex)
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key] : 0), 0);
}

export function flattenSimplifiedParticipantSummary(summary) {
  const row = {
    session_id: summary.sessionId,
    participant_id: summary.participantId,
    created_at: summary.createdAt,
    language: summary.language,
    workflow: summary.workflow,
    polar_connected: summary.polarConnected,
    interval_count: summary.intervalSummaries.length,
    interval_metrics_json: JSON.stringify(summary.intervalSummaries),
    beat_count_indices_json: JSON.stringify(summary.beatCountIndices),
    phase_metrics_json: JSON.stringify(summary.phaseAgreement)
  };

  for (const scope of INDEX_GROUPS) {
    const key = scope.toLowerCase();
    for (const method of ['cwt', 'ls', 'madanPcaCwt', 'madanPosCwt']) {
      const indices = summary.beatCountIndices[scope][method];
      const snake = methodNameForColumn(method);
      row[`${key}_${snake}_polar_beats`] = indices.totalPolarBeats;
      row[`${key}_${snake}_rppg_beats`] = indices.totalRppgBeats;
      row[`${key}_${snake}_signed_error`] = indices.signedError;
      row[`${key}_${snake}_absolute_error`] = indices.absoluteError;
      row[`${key}_${snake}_percent_error`] = indices.percentError;
      row[`${key}_${snake}_alignment_index`] = indices.alignmentIndex;
      row[`${key}_${snake}_inconsistency_index`] = indices.inconsistencyIndex;
    }
  }

  for (const scope of INDEX_GROUPS) {
    const key = scope.toLowerCase();
    for (const method of ['cwt', 'ls']) {
      const metrics = summary.phaseAgreement[scope][method];
      row[`${key}_${method}_hr_n_seconds`] = metrics.nSeconds;
      row[`${key}_${method}_hr_mae`] = metrics.mae;
      row[`${key}_${method}_hr_rmse`] = metrics.rmse;
      row[`${key}_${method}_hr_bias`] = metrics.meanBias;
      row[`${key}_${method}_hr_mape`] = metrics.mape;
      row[`${key}_${method}_hr_pearson_r`] = metrics.pearsonR;
      row[`${key}_${method}_hr_lin_ccc`] = metrics.linCcc;
    }
  }

  return row;
}

function methodNameForColumn(method) {
  if (method === 'madanPcaCwt') return 'madan_pca_cwt';
  if (method === 'madanPosCwt') return 'madan_pos_cwt';
  return method;
}
