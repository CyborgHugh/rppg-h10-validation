import assert from 'node:assert/strict';
import { RPPGPipeline } from '../shared/algorithm/rppg-pipeline.js';

{
  const pipeline = new RPPGPipeline();
  pipeline.pushFrame(100, 100, 100, 0);
  pipeline.pushFrame(101, 101, 101, 33);
  const beforeGapLength = pipeline.resampledBuffer.length;

  pipeline.pushFrame(102, 102, 102, 10000);

  assert.ok(
    pipeline.resampledBuffer.length <= beforeGapLength + 2,
    `expected gap handling to avoid backfilling hundreds of samples, got ${pipeline.resampledBuffer.length - beforeGapLength}`
  );
}

{
  const resets = [];
  const pipeline = new RPPGPipeline({ onContinuityReset: (event) => resets.push(event) });
  pipeline.pushFrame(100, 100, 100, 0, { phase: 'RECOVERY' });
  pipeline.pushFrame(101, 101, 101, 33, { phase: 'RECOVERY' });

  pipeline.pushFrame(102, 102, 102, 10000, { phase: 'RECOVERY' });

  assert.equal(resets.length, 1);
  assert.equal(resets[0].reason, 'frame_gap');
  assert.equal(resets[0].phase, 'RECOVERY');
  assert.ok(resets[0].frameDeltaMs > 500);
  assert.equal(resets[0].time, 10000);
}

{
  const samples = [];
  const pipeline = new RPPGPipeline({ targetFs: 12, onHr: (sample) => samples.push(sample) });
  assert.equal(pipeline.targetFs, 12);

  for (let i = 0; i < 480; i += 1) {
    const t = i * (1000 / 30);
    const pulse = Math.sin(2 * Math.PI * 1.2 * (t / 1000));
    pipeline.pushFrame(100 + 2 * pulse, 101 + 5 * pulse, 99 - 2 * pulse, t);
  }

  assert.ok(pipeline.posBuffer.length >= 80);
  assert.ok(samples.some((sample) => Math.abs(sample.lsBpm - 72) < 8));
  assert.ok(samples.every((sample) => sample.targetFs === 12));
  assert.ok(samples.every((sample) => sample.downsampleMode === 'temporalAverage'));
}

{
  const pipeline = new RPPGPipeline();
  pipeline.lastAcceptedCwtBpm = 80;
  pipeline.lastSmoothedCwtBpm = 80;
  pipeline.lastGatedCwtBpm = 80;
  pipeline.lastCwtDiagnosticTime = 1000;
  pipeline.pushFrame(100, 101, 99, 0);
  pipeline.pushFrame(101, 102, 100, 33);

  pipeline.pushFrame(102, 103, 101, 2000, { roiMotionPx: 1 });

  assert.equal(pipeline.lastAcceptedCwtBpm, null);
  assert.equal(pipeline.lastSmoothedCwtBpm, null);
  assert.equal(pipeline.lastGatedCwtBpm, null);
  assert.equal(pipeline.frameGapCount, 1);
}

{
  const samples = [];
  const readySamples = [];
  const pipeline = new RPPGPipeline({
    onHr: (sample) => samples.push(sample),
    onReady: (sample) => readySamples.push(sample)
  });

  for (let i = 0; i < 360; i += 1) {
    const t = i * (1000 / 30);
    const pulse = 100 + 4 * Math.sin(2 * Math.PI * 1.2 * (t / 1000));
    pipeline.pushFrame(pulse, pulse + 1, pulse - 1, t);
  }

  assert.ok(pipeline.posBuffer.length >= 300);
  assert.ok(samples.length > 0);
  assert.ok(readySamples.length > 0);
}

