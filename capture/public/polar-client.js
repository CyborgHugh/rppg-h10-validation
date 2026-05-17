export function parseHeartRateMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  const usesUint16Hr = (flags & 0x01) === 0x01;
  const hasRrIntervals = (flags & 0x10) === 0x10;
  let offset = 1;
  const hrBpm = usesUint16Hr ? dataView.getUint16(offset, true) : dataView.getUint8(offset);
  offset += usesUint16Hr ? 2 : 1;
  const rrIntervalsMs = [];
  if (hasRrIntervals) {
    while (offset + 1 < dataView.byteLength) {
      rrIntervalsMs.push(Math.round((dataView.getUint16(offset, true) / 1024) * 1000));
      offset += 2;
    }
  }
  return { hrBpm, rrIntervalsMs };
}

export async function connectPolarH10(onSample) {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge on localhost.');
  }
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: ['heart_rate'] }],
    optionalServices: ['battery_service']
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('heart_rate');
  const characteristic = await service.getCharacteristic('heart_rate_measurement');
  characteristic.addEventListener('characteristicvaluechanged', (event) => {
    onSample(parseHeartRateMeasurement(event.target.value));
  });
  await characteristic.startNotifications();
  return { device, server, characteristic };
}
