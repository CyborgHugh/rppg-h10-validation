export function parseHeartRateMeasurement(dataView) {
  if (!(dataView instanceof DataView)) {
    throw new TypeError('Expected a DataView from the heart_rate_measurement characteristic');
  }
  if (dataView.byteLength < 2) {
    throw new RangeError('Heart-rate measurement packet is too short');
  }

  const flags = dataView.getUint8(0);
  const usesUint16Hr = (flags & 0x01) === 0x01;
  const hasRrIntervals = (flags & 0x10) === 0x10;
  let offset = 1;

  const hrBpm = usesUint16Hr
    ? dataView.getUint16(offset, true)
    : dataView.getUint8(offset);
  offset += usesUint16Hr ? 2 : 1;

  const rrIntervalsMs = [];
  if (hasRrIntervals) {
    while (offset + 1 < dataView.byteLength) {
      const rrSeconds = dataView.getUint16(offset, true) / 1024;
      rrIntervalsMs.push(Math.round(rrSeconds * 1000));
      offset += 2;
    }
  }

  return { hrBpm, rrIntervalsMs };
}
