import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendVideoChunk,
  createCaptureSession,
  finalizeCaptureMetadata,
  finalizeCaptureVideo,
  saveReplayResult
} from '../src/capture-storage.js';

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'rppg-capture-storage-'));

try {
  const session = await createCaptureSession(dataRoot, { participantId: 'P010', language: 'en' });
  assert.equal(session.workflow, 'raw-capture');

  await appendVideoChunk(dataRoot, session.sessionId, Buffer.from('AAA'), {
    chunkIndex: 0,
    mimeType: 'video/webm'
  });
  await appendVideoChunk(dataRoot, session.sessionId, Buffer.from('BBB'), {
    chunkIndex: 1,
    mimeType: 'video/webm'
  });
  const videoInfo = await finalizeCaptureVideo(dataRoot, session.sessionId, {
    chunkCount: 2,
    mimeType: 'video/webm'
  });
  assert.equal(videoInfo.videoBytes, 6);
  assert.equal(await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'video.webm'), 'utf8'), 'AAABBB');

  await finalizeCaptureMetadata(dataRoot, {
    ...session,
    recordingManifest: { videoMimeType: 'video/webm', width: 640, height: 480 },
    polarSamples: [{ wallTime: '2026-05-13T00:00:00.000Z', perfMs: 0, hrBpm: 72, rrIntervalsMs: [833] }],
    events: [{ wallTime: '2026-05-13T00:00:00.000Z', perfMs: 0, eventType: 'phase_start', phase: 'BASELINE' }],
    syncMarkers: [{ wallTime: '2026-05-13T00:00:00.000Z', perfMs: 0, markerType: 'recording_start' }]
  });

  const manifest = JSON.parse(await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'recording_manifest.json'), 'utf8'));
  assert.equal(manifest.video.finalized, true);
  assert.equal(manifest.recordingManifest.videoMimeType, 'video/webm');
  assert.match(await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'polar_rr.csv'), 'utf8'), /833/);

  const replay = await saveReplayResult(dataRoot, session.sessionId, {
    replayId: 'replay_001',
    algorithmManifest: { algorithmName: 'rppg-pos-ls-cwt', sourceHash: 'abc123' },
    replayConfig: {
      roiMode: 'boxRectLegacy',
      roiComposition: 'all',
      skinMode: 'hardYcbcr',
      targetFs: 30,
      cwtMode: 'raw+gated'
    },
    rppgSamples: [{
      wallTime: '2026-05-13T00:00:01.000Z',
      perfMs: 1000,
      cwtBpm: 72,
      cwtGatedBpm: 73,
      cwtRawAccepted: false,
      cwtGatedAccepted: true,
      cwtRejectReason: 'flat_power',
      lsBpm: 73,
      targetFs: 30,
      roiMode: 'boxRectLegacy',
      roiComposition: 'all',
      skinMode: 'hardYcbcr',
      interEyeDeltaPct: 6,
      interEyeVelocityPctPerSec: 6,
      scaleJump: true
    }],
    foreheadOnlyRppgSamples: [{ perfMs: 1000, foreheadOnlyCwtBpm: 72, foreheadOnlyLsBpm: 73 }],
    cheeksOnlyRppgSamples: [{ perfMs: 1000, cheeksOnlyCwtBpm: 71, cheeksOnlyLsBpm: 72 }],
    upperFaceRppgSamples: [{ perfMs: 1000, upperFaceCwtBpm: 70, upperFaceLsBpm: 71 }],
    rppgRoiCandidates: [{
      perfMs: 1000,
      roiName: 'forehead',
      roiMode: 'boxRectLegacy',
      roiComposition: 'all',
      patchAreaPx: 800,
      fixedSampleCount: 96,
      effectiveSkinSampleCount: 90,
      interEyeDeltaPct: 6,
      scaleJump: true
    }],
    rppgSignalQualitySamples: [{
      perfMs: 1000,
      patchAreaPx: 800,
      fixedSampleCount: 288,
      effectiveSkinSampleCount: 250,
      interEyeDistancePx: 100,
      interEyeDeltaPct: 6,
      interEyeVelocityPctPerSec: 6,
      scaleJump: true
    }],
    cwtPowerDiagnostics: [{ perfMs: 1000, cwtPowerRatio: 1.01 }],
    intervalSummaries: [{
      intervalId: 'baseline-1',
      phase: 'BASELINE',
      cwtBeats: 36,
      lsBeats: 36,
      polarBeats: 36,
      foreheadCheekCwtBeats: 36,
      foreheadCheekLsBeats: 37,
      upperFaceCwtBeats: 34,
      upperFaceLsBeats: 35,
      foreheadCheekCwtRawBeats: 36,
      foreheadCheekMadanPcaCwtBeats: 36.5,
      foreheadCheekMadanPosCwtBeats: 35.8,
      foreheadOnlyCwtBeats: 35,
      foreheadOnlyMadanPcaCwtBeats: 35.2,
      foreheadOnlyMadanPosCwtBeats: 34.8,
      foreheadOnlyLsBeats: 36,
      cheeksOnlyCwtBeats: 36,
      cheeksOnlyMadanPcaCwtBeats: 36.1,
      cheeksOnlyMadanPosCwtBeats: 36.2,
      cheeksOnlyLsBeats: 37
    }],
    events: [{ wallTime: '2026-05-13T00:00:00.000Z', perfMs: 0, eventType: 'phase_start', phase: 'BASELINE' }]
  });

  assert.equal(replay.replayId, 'replay_001');
  const replayManifestPath = path.join(dataRoot, 'sessions', session.sessionId, 'replays', 'replay_001', 'replay_manifest.json');
  await stat(replayManifestPath);
  const replayManifest = JSON.parse(await readFile(replayManifestPath, 'utf8'));
  assert.equal(replayManifest.replayConfig.roiMode, 'boxRectLegacy');
  assert.equal(replayManifest.replayConfig.roiComposition, 'all');
  assert.equal(replayManifest.replayConfig.targetFs, 30);
  assert.match(
    await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'replays', 'replay_001', 'rppg_hr_1hz.csv'), 'utf8'),
    /cwtGatedBpm/
  );
  const intervalSummary = await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'replays', 'replay_001', 'interval_summary.csv'), 'utf8');
  assert.match(intervalSummary, /foreheadCheekCwtBeats/);
  assert.match(intervalSummary, /foreheadCheekLsBeats/);
  assert.match(intervalSummary, /foreheadOnlyCwtBeats/);
  assert.match(intervalSummary, /cheeksOnlyCwtBeats/);
  assert.match(intervalSummary, /foreheadCheekMadanPcaCwtBeats/);
  assert.match(intervalSummary, /foreheadOnlyMadanPosCwtBeats/);
  assert.match(intervalSummary, /upperFaceCwtBeats/);
  assert.match(intervalSummary, /upperFaceLsBeats/);
  assert.doesNotMatch(intervalSummary, /cwtGatedBeats|CwtGatedBeats/);
  assert.match(
    await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'replays', 'replay_001', 'rppg_roi_candidates.csv'), 'utf8'),
    /fixedSampleCount/
  );
  assert.match(
    await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'replays', 'replay_001', 'rppg_signal_quality.csv'), 'utf8'),
    /interEyeDeltaPct/
  );
  assert.match(
    await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'replays', 'replay_001', 'rppg_forehead_only_1hz.csv'), 'utf8'),
    /foreheadOnlyCwtBpm/
  );
  assert.match(
    await readFile(path.join(dataRoot, 'sessions', session.sessionId, 'replays', 'replay_001', 'rppg_cheeks_only_1hz.csv'), 'utf8'),
    /cheeksOnlyCwtBpm/
  );
} finally {
  await rm(dataRoot, { recursive: true, force: true });
}
