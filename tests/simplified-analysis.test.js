import assert from 'node:assert/strict';
import {
  computeBeatCountIndices,
  flattenSimplifiedParticipantSummary,
  summarizeSimplifiedSession
} from '../src/simplified-analysis.js';

const polarSamples = [];
const rppgSamples = [];
for (let second = 0; second <= 480; second += 1) {
  polarSamples.push({ perfMs: second * 1000, hrBpm: second < 180 ? 60 : 90 });
  if (second < 180 || (second >= 300 && second < 480)) {
    rppgSamples.push({
      perfMs: second * 1000,
      phase: second < 180 ? 'BASELINE' : 'RECOVERY',
      cwtBpm: second < 180 ? 62 : 88,
      lsBpm: second < 180 ? 59 : 92
    });
  }
}

const session = {
  sessionId: 'simp-1',
  participantId: 'P001',
  createdAt: '2026-05-11T00:00:00.000Z',
  language: 'en',
  polarSamples,
  rppgSamples,
  events: [
    { perfMs: 0, eventType: 'phase_start', phase: 'BASELINE' },
    { perfMs: 180000, eventType: 'phase_end', phase: 'BASELINE' },
    { perfMs: 180000, eventType: 'exercise_start', phase: 'EXERCISE' },
    { perfMs: 360000, eventType: 'exercise_end', phase: 'EXERCISE' },
    { perfMs: 360000, eventType: 'active_recovery_start', phase: 'ACTIVE_RECOVERY' },
    { perfMs: 390000, eventType: 'active_recovery_end', phase: 'ACTIVE_RECOVERY' },
    { perfMs: 390000, eventType: 'recalibration_start', phase: 'RECALIBRATION' },
    { perfMs: 300000, eventType: 'phase_start', phase: 'RECOVERY' },
    { perfMs: 480000, eventType: 'phase_end', phase: 'RECOVERY' }
  ],
  intervals: [
    { intervalId: 'baseline-1', phase: 'BASELINE', intervalNumber: 1, startPerfMs: 0, endPerfMs: 30000, cwtBeats: 31, lsBeats: 29.5, madanPcaCwtBeats: 30.5, madanPcaCwtMedianBpm: 61, madanPcaCwtQuality: 'ok', madanPosCwtBeats: 29.8, madanPosCwtMedianBpm: 59.6, madanPosCwtQuality: 'ok' },
    { intervalId: 'baseline-2', phase: 'BASELINE', intervalNumber: 2, startPerfMs: 30000, endPerfMs: 60000, cwtBeats: 31, lsBeats: 29.5 },
    { intervalId: 'baseline-3', phase: 'BASELINE', intervalNumber: 3, startPerfMs: 60000, endPerfMs: 90000, cwtBeats: 31, lsBeats: 29.5 },
    { intervalId: 'baseline-4', phase: 'BASELINE', intervalNumber: 4, startPerfMs: 90000, endPerfMs: 120000, cwtBeats: 31, lsBeats: 29.5 },
    { intervalId: 'baseline-5', phase: 'BASELINE', intervalNumber: 5, startPerfMs: 120000, endPerfMs: 150000, cwtBeats: 31, lsBeats: 29.5 },
    { intervalId: 'baseline-6', phase: 'BASELINE', intervalNumber: 6, startPerfMs: 150000, endPerfMs: 180000, cwtBeats: 31, lsBeats: 29.5 },
    { intervalId: 'recovery-1', phase: 'RECOVERY', intervalNumber: 1, startPerfMs: 300000, endPerfMs: 330000, cwtBeats: 44, lsBeats: 46 },
    { intervalId: 'recovery-2', phase: 'RECOVERY', intervalNumber: 2, startPerfMs: 330000, endPerfMs: 360000, cwtBeats: 44, lsBeats: 46 },
    { intervalId: 'recovery-3', phase: 'RECOVERY', intervalNumber: 3, startPerfMs: 360000, endPerfMs: 390000, cwtBeats: 44, lsBeats: 46 },
    { intervalId: 'recovery-4', phase: 'RECOVERY', intervalNumber: 4, startPerfMs: 390000, endPerfMs: 420000, cwtBeats: 44, lsBeats: 46 },
    { intervalId: 'recovery-5', phase: 'RECOVERY', intervalNumber: 5, startPerfMs: 420000, endPerfMs: 450000, cwtBeats: 44, lsBeats: 46 },
    { intervalId: 'recovery-6', phase: 'RECOVERY', intervalNumber: 6, startPerfMs: 450000, endPerfMs: 480000, cwtBeats: 44, lsBeats: 46 }
  ]
};

const summary = summarizeSimplifiedSession(session);

assert.equal(summary.intervalSummaries.length, 12);
assert.equal(summary.intervalSummaries[0].durationSec, 30);
assert.equal(summary.intervalSummaries[0].polarBeats, 30);
assert.equal(summary.intervalSummaries[0].cwtError.signedError, 1);
assert.equal(summary.intervalSummaries[0].madanPcaCwtError.signedError, 0.5);
assert.equal(summary.intervalSummaries[0].madanPosCwtError.signedError, -0.2);
assert.equal(summary.intervalSummaries[0].cwtGatedBeats, undefined);
assert.equal(summary.intervalSummaries[0].lsError.signedError, -0.5);
assert.equal(summary.intervalSummaries[6].polarBeats, 45);
assert.equal(summary.beatCountIndices.BASELINE.cwt.totalPolarBeats, 180);
assert.equal(summary.beatCountIndices.BASELINE.cwt.totalRppgBeats, 186);
assert.equal(summary.beatCountIndices.BASELINE.cwt.alignmentIndex, 0.966667);
assert.equal(summary.beatCountIndices.BASELINE.madanPcaCwt.totalRppgBeats, 30.5);
assert.equal(summary.beatCountIndices.BASELINE.madanPosCwt.totalRppgBeats, 29.8);
assert.equal(summary.beatCountIndices.BASELINE.cwtGated, undefined);
assert.equal(summary.beatCountIndices.RECOVERY.ls.inconsistencyIndex, 0.022222);
assert.equal(summary.beatCountIndices.TOTAL.cwt.totalPolarBeats, 450);
assert.equal(summary.phaseAgreement.TOTAL.cwt.nSeconds, 360);
assert.equal(summary.phaseAgreement.BASELINE.ls.meanBias, -1);
assert.equal(summary.phaseAgreement.RECOVERY.cwt.meanBias, -2);

assert.deepEqual(computeBeatCountIndices([], 'cwtBeats'), {
  totalPolarBeats: 0,
  totalRppgBeats: 0,
  signedError: null,
  absoluteError: null,
  percentError: null,
  alignmentIndex: null,
  inconsistencyIndex: null
});

const row = flattenSimplifiedParticipantSummary(summary);
assert.equal(row.session_id, 'simp-1');
assert.equal(row.interval_count, 12);
assert.equal(row.baseline_cwt_alignment_index, 0.966667);
assert.equal(row.baseline_madan_pca_cwt_alignment_index, 0.983333);
assert.ok(row.interval_metrics_json.includes('baseline-1'));
