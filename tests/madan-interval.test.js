import assert from 'node:assert/strict';
import {
  estimateMadanPcaCwt,
  estimateMadanPosCwt
} from '../shared/algorithm/madan-interval.js';

{
  const bpm = 162;
  const durationSec = 30;
  const rgbSamples = syntheticRgbSamples({ bpm, durationSec });
  const result = estimateMadanPcaCwt({ rgbSamples, startPerfMs: 0, endPerfMs: durationSec * 1000, durationSec });

  assert.ok(Math.abs(result.beatCount - 81) <= 1.5, `expected about 81 beats, got ${result.beatCount}`);
  assert.ok(Math.abs(result.medianBpm - bpm) <= 3, `expected HR near ${bpm}, got ${result.medianBpm}`);
  assert.equal(result.selectedComponent, 'PC2');
  assert.equal(result.quality, 'ok');
  assert.equal(result.searchLowBpm, 50);
  assert.equal(result.searchHighBpm, 180);
  assert.equal(result.pcaVarianceRatios.length, 3);
}

{
  const bpm = 96;
  const durationSec = 30;
  const posSamples = syntheticPosSamples({ bpm, durationSec });
  const result = estimateMadanPosCwt({ posSamples, startPerfMs: 0, endPerfMs: durationSec * 1000, durationSec });

  assert.ok(Math.abs(result.beatCount - 48) <= 1, `expected about 48 beats, got ${result.beatCount}`);
  assert.ok(Math.abs(result.medianBpm - bpm) <= 3, `expected HR near ${bpm}, got ${result.medianBpm}`);
  assert.equal(result.selectedComponent, 'POS');
  assert.equal(result.quality, 'ok');
}

{
  const result = estimateMadanPcaCwt({
    rgbSamples: syntheticRgbSamples({ bpm: 72, durationSec: 2 }),
    startPerfMs: 0,
    endPerfMs: 2000,
    durationSec: 2
  });

  assert.equal(result.beatCount, null);
  assert.equal(result.medianBpm, null);
  assert.equal(result.quality, 'insufficient_samples');
}

function syntheticRgbSamples({ bpm, durationSec, fps = 30 }) {
  const samples = [];
  const hz = bpm / 60;
  for (let i = 0; i < durationSec * fps; i += 1) {
    const t = i / fps;
    const pulse = Math.sin(2 * Math.PI * hz * t);
    const drift = 0.2 * Math.sin(2 * Math.PI * 0.1 * t);
    samples.push({
      perfMs: t * 1000,
      rawR: 100 + 0.2 * drift,
      rawG: 100 + 4 * pulse + drift,
      rawB: 100 - 4 * pulse + 0.5 * drift
    });
  }
  return samples;
}

function syntheticPosSamples({ bpm, durationSec, fps = 30 }) {
  const samples = [];
  const hz = bpm / 60;
  for (let i = 0; i < durationSec * fps; i += 1) {
    const t = i / fps;
    samples.push({
      perfMs: t * 1000,
      posValue: Math.sin(2 * Math.PI * hz * t)
    });
  }
  return samples;
}
