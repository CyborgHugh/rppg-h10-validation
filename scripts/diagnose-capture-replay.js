#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv } from '../src/csv.js';

export function summarizeReplayDiagnostics({
  intervalSummaries = [],
  rppgSamples = [],
  polarSamples = [],
  signalQualitySamples = [],
  roiCandidateSamples = [],
  cwtPowerDiagnostics = []
} = {}) {
  const intervalRows = intervalSummaries.map(numberizeRow);
  const rppgRows = rppgSamples.map(numberizeRow);
  const polarRows = polarSamples.map(numberizeRow);
  const qualityRows = signalQualitySamples.map(numberizeRow);
  const roiRows = roiCandidateSamples.map(numberizeRow);
  const cwtRows = cwtPowerDiagnostics.map(numberizeRow);
  const joinedHr = rppgRows
    .map((sample) => ({ ...sample, polarHrBpm: nearestPolarHr(polarRows, sample.perfMs) }))
    .filter((sample) => Number.isFinite(sample.polarHrBpm));

  const rawJumps = consecutiveDiffs(rppgRows.map((sample) => sample.cwtBpm));
  const gatedJumps = consecutiveDiffs(rppgRows.map((sample) => sample.cwtGatedBpm));
  const failureReasons = countFailureReasons(rppgRows);
  const frameGapCount = Math.max(0, ...qualityRows.map((row) => finiteOrZero(row.frameGapCount)));

  return {
    intervals: {
      count: intervalRows.length,
      cwtRaw: intervalErrorSummary(intervalRows, 'cwtRawBeats', 'cwtBeats'),
      ls: intervalErrorSummary(intervalRows, 'lsBeats'),
      madanPcaCwt: intervalErrorSummary(intervalRows, 'madanPcaCwtBeats'),
      madanPosCwt: intervalErrorSummary(intervalRows, 'madanPosCwtBeats')
    },
    hr: {
      count: joinedHr.length,
      cwtRaw: hrErrorSummary(joinedHr, 'cwtBpm'),
      cwtGated: hrErrorSummary(joinedHr, 'cwtGatedBpm'),
      ls: hrErrorSummary(joinedHr, 'lsBpm')
    },
    cwt: {
      rawJumpMean: mean(rawJumps),
      rawJumpP95: quantile(rawJumps, 0.95),
      rawJumpMax: max(rawJumps),
      gatedJumpMean: mean(gatedJumps),
      gatedJumpP95: quantile(gatedJumps, 0.95),
      powerRatioMedian: quantile(cwtRows.map((row) => row.cwtPowerRatio), 0.5),
      powerRatioP95: quantile(cwtRows.map((row) => row.cwtPowerRatio), 0.95)
    },
    roi: {
      motionCorrelationWithRawCwtError: correlation(
        alignQuality(joinedHr, qualityRows).map((row) => row.roiMotionPx),
        alignQuality(joinedHr, qualityRows).map((row) => Math.abs(row.cwtBpm - row.polarHrBpm))
      ),
      skinCorrelationWithRawCwtError: correlation(
        alignQuality(joinedHr, qualityRows).map((row) => row.roiSkinFraction),
        alignQuality(joinedHr, qualityRows).map((row) => Math.abs(row.cwtBpm - row.polarHrBpm))
      ),
      medianPatchAreaPx: quantile(preferRows(roiRows, qualityRows).map((row) => row.patchAreaPx), 0.5),
      fixedSampleCountMedian: quantile(preferRows(roiRows, qualityRows).map((row) => row.fixedSampleCount), 0.5),
      effectiveSkinSampleCountMedian: quantile(preferRows(roiRows, qualityRows).map((row) => row.effectiveSkinSampleCount ?? row.effectiveSkinPixelCount), 0.5),
      interEyeDistanceP05: quantile(qualityRows.map((row) => row.interEyeDistancePx), 0.05),
      interEyeDistanceP50: quantile(qualityRows.map((row) => row.interEyeDistancePx), 0.5),
      interEyeDistanceP95: quantile(qualityRows.map((row) => row.interEyeDistancePx), 0.95),
      interEyeVelocityP95: quantile(qualityRows.map((row) => Math.abs(row.interEyeVelocityPctPerSec)), 0.95),
      scaleJumpCount: qualityRows.filter((row) => truthy(row.scaleJump)).length
    },
    frameGapCount,
    failureReasons
  };
}

export function flattenSummary(summary, replayId = '') {
  return {
    replayId,
    intervalCount: summary.intervals.count,
    cwtRawIntervalMae: round(summary.intervals.cwtRaw.mae),
    lsIntervalMae: round(summary.intervals.ls.mae),
    madanPcaCwtIntervalMae: round(summary.intervals.madanPcaCwt.mae),
    madanPosCwtIntervalMae: round(summary.intervals.madanPosCwt.mae),
    hrCount: summary.hr.count,
    cwtRawHrMae: round(summary.hr.cwtRaw.mae),
    cwtGatedHrMae: round(summary.hr.cwtGated.mae),
    lsHrMae: round(summary.hr.ls.mae),
    cwtRawJumpMean: round(summary.cwt.rawJumpMean),
    cwtRawJumpP95: round(summary.cwt.rawJumpP95),
    cwtGatedJumpP95: round(summary.cwt.gatedJumpP95),
    cwtPowerRatioMedian: round(summary.cwt.powerRatioMedian, 6),
    medianRoiAreaPx: round(summary.roi.medianPatchAreaPx),
    fixedSampleCountMedian: round(summary.roi.fixedSampleCountMedian),
    effectiveSkinSampleCountMedian: round(summary.roi.effectiveSkinSampleCountMedian),
    interEyeDistanceP05: round(summary.roi.interEyeDistanceP05),
    interEyeDistanceP50: round(summary.roi.interEyeDistanceP50),
    interEyeDistanceP95: round(summary.roi.interEyeDistanceP95),
    interEyeVelocityP95: round(summary.roi.interEyeVelocityP95),
    scaleJumpCount: summary.roi.scaleJumpCount,
    frameGapCount: summary.frameGapCount,
    topFailureReasonsJson: JSON.stringify(summary.failureReasons)
  };
}

