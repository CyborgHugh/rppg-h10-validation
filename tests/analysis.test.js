import assert from 'node:assert/strict';
import { flattenParticipantSummary, summarizeSession } from '../src/analysis.js';

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
    { trialId: 'baseline-1', phase: 'BASELINE', trialNumber: 1, durationSec: 3, subjectiveBeats: 3, cwtBeats: 3.1, lsBeats: 2.9 }
  ]
};

const summary = summarizeSession(session);
assert.equal(summary.trialSummaries[0].polarBeats, 3);
assert.equal(summary.trialSummaries[0].cwtError.absoluteError, 0.1);
assert.equal(summary.phaseAgreement.BASELINE.cwt.nSeconds, 3);

const row = flattenParticipantSummary(summary);
assert.equal(row.session_id, 's1');
assert.equal(row.participant_id, 'p1');
assert.ok(row.trial_metrics_json.includes('baseline-1'));

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
