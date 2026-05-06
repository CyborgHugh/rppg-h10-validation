import assert from 'node:assert/strict';
import { parseHeartRateMeasurement } from '../src/polar.js';

{
  const view = new DataView(Uint8Array.from([0x00, 72]).buffer);
  assert.deepEqual(parseHeartRateMeasurement(view), {
    hrBpm: 72,
    rrIntervalsMs: []
  });
}

{
  const bytes = Uint8Array.from([
    0x11,
    0x2c, 0x01,
    0x00, 0x04,
    0x80, 0x03
  ]);
  assert.deepEqual(parseHeartRateMeasurement(new DataView(bytes.buffer)), {
    hrBpm: 300,
    rrIntervalsMs: [1000, 875]
  });
}
