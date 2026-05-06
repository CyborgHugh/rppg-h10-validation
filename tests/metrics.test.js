import assert from 'node:assert/strict';
import {
  alignDynamicHr,
  computeErrorMetrics,
  computePhaseAgreement,
  integratePolarBeats
} from '../src/metrics.js';

{
  const samples = [
    { perfMs: 0, hrBpm: 60 },
    { perfMs: 1000, hrBpm: 60 },
    { perfMs: 2000, hrBpm: 60 },
    { perfMs: 3000, hrBpm: 60 }
  ];
  assert.equal(integratePolarBeats(samples, 0, 3000), 3);
}

{
  assert.deepEqual(computeErrorMetrics(12, 10), {
    signedError: 2,
    absoluteError: 2,
    percentError: 20,
    absolutePercentError: 20
  });
}

{
  const polar = [
    { perfMs: 0, hrBpm: 70 },
    { perfMs: 1000, hrBpm: 72 },
    { perfMs: 2000, hrBpm: 74 }
  ];
  const rppg = [
    { perfMs: 100, cwtBpm: 69, lsBpm: 71 },
    { perfMs: 1100, cwtBpm: 73, lsBpm: 72 },
    { perfMs: 2600, cwtBpm: 80, lsBpm: 80 }
  ];
  assert.deepEqual(alignDynamicHr(polar, rppg, 0, 2100), [
    { second: 0, polarBpm: 70, cwtBpm: 69, lsBpm: 71 },
    { second: 1, polarBpm: 72, cwtBpm: 73, lsBpm: 72 }
  ]);
}

{
  const pairs = [
    { polarBpm: 60, cwtBpm: 62, lsBpm: 59 },
    { polarBpm: 70, cwtBpm: 72, lsBpm: 71 },
    { polarBpm: 80, cwtBpm: 78, lsBpm: 81 }
  ];
  const cwt = computePhaseAgreement(pairs, 'cwtBpm');
  assert.equal(cwt.nSeconds, 3);
  assert.equal(cwt.meanBias, 0.666667);
  assert.equal(cwt.mae, 2);
  assert.equal(cwt.rmse, 2);
  assert.equal(Number(cwt.pearsonR.toFixed(6)), 0.989743);
}
