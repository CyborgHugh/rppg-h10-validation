import assert from 'node:assert/strict';
import { flattenParticipantSummary, summarizeSession } from '../main/src/analysis.js';

const session = {
  sessionId: 's1',
  participantId: 'p1',
  createdAt: '2026-05-06T00:00:00.000Z',
  language: 'en',
  polarSamples: [
    { perfMs: 0, hrBpm: 60 },
    { perfMs: 1000, hrBpm: 60 },
    { perfMs: 2000, hrBpm: 60 },
    { perfMs: 3000, hrBpm: 60 }
  ],
  rppgSamples: [
    { perfMs: 0, phase: 'BASELINE', cwtBpm: 62, lsBpm: 59 },
    { perfMs: 1000, phase: 'BASELINE', cwtBpm: 62, lsBpm: 61 },
    { perfMs: 2000, phase: 'BASELINE', cwtBpm: 62, lsBpm: 60 }
  ],
  events: [
    { perfMs: 0, eventType: 'phase_start', phase: 'BASELINE' },
    { perfMs: 0, eventType: 'trial_start', phase: 'BASELINE', trialId: 'baseline-1' },
    { perfMs: 3000, eventType: 'trial_end', phase: 'BASELINE', trialId: 'baseline-1' },
    { perfMs: 3000, eventType: 'phase_end', phase: 'BASELINE' }
  ],
  trials: [
    {
      trialId: 'baseline-1',
      phase: 'BASELINE',
      trialNumber: 1,
      durationSec: 3,
      subjectiveBeats: 3,
      cwtBeats: 3.1,
      lsBeats: 2.9,
      upperFaceCwtBeats: 3.2,
      upperFaceLsBeats: 2.8,
      upperFaceMadanPcaCwtBeats: 3.15,
      upperFaceMadanPcaCwtMedianBpm: 63,
      upperFaceMadanPcaCwtQuality: 'ok',
      upperFaceMadanPosCwtBeats: 2.85,
      upperFaceMadanPosCwtMedianBpm: 57,
      upperFaceMadanPosCwtQuality: 'ok',
      madanPcaCwtBeats: 3.05,
      madanPcaCwtMedianBpm: 61,
      madanPcaCwtQuality: 'ok',
      madanPosCwtBeats: 2.95,
      madanPosCwtMedianBpm: 59,
      madanPosCwtQuality: 'ok'
    }
  ]
};

const summary = summarizeSession(session);
assert.equal(summary.trialSummaries[0].polarBeats, 3);
assert.equal(summary.trialSummaries[0].cwtError.absoluteError, 0.1);
assert.equal(summary.trialSummaries[0].cwtAlignmentIndex, 0.966667);
assert.equal(summary.trialSummaries[0].upperFaceCwtError.absoluteError, 0.2);
assert.equal(summary.trialSummaries[0].upperFaceMadanPcaCwtError.absoluteError, 0.15);
assert.equal(summary.trialSummaries[0].madanPcaCwtError.absoluteError, 0.05);
assert.equal(summary.trialSummaries[0].madanPosCwtError.absoluteError, 0.05);
assert.equal(summary.phaseAgreement.BASELINE.cwt.nSeconds, 3);
assert.equal(summary.beatCountIndices.BASELINE.cwt.alignmentIndex, 0.966667);
assert.equal(summary.beatCountIndices.BASELINE.upperFaceCwt.alignmentIndex, 0.933333);
assert.equal(summary.beatCountIndices.TOTAL.upperFaceLs.totalRppgBeats, 2.8);

const row = flattenParticipantSummary(summary);
assert.equal(row.session_id, 's1');
assert.equal(row.participant_id, 'p1');
assert.equal(row.baseline_cwt_alignment_index, 0.966667);
assert.equal(row.baseline_upper_face_cwt_alignment_index, 0.933333);
assert.ok(row.trial_metrics_json.includes('baseline-1'));
assert.ok(row.beat_count_indices_json.includes('upperFaceCwt'));

