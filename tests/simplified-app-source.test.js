import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../simplified/public/app.js', import.meta.url), 'utf8');

assert.match(
  source,
  /setPhase\('EXERCISE'[\s\S]*?updateIntervalLabel\('EXERCISE'/,
  'exercise should update the active-window label when high-knee march starts'
);
assert.match(
  source,
  /setPhase\('ACTIVE_RECOVERY'[\s\S]*?updateIntervalLabel\('ACTIVE_RECOVERY'/,
  'active recovery should update the active-window label when active recovery starts'
);
assert.match(
  source,
  /recalibration_signal_lock[\s\S]*?runSteadyDelay\(\)[\s\S]*?runMeasurementPhase\('RECOVERY'\)/,
  'recovery measurement should wait for a steady delay after recalibration signal lock'
);
assert.match(
  source,
  /function runSteadyDelay\(\)[\s\S]*?5/,
  'steady delay should be a 5-second wait'
);
assert.match(
  source,
  /rppgRawSamples:\s*\[\]/,
  'simplified app should keep raw rPPG diagnostic samples'
);
assert.match(
  source,
  /onRawSample:\s*\(sample\)[\s\S]*?rppgRawSamples\.push/,
  'simplified app should collect raw pipeline diagnostic samples'
);
assert.match(
  source,
  /skinPixelCount[\s\S]*?sampledPixelCount[\s\S]*?skinFraction/,
  'simplified app should collect ROI skin coverage diagnostics'
);
assert.match(
  source,
  /rppgRawSamples:\s*state\.rppgRawSamples/,
  'simplified save payload should include raw diagnostic samples'
);
assert.match(
  source,
  /rppgRoiCandidates:\s*\[\]/,
  'simplified app should keep per-ROI diagnostic candidates'
);
assert.match(
  source,
  /rppgSignalQualitySamples:\s*\[\]/,
  'simplified app should keep per-second signal quality diagnostics'
);
assert.match(
  source,
  /cwtPowerDiagnostics:\s*\[\]/,
  'simplified app should keep CWT power diagnostics'
);
assert.match(
  source,
  /rppgRoiCandidates:\s*state\.rppgRoiCandidates/,
  'simplified save payload should include ROI candidate diagnostics'
);
assert.match(
  source,
  /cwtSmoothedBpm/,
  'simplified app should surface smoothed CWT diagnostic fields'
);
assert.match(source, /madan-interval\.js/, 'simplified app should import shared Madan interval estimators');
assert.match(source, /madanPcaCwtBeats/, 'simplified intervals should include Madan PCA CWT beats');
assert.match(source, /madanPosCwtBeats/, 'simplified intervals should include Madan POS CWT beats');
assert.doesNotMatch(source, /cwtGatedBeats/, 'simplified interval beat-count outputs should not include gated CWT beats');
