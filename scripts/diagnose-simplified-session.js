import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sessionDir = process.argv[2];

if (!sessionDir) {
  console.error('Usage: node scripts/diagnose-simplified-session.js <simplified/data/sessions/session_id>');
  process.exit(1);
}

const [
  intervals,
  signalQuality,
  roiCandidates,
  cwtPower
] = await Promise.all([
  readCsvIfExists(path.join(sessionDir, 'interval_summary.csv')),
  readCsvIfExists(path.join(sessionDir, 'rppg_signal_quality.csv')),
  readCsvIfExists(path.join(sessionDir, 'rppg_roi_candidates.csv')),
  readCsvIfExists(path.join(sessionDir, 'cwt_power_diagnostics.csv'))
]);

const lowTrustIntervals = intervals.filter((row) => (
  row.cwtTrust && row.cwtTrust !== 'high'
));
const fallbackReasons = countTokens(signalQuality.map((row) => row.cwtFallbackReason).filter(Boolean));
const roiByName = groupBy(roiCandidates, 'roiName');
const roiSummary = Object.fromEntries(Object.entries(roiByName).map(([name, rows]) => [name, {
  n: rows.length,
  acceptedRate: mean(rows.map((row) => bool(row.accepted) ? 1 : 0)),
  meanSkinFraction: meanNumber(rows, 'skinFraction'),
  p95MotionPx: quantile(rows.map((row) => number(row.roiMotionPx)).filter(Number.isFinite), 0.95)
}]));

const output = {
  sessionDir,
  intervals: intervals.length,
  lowTrustIntervals: lowTrustIntervals.map((row) => ({
    intervalId: row.intervalId,
    phase: row.phase,
    cwtTrust: row.cwtTrust,
    cwtAcceptedRatio: number(row.cwtAcceptedRatio),
    cwtMeanQuality: number(row.cwtMeanQuality),
    cwtBeats: number(row.cwtBeats),
    polarBeats: number(row.polarBeats)
  })),
  signalQuality: {
    n: signalQuality.length,
    cwtAcceptedRate: mean(signalQuality.map((row) => bool(row.cwtAccepted) ? 1 : 0)),
    meanCwtQuality: meanNumber(signalQuality, 'cwtQuality'),
    p95CwtLsDivergenceBpm: quantile(signalQuality.map((row) => number(row.cwtLsDivergenceBpm)).filter(Number.isFinite), 0.95),
    fallbackReasons
  },
  cwtPower: {
    n: cwtPower.length,
    medianPowerRatio: quantile(cwtPower.map((row) => number(row.cwtPowerRatio)).filter(Number.isFinite), 0.5),
    p05PowerRatio: quantile(cwtPower.map((row) => number(row.cwtPowerRatio)).filter(Number.isFinite), 0.05)
  },
  roiSummary
};

console.log(JSON.stringify(output, null, 2));

async function readCsvIfExists(filePath) {
  try {
    return parseCsv(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function parseCsv(text) {
  const rows = [];
  const parsedRows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
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
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      parsedRows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    parsedRows.push(row);
  }
  const [headers = [], ...dataRows] = parsedRows.filter((entry) => entry.length > 1 || entry[0] !== '');
  for (const dataRow of dataRows) {
    rows.push(Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ''])));
  }
  return rows;
}

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    const value = row[key] || 'unknown';
    groups[value] ??= [];
    groups[value].push(row);
    return groups;
  }, {});
}

function countTokens(values) {
  const counts = {};
  for (const value of values) {
    for (const token of String(value).split('|').filter(Boolean)) {
      counts[token] = (counts[token] ?? 0) + 1;
    }
  }
  return counts;
}

function meanNumber(rows, key) {
  return mean(rows.map((row) => number(row[key])).filter(Number.isFinite));
}

function mean(values) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return round(sorted[index]);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value) {
  return value === true || value === 'true' || value === 'TRUE';
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}