{
  const rawSamples = [];
  const pipeline = new RPPGPipeline({ onRawSample: (sample) => rawSamples.push(sample) });

  pipeline.pushFrame(100, 101, 99, 0, {
    roiX: 10,
    roiY: 12,
    roiWidth: 80,
    roiHeight: 90,
    skinPixelCount: 1200,
    sampledPixelCount: 1600,
    skinFraction: 0.75
  });
  pipeline.pushFrame(101, 102, 100, 33, {
    roiX: 11,
    roiY: 13,
    roiWidth: 81,
    roiHeight: 91,
    skinPixelCount: 1210,
    sampledPixelCount: 1620,
    skinFraction: 0.746914
  });
  for (let i = 2; i < 60; i += 1) {
    pipeline.pushFrame(100 + Math.sin(i / 4), 101 + Math.sin(i / 4), 99 + Math.sin(i / 4), i * (1000 / 30), {
      roiX: 11,
      roiY: 13,
      roiWidth: 81,
      roiHeight: 91,
      skinPixelCount: 1210,
      sampledPixelCount: 1620,
      skinFraction: 0.746914
    });
  }

  assert.equal(rawSamples[0].debugType, 'frame');
  assert.equal(rawSamples[0].rawR, 100);
  assert.equal(rawSamples[0].roiX, 10);
  assert.equal(rawSamples[0].skinFraction, 0.75);
  assert.equal(rawSamples[1].frameDeltaMs, 33);
  assert.ok(rawSamples.some((sample) => sample.debugType === 'pos_sample'));
  const posSample = rawSamples.find((sample) => sample.debugType === 'pos_sample');
  assert.ok(Number.isFinite(posSample.posValue));
  assert.ok(Number.isFinite(posSample.resampledR));
  assert.ok(Number.isFinite(posSample.filteredG));
}

{
  const pipeline = new RPPGPipeline();
  const fs = 30;
  const signal = [];
  for (let i = 0; i < fs * 10; i += 1) {
    const t = i / fs;
    signal.push(Math.sin(2 * Math.PI * 1.2 * t));
  }
  const cleanBpm = pipeline.runCWTOnBuffer(signal, signal.length);
  const spikeSignal = [...signal];
  spikeSignal[150] += 30;
  const spikeBpm = pipeline.runCWTOnBuffer(spikeSignal, spikeSignal.length);

  assert.equal(cleanBpm, 72);
  assert.ok(
    Math.abs(spikeBpm - cleanBpm) <= 6,
    `expected CWT estimate to resist a single-frame spike, got clean=${cleanBpm}, spike=${spikeBpm}`
  );
}

{
  const pipeline = new RPPGPipeline();
  const fs = 30;
  const signal = [];
  for (let i = 0; i < fs * 30; i += 1) {
    const t = i / fs;
    signal.push(Math.sin(2 * Math.PI * 1.2 * t));
  }
  const cleanCount = pipeline.countBeatsCWT(signal, signal.length);
  const spikeSignal = [...signal];
  spikeSignal[150] += 30;
  spikeSignal[450] -= 30;
  spikeSignal[750] += 30;
  const spikeCount = pipeline.countBeatsCWT(spikeSignal, spikeSignal.length);

  assert.equal(cleanCount, 36);
  assert.ok(
    Math.abs(spikeCount - cleanCount) <= 1,
    `expected CWT beat count to resist isolated spikes, got clean=${cleanCount}, spike=${spikeCount}`
  );
}

{
  const pipeline = new RPPGPipeline();
  const fs = 30;
  const signal = [];
  for (let i = 0; i < fs * 10; i += 1) {
    const t = i / fs;
    signal.push(Math.sin(2 * Math.PI * 1.2 * t));
  }
  signal[150] += 30;

  pipeline.runCWTOnBuffer(signal, signal.length);

  assert.equal(pipeline.lastCwtDebug.bestBpm, 72);
  assert.equal(pipeline.lastCwtDebug.windowSamples, 300);
  assert.ok(pipeline.lastCwtDebug.signalClippedFraction > 0);
  assert.ok(Number.isFinite(pipeline.lastCwtDebug.powerRatio));
}