async function diagnoseReplay(sessionDir, replayDir) {
  const data = {
    intervalSummaries: await readCsv(path.join(replayDir, 'interval_summary.csv')),
    rppgSamples: await readCsv(path.join(replayDir, 'rppg_hr_1hz.csv')),
    polarSamples: await readCsv(path.join(sessionDir, 'polar_hr_1hz.csv')),
    signalQualitySamples: await readCsv(path.join(replayDir, 'rppg_signal_quality.csv')),
    roiCandidateSamples: await readCsv(path.join(replayDir, 'rppg_roi_candidates.csv')),
    cwtPowerDiagnostics: await readCsv(path.join(replayDir, 'cwt_power_diagnostics.csv'))
  };
  const summary = summarizeReplayDiagnostics(data);
  await writeFile(path.join(replayDir, 'diagnostic_summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(replayDir, 'diagnostic_summary.csv'), toCsv([flattenSummary(summary, path.basename(replayDir))]));
  return flattenSummary(summary, path.basename(replayDir));
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/diagnose-capture-replay.js capture/data/sessions/<session_id> [replay_id]');
    process.exitCode = 1;
    return;
  }
  const sessionDir = path.resolve(target);
  const replayId = process.argv[3];
  const replayRoot = path.join(sessionDir, 'replays');
  const replayDirs = replayId
    ? [path.join(replayRoot, replayId)]
    : (await readdir(replayRoot).catch(() => [])).map((entry) => path.join(replayRoot, entry));
  const rows = [];
  for (const replayDir of replayDirs) {
    const replayStat = await stat(replayDir).catch(() => null);
    if (!replayStat?.isDirectory()) continue;
    rows.push(await diagnoseReplay(sessionDir, replayDir));
  }
  if (rows.length) {
    await writeFile(path.join(replayRoot, 'diagnostic_comparison.csv'), toCsv(rows));
    console.log(`Wrote diagnostics for ${rows.length} replay(s).`);
  } else {
    console.log('No replay folders found.');
  }
}

function intervalErrorSummary(rows, primaryKey, fallbackKey = null) {
  const errors = rows
    .map((row) => {
      const estimate = Number.isFinite(row[primaryKey]) ? row[primaryKey] : row[fallbackKey];
      return Number.isFinite(estimate) && Number.isFinite(row.polarBeats) ? estimate - row.polarBeats : null;
    })
    .filter(Number.isFinite);
  return errorSummary(errors);
}

function hrErrorSummary(rows, key) {
  return errorSummary(rows
    .map((row) => (Number.isFinite(row[key]) ? row[key] - row.polarHrBpm : null))
    .filter(Number.isFinite));
}

function errorSummary(errors) {
  const abs = errors.map(Math.abs);
  return {
    n: errors.length,
    bias: mean(errors),
    mae: mean(abs),
    rmse: errors.length ? Math.sqrt(mean(errors.map((error) => error ** 2))) : null,
    maxAbs: max(abs)
  };
}

function nearestPolarHr(polarRows, perfMs) {
  let best = null;
  let bestDistance = Infinity;
  for (const row of polarRows) {
    const distance = Math.abs(row.perfMs - perfMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  return bestDistance <= 750 ? best.hrBpm : null;
}

function alignQuality(hrRows, qualityRows) {
  return hrRows.map((sample) => {
    let best = {};
    let bestDistance = Infinity;
    for (const quality of qualityRows) {
      const distance = Math.abs(quality.perfMs - sample.perfMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = quality;
      }
    }
    return { ...sample, ...best };
  });
}

function preferRows(primaryRows, fallbackRows) {
  return primaryRows.length ? primaryRows : fallbackRows;
}

function truthy(value) {
  if (value === true) return true;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function countFailureReasons(rows) {
  const counts = {};
  for (const row of rows) {
    const reasons = String(row.cwtRejectReason || row.cwtFallbackReason || '')
      .split('|')
      .map((reason) => reason.trim())
      .filter(Boolean);
    for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function consecutiveDiffs(values) {
  const usable = values.filter(Number.isFinite);
  const diffs = [];
  for (let i = 1; i < usable.length; i += 1) diffs.push(Math.abs(usable[i] - usable[i - 1]));
  return diffs;
}

async function readCsv(filePath) {
  const text = await readFile(filePath, 'utf8').catch(() => '');
  if (!text.trim()) return [];
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine);
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function numberizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const parsed = Number(value);
    return [key, value !== '' && Number.isFinite(parsed) ? parsed : value];
  }));
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function max(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.max(...usable) : null;
}

function quantile(values, q) {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return null;
  return usable[Math.min(usable.length - 1, Math.max(0, Math.ceil(usable.length * q) - 1))];
}

function correlation(xs, ys) {
  const pairs = [];
  for (let i = 0; i < xs.length; i += 1) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 3) return null;
  const xMean = mean(pairs.map(([x]) => x));
  const yMean = mean(pairs.map(([, y]) => y));
  const xSd = Math.sqrt(mean(pairs.map(([x]) => (x - xMean) ** 2)));
  const ySd = Math.sqrt(mean(pairs.map(([, y]) => (y - yMean) ** 2)));
  if (!xSd || !ySd) return null;
  return mean(pairs.map(([x, y]) => (x - xMean) * (y - yMean))) / (xSd * ySd);
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
