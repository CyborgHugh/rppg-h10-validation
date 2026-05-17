export const MADAN_PARAMS = {
  targetFs: 12,
  minDurationSec: 8,
  minSamples: 96,
  lowHz: 0.8,
  highHz: 3.0,
  searchLowBpm: 50,
  searchHighBpm: 180,
  waveletW0: 6
};

export function estimateMadanPcaCwt({
  rgbSamples = [],
  startPerfMs,
  endPerfMs,
  durationSec = (endPerfMs - startPerfMs) / 1000,
  params = MADAN_PARAMS
} = {}) {
  const resampled = resampleRgb(rgbSamples, startPerfMs, endPerfMs, params.targetFs);
  if (!hasEnoughSamples(resampled.values, durationSec, params)) {
    return emptyResult('PC2', 'insufficient_samples', resampled.values.length, params);
  }
  const pca = pca3(resampled.values.map((sample) => [sample.r, sample.g, sample.b]));
  const pc2 = pca.scores.map((row) => row[1]);
  return estimateFromSignal(pc2, durationSec, {
    selectedComponent: 'PC2',
    pcaVarianceRatios: pca.varianceRatios,
    usableSampleCount: resampled.values.length,
    effectiveFps: resampled.effectiveFps,
    params
  });
}

export function estimateMadanPosCwt({
  posSamples = [],
  startPerfMs,
  endPerfMs,
  durationSec = (endPerfMs - startPerfMs) / 1000,
  params = MADAN_PARAMS
} = {}) {
  const resampled = resampleScalar(posSamples, startPerfMs, endPerfMs, params.targetFs, 'posValue');
  if (!hasEnoughSamples(resampled.values, durationSec, params)) {
    return emptyResult('POS', 'insufficient_samples', resampled.values.length, params);
  }
  return estimateFromSignal(resampled.values, durationSec, {
    selectedComponent: 'POS',
    pcaVarianceRatios: [],
    usableSampleCount: resampled.values.length,
    effectiveFps: resampled.effectiveFps,
    params
  });
}

export function estimateMadanInterval({ rgbSamples = [], posSamples = [], startPerfMs, endPerfMs, durationSec, params = MADAN_PARAMS } = {}) {
  return {
    pca: estimateMadanPcaCwt({ rgbSamples, startPerfMs, endPerfMs, durationSec, params }),
    pos: estimateMadanPosCwt({ posSamples, startPerfMs, endPerfMs, durationSec, params })
  };
}

function estimateFromSignal(signal, durationSec, {
  selectedComponent,
  pcaVarianceRatios,
  usableSampleCount,
  effectiveFps,
  params
}) {
  const normalized = standardize(signal);
  const filtered = bandpass(normalized, params.targetFs, params.lowHz, params.highHz);
  const cwt = morletRidge(filtered, params);
  const medianBpm = median(cwt.ridgeBpms);
  const beatCount = Number.isFinite(medianBpm) ? medianBpm * durationSec / 60 : null;
  const powerRatioMedian = median(cwt.powerRatios);
  const quality = Number.isFinite(beatCount) ? 'ok' : 'no_cwt_ridge';
  return {
    beatCount: round(beatCount, 3),
    medianBpm: round(medianBpm, 3),
    quality,
    selectedComponent,
    pcaVarianceRatios: pcaVarianceRatios.map((value) => round(value, 6)),
    usableSampleCount,
    effectiveFps: round(effectiveFps, 3),
    cwtPowerRatioMedian: round(powerRatioMedian, 6),
    searchLowBpm: params.searchLowBpm,
    searchHighBpm: params.searchHighBpm
  };
}

function resampleRgb(samples, startMs, endMs, fs) {
  const rows = resampleBins(samples, startMs, endMs, fs, (bucket) => {
    const totals = bucket.reduce((sum, sample) => ({
      r: sum.r + valueOf(sample, 'rawR', 'r'),
      g: sum.g + valueOf(sample, 'rawG', 'g'),
      b: sum.b + valueOf(sample, 'rawB', 'b')
    }), { r: 0, g: 0, b: 0 });
    return {
      r: totals.r / bucket.length,
      g: totals.g / bucket.length,
      b: totals.b / bucket.length
    };
  });
  return rows;
}

function resampleScalar(samples, startMs, endMs, fs, key) {
  return resampleBins(samples, startMs, endMs, fs, (bucket) => (
    bucket.reduce((sum, sample) => sum + valueOf(sample, key), 0) / bucket.length
  ));
}

function resampleBins(samples, startMs, endMs, fs, reducer) {
  const usable = samples
    .map((sample) => ({ ...sample, perfMs: Number(sample.perfMs ?? sample.t) }))
    .filter((sample) => Number.isFinite(sample.perfMs) && sample.perfMs >= startMs && sample.perfMs <= endMs)
    .sort((a, b) => a.perfMs - b.perfMs);
  const binMs = 1000 / fs;
  const values = [];
  for (let binStart = startMs; binStart < endMs; binStart += binMs) {
    const binEnd = Math.min(endMs, binStart + binMs);
    const bucket = usable.filter((sample) => sample.perfMs >= binStart && sample.perfMs < binEnd);
    if (bucket.length) values.push(reducer(bucket));
  }
  return {
    values,
    effectiveFps: values.length && endMs > startMs ? values.length / ((endMs - startMs) / 1000) : 0
  };
}

