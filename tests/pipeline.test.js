import assert from 'node:assert/strict';
import { RPPGPipeline } from '../public/rppg-pipeline.js';

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
