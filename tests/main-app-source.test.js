import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const source = await readFile(new URL('../main/public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../main/public/index.html', import.meta.url), 'utf8');

assert.match(source, /recoveryTrials:\s*\[30,\s*30,\s*30,\s*30,\s*30,\s*30\]/);
assert.doesNotMatch(source, /pipeline\.hrLog\s*=\s*\[\]/, 'main workflow should keep rPPG HR log continuous across trials and ITIs');
assert.match(
  source,
  /pre_recovery_rppg_signal_lock[\s\S]*?setCountdown\(\s*20\s*,\s*startRecoveryPhase\s*\)/,
  'pre-recovery countdown should start only after rPPG lock and last 20 seconds'
);
assert.match(source, /function runCooldown\(\)[\s\S]*?setCountdown\(\s*40\s*,\s*runPreRecovery\s*\)/, 'active resting should last 40 seconds before pre-recovery recalibration');
assert.match(source, /trial_abort/, 'main workflow should log formal trial aborts');
assert.match(source, /pipeline\.reset\(\)[\s\S]*?awaitingTrialRecalibrationLock/, 'interrupted trials should reset and wait for recalibration');
assert.match(source, /onContinuityReset:\s*\(event\)\s*=>\s*handleContinuityReset\(event,\s*'primary'\)/, 'main workflow should handle primary pipeline continuity resets');
assert.match(source, /onContinuityReset:\s*\(event\)\s*=>\s*handleContinuityReset\(event,\s*'upperFace'\)/, 'main workflow should handle upper-face continuity resets');
assert.match(source, /function isCalibrationPhase\(/, 'main workflow should centralize calibration phase checks');
assert.match(source, /if\s*\(!isCalibrationPhase\(\)\)\s*return;[\s\S]*?dom\.signalStatus\.textContent\s*=\s*`\$\{percent\}%`/, 'rPPG progress should only update the signal card during calibration phases');
assert.match(source, /awaitingInitialLock:\s*false/, 'main workflow should track whether initial calibration is still awaiting signal lock');
assert.match(source, /state\.currentPhase === 'CALIBRATION' && state\.awaitingInitialLock/, 'initial calibration progress should stop once signal lock is achieved');
assert.match(source, /state\.awaitingInitialLock\s*=\s*false[\s\S]*?dom\.btnBaseline\.disabled = false/, 'initial rPPG lock should switch from calibration progress to continuous measurement');
assert.match(source, /onHr:\s*\(sample\)\s*=>\s*{[\s\S]*?updateLiveSignalStatus\(sample\)/, 'main workflow should update live rPPG status from HR samples after lock');
assert.match(source, /function shouldStoreRppgSample\(phase\)[\s\S]*?state\.phaseSignalLocked[\s\S]*?'CALIBRATION'[\s\S]*?'BASELINE_READY'[\s\S]*?'PRACTICE'[\s\S]*?'TRIAL_RECALIBRATION'/, 'main workflow should store continuous rPPG samples after calibration lock, before formal trials start');
assert.match(source, /phase_signal_interruption/, 'main workflow should log non-trial phase signal interruptions');
assert.match(source, /function ensurePhaseSignalLockBeforeNextTrial\(/, 'main workflow should require lock before starting the next trial after an interruption');
assert.match(source, /setCountdown\(10,\s*ensurePhaseSignalLockBeforeNextTrial\)/, 'ITI should route through signal-lock guard before the next trial');
assert.doesNotMatch(source, /markExpectedProcessingPause/, 'main workflow should not hide trial-end frame gaps with a processing-pause workaround');
assert.match(
  source,
  /setCountdown\(duration,\s*\(\)\s*=>\s*{[\s\S]*?logEvent\('trial_end'[\s\S]*?dom\.hctInput\.classList\.remove\('hidden'\)/,
  'trial-end callback should only log trial end and show the subjective-count prompt'
);
const trialEndCallback = source.match(/setCountdown\(duration,\s*\(\)\s*=>\s*{([\s\S]*?)dom\.hctInput\.classList\.remove\('hidden'\)/)?.[1] ?? '';
assert.doesNotMatch(trialEndCallback, /countBeatsCWT|estimateMadan|upperFaceTrialSignal|validUpperFaceLs|validLs/, 'trial-end callback should not run rPPG analysis while the live phase is active');
assert.match(source, /upperFacePipeline/, 'main workflow should run an upper-face comparison pipeline');
assert.match(source, /upperFaceRppgSamples/, 'main workflow should store upper-face HR estimates');
assert.match(source, /upperFaceCwtBeats/, 'main trial records should include upper-face CWT beats');
assert.match(source, /high-knee-\$\{pace\}\.gif/, 'main workflow should swap metronome-matched high-knee GIFs');
assert.doesNotMatch(html, /<svg id="stick-figure"/, 'main workflow should replace SVG stick figure with GIF');
assert.match(html, /<img id="high-knee-guide"/);

for (const pace of [80, 96, 112, 124]) {
  await access(new URL(`../main/public/assets/high-knee-${pace}.gif`, import.meta.url));
}