function pca3(rows) {
  const means = [0, 1, 2].map((index) => rows.reduce((sum, row) => sum + row[index], 0) / rows.length);
  const centered = rows.map((row) => row.map((value, index) => value - means[index]));
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (const row of centered) {
    for (let i = 0; i < 3; i += 1) {
      for (let j = i; j < 3; j += 1) {
        covariance[i][j] += row[i] * row[j] / Math.max(1, rows.length - 1);
      }
    }
  }
  covariance[1][0] = covariance[0][1];
  covariance[2][0] = covariance[0][2];
  covariance[2][1] = covariance[1][2];
  const eigen = jacobiEigenSymmetric(covariance);
  const order = [0, 1, 2].sort((a, b) => eigen.values[b] - eigen.values[a]);
  const values = order.map((index) => Math.max(0, eigen.values[index]));
  const vectors = order.map((index) => eigen.vectors.map((row) => row[index]));
  const total = values.reduce((sum, value) => sum + value, 0);
  const scores = centered.map((row) => vectors.map((vector) => dot(row, vector)));
  return {
    scores,
    varianceRatios: values.map((value) => (total > 0 ? value / total : 0))
  };
}

function jacobiEigenSymmetric(matrix) {
  const a = matrix.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  for (let iter = 0; iter < 30; iter += 1) {
    let p = 0;
    let q = 1;
    let max = Math.abs(a[p][q]);
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        if (Math.abs(a[i][j]) > max) {
          max = Math.abs(a[i][j]);
          p = i;
          q = j;
        }
      }
    }
    if (max < 1e-12) break;
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    rotate(a, v, p, q, c, s);
  }
  return {
    values: [a[0][0], a[1][1], a[2][2]],
    vectors: v
  };
}

function rotate(a, v, p, q, c, s) {
  for (let k = 0; k < 3; k += 1) {
    const apk = a[p][k];
    const aqk = a[q][k];
    a[p][k] = c * apk - s * aqk;
    a[q][k] = s * apk + c * aqk;
  }
  for (let k = 0; k < 3; k += 1) {
    const akp = a[k][p];
    const akq = a[k][q];
    a[k][p] = c * akp - s * akq;
    a[k][q] = s * akp + c * akq;
  }
  for (let k = 0; k < 3; k += 1) {
    const vkp = v[k][p];
    const vkq = v[k][q];
    v[k][p] = c * vkp - s * vkq;
    v[k][q] = s * vkp + c * vkq;
  }
}

function bandpass(values, fs, lowHz, highHz) {
  let out = values;
  for (let i = 0; i < 2; i += 1) out = onePoleHighpass(out, fs, lowHz);
  for (let i = 0; i < 2; i += 1) out = onePoleLowpass(out, fs, highHz);
  return out;
}

function onePoleLowpass(values, fs, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / fs;
  const alpha = dt / (rc + dt);
  const out = [];
  let y = values[0] ?? 0;
  for (const value of values) {
    y += alpha * (value - y);
    out.push(y);
  }
  return out;
}

function onePoleHighpass(values, fs, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / fs;
  const alpha = rc / (rc + dt);
  const out = [];
  let y = 0;
  let prev = values[0] ?? 0;
  for (const value of values) {
    y = alpha * (y + value - prev);
    out.push(y);
    prev = value;
  }
  return out;
}

function morletRidge(signal, params) {
  const ridgeBpms = [];
  const powerRatios = [];
  const fs = params.targetFs;
  for (let i = 0; i < signal.length; i += 1) {
    let bestBpm = null;
    let bestPower = -Infinity;
    let secondPower = -Infinity;
    for (let bpm = params.searchLowBpm; bpm <= params.searchHighBpm; bpm += 1) {
      const f = bpm / 60;
      const s = params.waveletW0 / (2 * Math.PI * f);
      const halfWin = Math.ceil(3 * s * fs);
      const start = Math.max(0, i - halfWin);
      const end = Math.min(signal.length - 1, i + halfWin);
      let real = 0;
      let imag = 0;
      for (let k = start; k <= end; k += 1) {
        const t = (k - i) / fs;
        const env = Math.exp(-(t * t) / (2 * s * s));
        const val = signal[k] * env;
        real += val * Math.cos(2 * Math.PI * f * t);
        imag += val * Math.sin(2 * Math.PI * f * t);
      }
      const power = (real * f) ** 2 + (imag * f) ** 2;
      if (power > bestPower) {
        secondPower = bestPower;
        bestPower = power;
        bestBpm = bpm;
      } else if (power > secondPower) {
        secondPower = power;
      }
    }
    if (Number.isFinite(bestBpm)) ridgeBpms.push(bestBpm);
    if (secondPower > 0) powerRatios.push(bestPower / secondPower);
  }
  return { ridgeBpms, powerRatios };
}

function hasEnoughSamples(values, durationSec, params) {
  return Number.isFinite(durationSec)
    && durationSec >= params.minDurationSec
    && values.length >= params.minSamples;
}

function emptyResult(selectedComponent, quality, usableSampleCount, params) {
  return {
    beatCount: null,
    medianBpm: null,
    quality,
    selectedComponent,
    pcaVarianceRatios: selectedComponent === 'PC2' ? [] : [],
    usableSampleCount,
    effectiveFps: null,
    cwtPowerRatioMedian: null,
    searchLowBpm: params.searchLowBpm,
    searchHighBpm: params.searchHighBpm
  };
}

function standardize(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map((value) => value - mean);
  const sd = Math.sqrt(centered.reduce((sum, value) => sum + value ** 2, 0) / centered.length);
  return sd > 1e-12 ? centered.map((value) => value / sd) : centered;
}

function valueOf(sample, ...keys) {
  for (const key of keys) {
    const value = Number(sample[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function median(values) {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return null;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[mid] : (usable[mid - 1] + usable[mid]) / 2;
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}
