import assert from 'node:assert/strict';
import { summarizeReplayDiagnostics } from '../scripts/diagnose-capture-replay.js';

const summary = summarizeReplayDiagnostics({
  intervalSummaries: [
    { phase: 'BASELINE', polarBeats: 40, cwtRawBeats: 43, lsBeats: 39.8, madanPcaCwtBeats: 40.5, madanPosCwtBeats: 41 },
    { phase: 'RECOVERY', polarBeats: 55, cwtRawBeats: 50, lsBeats: 54.5, madanPcaCwtBeats: 54, madanPosCwtBeats: 56 }
  ],
  rppgSamples: [
    { perfMs: 1000, phase: 'BASELINE', cwtBpm: 130, cwtGatedBpm: 80, lsBpm: 79, cwtRejectReason: 'flat_power|cwt_ls_divergence' },
    { perfMs: 2000, phase: 'BASELINE', cwtBpm: 70, cwtGatedBpm: 80, lsBpm: 80, cwtRejectReason: 'flat_power' },
    { perfMs: 3000, phase: 'RECOVERY', cwtBpm: 110, cwtGatedBpm: 109, lsBpm: 108, cwtRejectReason: '' }
  ],
  polarSamples: [
    { perfMs: 1000, hrBpm: 80 },
    { perfMs: 2000, hrBpm: 81 },
    { perfMs: 3000, hrBpm: 109 }
  ],
  signalQualitySamples: [
    { perfMs: 1000, roiMotionPx: 1, roiSkinFraction: 0.9, frameGapCount: 0, interEyeDistancePx: 100, interEyeVelocityPctPerSec: 1, scaleJump: false, fixedSampleCount: 288, effectiveSkinSampleCount: 250, patchAreaPx: 800 },
    { perfMs: 2000, roiMotionPx: 40, roiSkinFraction: 0.2, frameGapCount: 1, interEyeDistancePx: 112, interEyeVelocityPctPerSec: 12, scaleJump: true, fixedSampleCount: 288, effectiveSkinSampleCount: 80, patchAreaPx: 1000 },
    { perfMs: 3000, roiMotionPx: 2, roiSkinFraction: 0.95, frameGapCount: 1, interEyeDistancePx: 104, interEyeVelocityPctPerSec: 8, scaleJump: false, fixedSampleCount: 288, effectiveSkinSampleCount: 270, patchAreaPx: 850 }
  ],
  roiCandidateSamples: [
    { perfMs: 1000, roiName: 'forehead', patchAreaPx: 800, fixedSampleCount: 96, effectiveSkinSampleCount: 90 },
    { perfMs: 2000, roiName: 'forehead', patchAreaPx: 1000, fixedSampleCount: 96, effectiveSkinSampleCount: 45 },
    { perfMs: 3000, roiName: 'forehead', patchAreaPx: 850, fixedSampleCount: 96, effectiveSkinSampleCount: 92 }
  ],
  cwtPowerDiagnostics: [
    { perfMs: 1000, cwtPowerRatio: 1.0005 },
    { perfMs: 2000, cwtPowerRatio: 1.001 },
    { perfMs: 3000, cwtPowerRatio: 1.02 }
  ]
});

assert.equal(summary.intervals.count, 2);
assert.equal(summary.intervals.cwtGated, undefined);
assert.ok(summary.intervals.cwtRaw.mae > summary.intervals.madanPcaCwt.mae);
assert.ok(summary.intervals.cwtRaw.mae > summary.intervals.madanPosCwt.mae);
assert.equal(summary.failureReasons.flat_power, 2);
assert.equal(summary.failureReasons.cwt_ls_divergence, 1);
assert.equal(summary.frameGapCount, 1);
assert.ok(summary.cwt.rawJumpMean > 0);
assert.ok(summary.cwt.powerRatioMedian > 1);
assert.equal(summary.roi.scaleJumpCount, 1);
assert.equal(summary.roi.fixedSampleCountMedian, 96);
assert.equal(summary.roi.interEyeDistanceP50, 104);
assert.equal(summary.roi.interEyeVelocityP95, 12);
