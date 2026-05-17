import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCaptureAppServer } from '../capture/server.js';

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'rppg-capture-server-'));
const server = createCaptureAppServer({
  dataRoot,
  publicDir: path.resolve('capture/public'),
  sharedDir: path.resolve('shared')
});

await new Promise((resolve) => server.listen(0, resolve));

try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`).then((res) => res.json());
  assert.equal(health.workflow, 'raw-capture');

  const shared = await fetch(`${base}/shared/algorithm/manifest.js`);
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get('cache-control') ?? '', /no-store/);
  assert.match(await shared.text(), /ALGORITHM_MANIFEST/);

  const replayJs = await fetch(`${base}/replay.js`);
  assert.equal(replayJs.status, 200);
  assert.match(replayJs.headers.get('cache-control') ?? '', /no-store/);

  const session = await fetch(`${base}/api/capture/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: 'P011', language: 'en' })
  }).then((res) => res.json());
  assert.equal(session.participantId, 'P011');

  const sessions = await fetch(`${base}/api/capture/sessions`).then((res) => res.json());
  assert.ok(Array.isArray(sessions.sessions));
  assert.ok(sessions.sessions.some((entry) => entry.sessionId === session.sessionId));

  const chunk = await fetch(`${base}/api/capture/session/${encodeURIComponent(session.sessionId)}/video-chunk?chunkIndex=0`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/webm' },
    body: new Blob(['VIDEO'])
  });
  assert.equal(chunk.status, 200);

  const video = await fetch(`${base}/api/capture/session/${encodeURIComponent(session.sessionId)}/finalize-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chunkCount: 1, mimeType: 'video/webm' })
  }).then((res) => res.json());
  assert.equal(video.videoBytes, 5);

  await fetch(`${base}/api/capture/session/${encodeURIComponent(session.sessionId)}/finalize-metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...session,
      recordingManifest: { videoMimeType: 'video/webm' },
      polarSamples: [{ wallTime: '2026-05-13T00:00:00.000Z', perfMs: 0, hrBpm: 70, rrIntervalsMs: [] }],
      events: [],
      syncMarkers: []
    })
  });

  const manifest = await fetch(`${base}/api/capture/session/${encodeURIComponent(session.sessionId)}/manifest`).then((res) => res.json());
  assert.equal(manifest.sessionId, session.sessionId);

  const videoFetch = await fetch(`${base}/api/capture/session/${encodeURIComponent(session.sessionId)}/video`);
  assert.equal(videoFetch.status, 200);
  assert.equal(await videoFetch.text(), 'VIDEO');

  const replay = await fetch(`${base}/api/capture/session/${encodeURIComponent(session.sessionId)}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replayId: 'server_replay',
      algorithmManifest: { algorithmName: 'rppg-pos-ls-cwt' },
      rppgSamples: [],
      intervalSummaries: [],
      events: []
    })
  }).then((res) => res.json());
  assert.equal(replay.replayId, 'server_replay');
  await stat(path.join(dataRoot, 'sessions', session.sessionId, 'replays', 'server_replay', 'replay_manifest.json'));

  const traversal = await fetch(`${base}/api/capture/session/..%2Fbad/manifest`);
  assert.equal(traversal.status, 400);
} finally {
  server.close();
  await rm(dataRoot, { recursive: true, force: true });
}
