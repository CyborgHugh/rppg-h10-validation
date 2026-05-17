import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSimplifiedSession, finalizeSimplifiedSession } from '../src/simplified-storage.js';

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'rppg-simplified-storage-'));

try {
  const session = await createSimplifiedSession(dataRoot, { participantId: 'P002', language: 'en' });
  assert.equal(session.participantId, 'P002');

  const summary = await finalizeSimplifiedSession(dataRoot, {
    ...session,
    polarSamples: [
      { perfMs: 0, wallTime: '2026-05-11T00:00:00.000Z', hrBpm: 60, rrIntervalsMs: [] },
      { perfMs: 1000, wallTime: '2026-05-11T00:00:01.000Z', hrBpm: 60, rrIntervalsMs: [] },
      { perfMs: 30000, wallTime: '2026-05-11T00:00:30.000Z', hrBpm: 60, rrIntervalsMs: [] }
    ],
    rppgSamples: [
      {
        perfMs: 0,
        wallTime: '2026-05-11T00:00:00.000Z',
        phase: 'BASELINE',
        cwtBpm: 60,
        lsBpm: 60,
        cwtRawBpm: 60,
        cwtSmoothedBpm: 61,
        cwtAccepted: true,
        cwtQuality: 0.82,
        cwtFallbackReason: ''
      }
    ],
    rppgDebugSamples: [
      {
        perfMs: 0,
        wallTime: '2026-05-11T00:00:00.000Z',
        phase: 'BASELINE',
        cwtBpm: 60,
        lsBpm: 60,
        cwtBestPower: 12.5,
        cwtSecondBpm: 58,
        cwtPowerRatio: 1.4,
        signalClippedFraction: 0.02,
        cwtRawBpm: 60,
        cwtSmoothedBpm: 61,
        cwtAccepted: true,
        cwtQuality: 0.82
      }
    ],
    rppgRoiCandidates: [
      {
        perfMs: 0,
        wallTime: '2026-05-11T00:00:00.000Z',
        phase: 'BASELINE',
        roiName: 'forehead',
        roiX: 20,
        roiY: 18,
        roiWidth: 30,
        roiHeight: 12,
        skinPixelCount: 220,
        sampledPixelCount: 300,
        skinFraction: 0.733333,
        roiMotionPx: 1.5,
        accepted: true,
        rejectReason: '',
        roiR: 112,
        roiG: 98,
        roiB: 88
      }
    ],
    rppgSignalQualitySamples: [
      {
        perfMs: 0,
        wallTime: '2026-05-11T00:00:00.000Z',
        phase: 'BASELINE',
        roiSkinFraction: 0.75,
        roiMotionPx: 1.5,
        frameDeltaMs: 33,
        posValue: 0.01,
        cwtLsDivergenceBpm: 1,
        cwtAccepted: true,
        cwtQuality: 0.82
      }
    ],
    cwtPowerDiagnostics: [
      {
        perfMs: 0,
        wallTime: '2026-05-11T00:00:00.000Z',
        phase: 'BASELINE',
        cwtRawBpm: 60,
        cwtSmoothedBpm: 61,
        cwtPowerRatio: 1.4,
        cwtTopCandidatesJson: '[{"bpm":60,"power":12.5}]'
      }
    ],
    rppgRawSamples: [
      {
        perfMs: 0,
        wallTime: '2026-05-11T00:00:00.000Z',
        debugType: 'frame',
        rawR: 100,
        rawG: 101,
        rawB: 99,
        roiX: 10,
        roiY: 12,
        roiWidth: 80,
        roiHeight: 90,
        skinPixelCount: 1200,
        sampledPixelCount: 1600,
        skinFraction: 0.75,
        frameDeltaMs: 33
      },
      {
        perfMs: 33.333,
        wallTime: '2026-05-11T00:00:00.033Z',
        debugType: 'pos_sample',
        resampledR: 100.4,
        resampledG: 101.4,
        resampledB: 99.4,
        filteredR: 0.1,
        filteredG: 0.2,
        filteredB: 0.05,
        posValue: 0.01,
        posBufferLength: 1
      }
    ],
    events: [
      { perfMs: 0, wallTime: '2026-05-11T00:00:00.000Z', eventType: 'phase_start', phase: 'BASELINE' },
      { perfMs: 30000, wallTime: '2026-05-11T00:00:30.000Z', eventType: 'phase_end', phase: 'BASELINE' }
    ],
    intervals: [
      {
        intervalId: 'baseline-1',
        phase: 'BASELINE',
        intervalNumber: 1,
        startPerfMs: 0,
        endPerfMs: 30000,
        cwtBeats: 30,
        lsBeats: 30,
        madanPcaCwtBeats: 30.2,
        madanPcaCwtMedianBpm: 60.4,
        madanPcaCwtQuality: 'ok',
        madanPosCwtBeats: 29.8,
        madanPosCwtMedianBpm: 59.6,
        madanPosCwtQuality: 'ok'
      }
    ]
  });

  assert.equal(summary.intervalSummaries[0].polarBeats, 30);

  const sessionDir = path.join(dataRoot, 'sessions', session.sessionId);
  const intervalCsv = await readFile(path.join(sessionDir, 'interval_summary.csv'), 'utf8');
  assert.match(intervalCsv, /intervalId,phase,intervalNumber/);
  assert.match(intervalCsv, /baseline-1/);
  assert.match(intervalCsv, /madanPcaCwtBeats/);
  assert.match(intervalCsv, /madanPosCwtBeats/);
  assert.doesNotMatch(intervalCsv, /cwtGatedBeats/);

  const debugCsv = await readFile(path.join(sessionDir, 'rppg_debug.csv'), 'utf8');
  assert.match(debugCsv, /cwtBestPower/);
  assert.match(debugCsv, /signalClippedFraction/);

  const rawCsv = await readFile(path.join(sessionDir, 'rppg_raw_signal.csv'), 'utf8');
  assert.match(rawCsv, /debugType/);
  assert.match(rawCsv, /posValue/);
  assert.match(rawCsv, /skinFraction/);

  const roiCsv = await readFile(path.join(sessionDir, 'rppg_roi_candidates.csv'), 'utf8');
  assert.match(roiCsv, /roiName/);
  assert.match(roiCsv, /forehead/);

  const signalQualityCsv = await readFile(path.join(sessionDir, 'rppg_signal_quality.csv'), 'utf8');
  assert.match(signalQualityCsv, /cwtAccepted/);
  assert.match(signalQualityCsv, /roiSkinFraction/);

  const powerCsv = await readFile(path.join(sessionDir, 'cwt_power_diagnostics.csv'), 'utf8');
  assert.match(powerCsv, /cwtTopCandidatesJson/);
  assert.match(powerCsv, /cwtSmoothedBpm/);

  const sessionJson = JSON.parse(await readFile(path.join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(sessionJson.summary.intervalSummaries.length, 1);
  assert.equal(sessionJson.rppgDebugSamples.length, 1);
  assert.equal(sessionJson.rppgRawSamples.length, 2);
  assert.equal(sessionJson.rppgRoiCandidates.length, 1);
  assert.equal(sessionJson.rppgSignalQualitySamples.length, 1);
  assert.equal(sessionJson.cwtPowerDiagnostics.length, 1);
  assert.equal(sessionJson.summary.beatCountIndices.BASELINE.cwt.alignmentIndex, 1);
  assert.equal(sessionJson.summary.beatCountIndices.BASELINE.madanPcaCwt.alignmentIndex, 0.993333);

  const participantCsv = await readFile(path.join(dataRoot, 'participants_summary.csv'), 'utf8');
  assert.match(participantCsv, /baseline_cwt_alignment_index/);
  assert.match(participantCsv, /baseline_madan_pca_cwt_alignment_index/);
  assert.match(participantCsv, /P002/);
} finally {
  await rm(dataRoot, { recursive: true, force: true });
}
