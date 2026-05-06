import {
  alignDynamicHr,
  computeErrorMetrics,
  computePhaseAgreement,
  integratePolarBeats,
  roundMetric
} from './metrics.js';

const PHASE_NAMES = ['BASELINE', 'RECOVERY'];

export function summarizeSession(session) {
  const events = session.events ?? [];
  const polarSamples = session.polarSamples ?? [];
  const rppgSamples = session.rppgSamples ?? [];
  const trials = session.trials ?? [];

  const trialSummaries = trials
    .filter((trial) => trial.phase !== 'PRACTICE')
    .map((trial) => summarizeTrial(trial, events, polarSamples));

  const phaseAgreement = {};
  for (const phase of PHASE_NAMES) {
    const window = phaseWindow(phase, events, trialSummaries);
    const aligned = window
      ? alignDynamicHr(polarSamples, rppgSamples, window.startMs, window.endMs)
      : [];
    phaseAgreement[phase] = {
      cwt: computePhaseAgreement(aligned, 'cwtBpm'),
      ls: computePhaseAgreement(aligned, 'lsBpm')
    };
  }

  return {
    sessionId: session.sessionId,
    participantId: session.participantId,
    createdAt: session.createdAt,
    language: session.language,
    polarConnected: polarSamples.length > 0,
    trialSummaries,
    phaseAgreement
  };
}

function summarizeTrial(trial, events, polarSamples) {
  const startEvent = findTrialEvent(events, 'trial_start', trial.trialId);
  const endEvent = findTrialEvent(events, 'trial_end', trial.trialId);
  const startMs = Number.isFinite(trial.startPerfMs) ? trial.startPerfMs : startEvent?.perfMs;
  const endMs = Number.isFinite(trial.endPerfMs) ? trial.endPerfMs : endEvent?.perfMs;
  const durationSec = trial.durationSec ?? ((endMs - startMs) / 1000);
  const polarBeats = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? integratePolarBeats(polarSamples, startMs, endMs)
    : null;
  const cwtError = polarBeats === null ? null : computeErrorMetrics(trial.cwtBeats ?? 0, polarBeats);
  const lsError = polarBeats === null ? null : computeErrorMetrics(trial.lsBeats ?? 0, polarBeats);

  return {
    trialId: trial.trialId,
    phase: trial.phase,
    trialNumber: trial.trialNumber,
    durationSec: roundMetric(durationSec, 3),
    startPerfMs: roundMetric(startMs, 3),
    endPerfMs: roundMetric(endMs, 3),
    subjectiveBeats: trial.subjectiveBeats,
    polarBeats,
    cwtBeats: roundMetric(trial.cwtBeats, 3),
    lsBeats: roundMetric(trial.lsBeats, 3),
    cwtError,
    lsError
  };
}

function findTrialEvent(events, eventType, trialId) {
  return events.find((event) => event.eventType === eventType && event.trialId === trialId);
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
  return { startMs: Math.min(...starts), endMs: Math.max(...ends) };
}

export function flattenParticipantSummary(summary) {
  return {
    session_id: summary.sessionId,
    participant_id: summary.participantId,
    created_at: summary.createdAt,
    language: summary.language,
    polar_connected: summary.polarConnected,
    trial_count: summary.trialSummaries.length,
    baseline_cwt_mae: summary.phaseAgreement.BASELINE.cwt.mae,
    baseline_cwt_rmse: summary.phaseAgreement.BASELINE.cwt.rmse,
    baseline_cwt_bias: summary.phaseAgreement.BASELINE.cwt.meanBias,
    baseline_cwt_pearson_r: summary.phaseAgreement.BASELINE.cwt.pearsonR,
    baseline_cwt_lin_ccc: summary.phaseAgreement.BASELINE.cwt.linCcc,
    baseline_ls_mae: summary.phaseAgreement.BASELINE.ls.mae,
    baseline_ls_rmse: summary.phaseAgreement.BASELINE.ls.rmse,
    baseline_ls_bias: summary.phaseAgreement.BASELINE.ls.meanBias,
    baseline_ls_pearson_r: summary.phaseAgreement.BASELINE.ls.pearsonR,
    baseline_ls_lin_ccc: summary.phaseAgreement.BASELINE.ls.linCcc,
    recovery_cwt_mae: summary.phaseAgreement.RECOVERY.cwt.mae,
    recovery_cwt_rmse: summary.phaseAgreement.RECOVERY.cwt.rmse,
    recovery_cwt_bias: summary.phaseAgreement.RECOVERY.cwt.meanBias,
    recovery_cwt_pearson_r: summary.phaseAgreement.RECOVERY.cwt.pearsonR,
    recovery_cwt_lin_ccc: summary.phaseAgreement.RECOVERY.cwt.linCcc,
    recovery_ls_mae: summary.phaseAgreement.RECOVERY.ls.mae,
    recovery_ls_rmse: summary.phaseAgreement.RECOVERY.ls.rmse,
    recovery_ls_bias: summary.phaseAgreement.RECOVERY.ls.meanBias,
    recovery_ls_pearson_r: summary.phaseAgreement.RECOVERY.ls.pearsonR,
    recovery_ls_lin_ccc: summary.phaseAgreement.RECOVERY.ls.linCcc,
    trial_metrics_json: JSON.stringify(summary.trialSummaries),
    phase_metrics_json: JSON.stringify(summary.phaseAgreement)
  };
}
