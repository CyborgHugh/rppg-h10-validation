import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server.js';

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'rppg-h10-'));
const server = createAppServer({ dataRoot, publicDir: path.resolve('public') });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`).then((res) => res.json());
  assert.deepEqual(health, { ok: true });

  const session = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: 'P001', language: 'en' })
  }).then((res) => res.json());
  assert.equal(session.participantId, 'P001');

  const result = await fetch(`${base}/api/session/${encodeURIComponent(session.sessionId)}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...session,
      events: [
        { perfMs: 0, eventType: 'phase_start', phase: 'BASELINE' },
        { perfMs: 0, eventType: 'trial_start', phase: 'BASELINE', trialId: 'baseline-1' },
        { perfMs: 3000, eventType: 'trial_end', phase: 'BASELINE', trialId: 'baseline-1' },
        { perfMs: 3000, eventType: 'phase_end', phase: 'BASELINE' }
      ],
      polarSamples: [
        { perfMs: 0, wallTime: '2026-05-06T00:00:00.000Z', hrBpm: 60, rrIntervalsMs: [] },
        { perfMs: 1000, wallTime: '2026-05-06T00:00:01.000Z', hrBpm: 60, rrIntervalsMs: [] },
        { perfMs: 2000, wallTime: '2026-05-06T00:00:02.000Z', hrBpm: 60, rrIntervalsMs: [] },
        { perfMs: 3000, wallTime: '2026-05-06T00:00:03.000Z', hrBpm: 60, rrIntervalsMs: [] }
      ],
      rppgSamples: [
        { perfMs: 0, wallTime: '2026-05-06T00:00:00.000Z', phase: 'BASELINE', cwtBpm: 60, lsBpm: 60 }
      ],
      trials: [
        { trialId: 'baseline-1', phase: 'BASELINE', trialNumber: 1, durationSec: 3, subjectiveBeats: 3, cwtBeats: 3, lsBeats: 3 }
      ]
    })
  }).then((res) => res.json());
  assert.equal(result.ok, true);
  assert.equal(result.summary.trialSummaries[0].polarBeats, 3);

  const participantSummary = await readFile(path.join(dataRoot, 'participants_summary.csv'), 'utf8');
  assert.match(participantSummary, /P001/);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataRoot, { recursive: true, force: true });
}