{
  const pipeline = new RPPGPipeline();
  pipeline.lastCwtDebug = {
    powerRatio: 1.08,
    signalScale: 0.004,
    signalClippedFraction: 0.01,
    topCandidates: [{ bpm: 120, power: 50 }, { bpm: 119, power: 46 }]
  };

  const diagnostic = pipeline.updateCwtDiagnostic({
    rawBpm: 120,
    constrainedBpm: 121,
    lsBpm: 122,
    now: 1000,
    frameMeta: { skinFraction: 0.78, roiMotionPx: 2 },
    searchLowBpm: 95,
    searchHighBpm: 145
  });

  assert.equal(diagnostic.cwtRawBpm, 120);
  assert.equal(diagnostic.cwtAccepted, true);
  assert.equal(diagnostic.cwtRawAccepted, true);
  assert.equal(diagnostic.cwtGatedAccepted, true);
  assert.equal(diagnostic.cwtGatedBpm, 121);
  assert.equal(diagnostic.cwtSmoothedBpm, 121);
  assert.equal(diagnostic.cwtFallbackReason, '');
  assert.equal(diagnostic.cwtRejectReason, '');
  assert.equal(diagnostic.cwtSearchLowBpm, 95);
  assert.equal(diagnostic.cwtSearchHighBpm, 145);
}

{
  const pipeline = new RPPGPipeline();
  pipeline.lastAcceptedCwtBpm = 130;
  pipeline.lastSmoothedCwtBpm = 130;
  pipeline.lastCwtDiagnosticTime = 0;
  pipeline.lastCwtDebug = {
    powerRatio: 1.0002,
    signalScale: 0.00001,
    signalClippedFraction: 0.08,
    topCandidates: [{ bpm: 70, power: 10 }, { bpm: 71, power: 9.99 }]
  };

  const diagnostic = pipeline.updateCwtDiagnostic({
    rawBpm: 70,
    constrainedBpm: 70,
    lsBpm: 132,
    now: 1000,
    frameMeta: { skinFraction: 0.08, roiMotionPx: 32 },
    searchLowBpm: 105,
    searchHighBpm: 155
  });

  assert.equal(diagnostic.cwtRawBpm, 70);
  assert.equal(diagnostic.cwtAccepted, false);
  assert.equal(diagnostic.cwtRawAccepted, false);
  assert.equal(diagnostic.cwtGatedAccepted, false);
  assert.equal(diagnostic.cwtGatedBpm, 130);
  assert.equal(diagnostic.cwtSmoothedBpm, 130);
  assert.match(diagnostic.cwtFallbackReason, /flat_power/);
  assert.match(diagnostic.cwtRejectReason, /cwt_ls_divergence/);
  assert.match(diagnostic.cwtFallbackReason, /low_skin_fraction/);
  assert.match(diagnostic.cwtFallbackReason, /cwt_jump/);
  assert.ok(diagnostic.cwtCoverageRatio >= 0 && diagnostic.cwtCoverageRatio <= 1);
}

{
  const pipeline = new RPPGPipeline();
  pipeline.lastAcceptedCwtBpm = 82;
  pipeline.lastSmoothedCwtBpm = 82;
  pipeline.lastGatedCwtBpm = 82;
  pipeline.lastCwtDiagnosticTime = 1000;
  pipeline.lastCwtDebug = {
    powerRatio: 1.04,
    signalScale: 0.004,
    signalClippedFraction: 0.01,
    topCandidates: [{ bpm: 84, power: 50 }, { bpm: 83, power: 40 }]
  };

  pipeline.pushFrame(100, 101, 99, 1100, { scaleJump: true, interEyeDeltaPct: 7 });

  assert.equal(pipeline.lastAcceptedCwtBpm, null);
  assert.equal(pipeline.lastSmoothedCwtBpm, null);
  assert.equal(pipeline.lastGatedCwtBpm, null);

  const diagnostic = pipeline.updateCwtDiagnostic({
    rawBpm: 84,
    constrainedBpm: 84,
    lsBpm: 83,
    now: 2000,
    frameMeta: { skinFraction: 0.8, roiMotionPx: 1, scaleJump: true, interEyeDeltaPct: 7, interEyeVelocityPctPerSec: 14 },
    searchLowBpm: 60,
    searchHighBpm: 110
  });

  assert.equal(diagnostic.cwtRawAccepted, false);
  assert.equal(diagnostic.cwtGatedAccepted, false);
  assert.match(diagnostic.cwtRejectReason, /scale_jump/);
  assert.match(diagnostic.cwtFallbackReason, /scale_jump/);
}
