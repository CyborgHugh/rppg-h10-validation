import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSimplifiedAppServer } from '../simplified/server.js';

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'rppg-simplified-server-'));
const server = createSimplifiedAppServer({
  dataRoot,
  publicDir: path.resolve('simplified/public'),
  sharedDir: path.resolve('shared')
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`).then((res) => res.json());
  assert.deepEqual(health, { ok: true, workflow: 'simplified' });

  const shared = await fetch(`${base}/shared/algorithm/manifest.js`);
  assert.equal(shared.status, 200);
  assert.match(await shared.text(), /ALGORITHM_MANIFEST/);

  const session = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: 'P003', language: 'en' })
  }).then((res) => res.json());
  assert.equal(session.participantId, 'P003');

  const result = await fetch(`${base}/api/session/${encodeURIComponent(session.sessionId)}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...session,
      polarSamples: [
        { perfMs: 0, wallTime: '2026-05-11T00:00:00.000Z', hrBpm: 60, rrIntervalsMs: [] },
        { perfMs: 30000, wallTime: '2026-05-11T00:00:30.000Z', hrBpm: 60, rrIntervalsMs: [] }
      ],
      rppgSamples: [
        { perfMs: 0, wallTime: '2026-05-11T00:00:00.000Z', phase: 'BASELINE', cwtBpm: 61, lsBpm: 59 }
      ],
      events: [
        { perfMs: 0, wallTime: '2026-05-11T00:00:00.000Z', eventType: 'phase_start', phase: 'BASELINE' },
        { perfMs: 30000, wallTime: '2026-05-11T00:00:30.000Z', eventType: 'phase_end', phase: 'BASELINE' }
      ],
      intervals: [
        { intervalId: 'baseline-1', phase: 'BASELINE', intervalNumber: 1, startPerfMs: 0, endPerfMs: 30000, cwtBeats: 30.5, lsBeats: 29.5 }
      ]
    })
  }).then((res) => res.json());

  assert.equal(result.ok, true);
  assert.equal(result.summary.intervalSummaries[0].polarBeats, 30);

  const participantSummary = await readFile(path.join(dataRoot, 'participants_summary.csv'), 'utf8');
  assert.match(participantSummary, /total_cwt_alignment_index/);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataRoot, { recursive: true, force: true });
}
