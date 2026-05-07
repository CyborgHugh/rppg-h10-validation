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