const continuousSamples = Array.from({ length: 361 }, (_, index) => {
  const perfMs = index * (1000 / 30);
  const t = perfMs / 1000;
  const pulse = Math.sin(2 * Math.PI * 1.0 * t);
  return {
    frame: {
      perfMs,
      phase: 'BASELINE',
      debugType: 'frame',
      rawR: 100 + pulse * 2,
      rawG: 101 + pulse * 4,
      rawB: 99 - pulse * 2
    },
    pos: {
      perfMs,
      phase: 'BASELINE',
      debugType: 'pos_sample',
      posValue: pulse
    }
  };
});
const continuousUpperFaceSamples = continuousSamples.map(({ frame, pos }) => ({
  frame: {
    ...frame,
    rawR: frame.rawR + 1,
    rawG: frame.rawG + 1,
    rawB: frame.rawB + 1
  },
  pos: {
    ...pos,
    posValue: Math.sin(2 * Math.PI * 1.1 * (pos.perfMs / 1000))
  }
}));
const serverDerivedEstimates = summarizeSession({
  sessionId: 'derived',
  participantId: 'p2',
  createdAt: '2026-05-06T00:00:00.000Z',
  language: 'en',
  polarSamples: Array.from({ length: 13 }, (_, index) => ({ perfMs: index * 1000, hrBpm: 60 })),
  rppgSamples: Array.from({ length: 12 }, (_, index) => ({ perfMs: index * 1000, phase: 'BASELINE', cwtBpm: 60, lsBpm: 60 })),
  upperFaceRppgSamples: Array.from({ length: 12 }, (_, index) => ({ perfMs: index * 1000, phase: 'BASELINE', cwtBpm: 66, lsBpm: 66 })),
  rppgRawSamples: continuousSamples.flatMap(({ frame, pos }) => [frame, pos]),
  upperFaceRppgRawSamples: continuousUpperFaceSamples.flatMap(({ frame, pos }) => [frame, pos]),
  events: [
    { perfMs: 0, eventType: 'trial_start', phase: 'BASELINE', trialId: 'baseline-1', attemptId: 'baseline-1-attempt-1' },
    { perfMs: 12000, eventType: 'trial_end', phase: 'BASELINE', trialId: 'baseline-1', attemptId: 'baseline-1-attempt-1' }
  ],
  trials: [
    {
      trialId: 'baseline-1',
      attemptId: 'baseline-1-attempt-1',
      phase: 'BASELINE',
      trialNumber: 1,
      durationSec: 12,
      startPerfMs: 0,
      endPerfMs: 12000,
      subjectiveBeats: 12
    }
  ]
});

const derivedTrial = serverDerivedEstimates.trialSummaries[0];
assert.equal(derivedTrial.polarBeats, 12);
assert.ok(Number.isFinite(derivedTrial.cwtBeats), 'server analysis should derive primary CWT beats from continuous POS samples');
assert.equal(derivedTrial.lsBeats, 12);
assert.ok(Number.isFinite(derivedTrial.upperFaceCwtBeats), 'server analysis should derive upper-face CWT beats from continuous upper-face POS samples');
assert.equal(derivedTrial.upperFaceLsBeats, 13.2);
assert.ok(Number.isFinite(derivedTrial.madanPcaCwtBeats), 'server analysis should derive Madan PCA CWT beats from continuous raw RGB samples');
assert.equal(derivedTrial.madanPcaCwtQuality, 'ok');
assert.ok(Number.isFinite(derivedTrial.madanPosCwtBeats), 'server analysis should derive Madan POS CWT beats from continuous POS samples');
assert.equal(derivedTrial.madanPosCwtQuality, 'ok');
assert.ok(Number.isFinite(derivedTrial.upperFaceMadanPcaCwtBeats), 'server analysis should derive upper-face Madan PCA CWT beats');
assert.ok(Number.isFinite(derivedTrial.upperFaceMadanPosCwtBeats), 'server analysis should derive upper-face Madan POS CWT beats');

