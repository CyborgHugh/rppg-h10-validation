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