const delayedSubmission = summarizeSession({
  ...session,
  polarSamples: [
    { perfMs: 0, hrBpm: 60 },
    { perfMs: 1000, hrBpm: 60 },
    { perfMs: 2000, hrBpm: 60 },
    { perfMs: 3000, hrBpm: 60 },
    { perfMs: 4000, hrBpm: 60 },
    { perfMs: 5000, hrBpm: 60 }
  ],
  trials: [
    {
      trialId: 'baseline-1',
      phase: 'BASELINE',
      trialNumber: 1,
      durationSec: 3,
      startPerfMs: 0,
      endPerfMs: 5000,
      subjectiveBeats: 3,
      cwtBeats: 3,
      lsBeats: 3
    }
  ]
});

assert.equal(delayedSubmission.trialSummaries[0].endPerfMs, 3000);
assert.equal(delayedSubmission.trialSummaries[0].polarBeats, 3);

const recoveryWithPreBuffer = summarizeSession({
  ...session,
  polarSamples: [
    { perfMs: 9000, hrBpm: 90 },
    { perfMs: 10000, hrBpm: 91 },
    { perfMs: 11000, hrBpm: 92 },
    { perfMs: 12000, hrBpm: 93 }
  ],
  rppgSamples: [
    { perfMs: 9000, phase: 'PRE_RECOVERY', cwtBpm: 89, lsBpm: 90 },
    { perfMs: 10000, phase: 'RECOVERY', cwtBpm: 91, lsBpm: 91 },
    { perfMs: 11000, phase: 'RECOVERY', cwtBpm: 92, lsBpm: 92 }
  ],
  events: [
    { perfMs: 9000, eventType: 'pre_recovery_rppg_signal_lock', phase: 'PRE_RECOVERY' },
    { perfMs: 10000, eventType: 'trial_start', phase: 'RECOVERY', trialId: 'recovery-1' },
    { perfMs: 12000, eventType: 'trial_end', phase: 'RECOVERY', trialId: 'recovery-1' }
  ],
  trials: [
    { trialId: 'recovery-1', phase: 'RECOVERY', trialNumber: 1, durationSec: 2, subjectiveBeats: 3, cwtBeats: 3, lsBeats: 3 }
  ]
});

assert.equal(recoveryWithPreBuffer.phaseAgreement.RECOVERY.cwt.nSeconds, 3);

const retryAfterAbort = summarizeSession({
  ...session,
  polarSamples: [
    { perfMs: 0, hrBpm: 60 },
    { perfMs: 1000, hrBpm: 60 },
    { perfMs: 2000, hrBpm: 60 },
    { perfMs: 3000, hrBpm: 60 },
    { perfMs: 4000, hrBpm: 60 },
    { perfMs: 5000, hrBpm: 60 }
  ],
  events: [
    { perfMs: 0, eventType: 'trial_start', phase: 'BASELINE', trialId: 'baseline-1', attemptId: 'baseline-1-attempt-1' },
    { perfMs: 1000, eventType: 'trial_abort', phase: 'BASELINE', trialId: 'baseline-1', attemptId: 'baseline-1-attempt-1' },
    { perfMs: 2000, eventType: 'trial_start', phase: 'BASELINE', trialId: 'baseline-1', attemptId: 'baseline-1-attempt-2' },
    { perfMs: 5000, eventType: 'trial_end', phase: 'BASELINE', trialId: 'baseline-1', attemptId: 'baseline-1-attempt-2' }
  ],
  trials: [
    { trialId: 'baseline-1', attemptId: 'baseline-1-attempt-2', phase: 'BASELINE', trialNumber: 1, durationSec: 3, subjectiveBeats: 3, cwtBeats: 3, lsBeats: 3 }
  ]
});

assert.equal(retryAfterAbort.trialSummaries[0].startPerfMs, 2000);
assert.equal(retryAfterAbort.trialSummaries[0].polarBeats, 3);
