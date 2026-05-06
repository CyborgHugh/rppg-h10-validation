export function roundMetric(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

export function computeErrorMetrics(estimate, groundTruth) {
  const signedError = estimate - groundTruth;
  const absoluteError = Math.abs(signedError);
  const percentError = groundTruth === 0 ? null : (signedError / groundTruth) * 100;
  const absolutePercentError = percentError === null ? null : Math.abs(percentError);
  return {
    signedError: roundMetric(signedError),
    absoluteError: roundMetric(absoluteError),
    percentError: roundMetric(percentError),
    absolutePercentError: roundMetric(absolutePercentError)
  };
}

export function integratePolarBeats(samples, startMs, endMs) {
  const sorted = samples
    .filter((sample) => Number.isFinite(sample.perfMs) && Number.isFinite(sample.hrBpm))
    .sort((a, b) => a.perfMs - b.perfMs);

  if (sorted.length === 0 || endMs <= startMs) return 0;

  let beats = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const segStart = Math.max(current.perfMs, startMs);
    const inferredEnd = next ? next.perfMs : current.perfMs + 1000;
    const segEnd = Math.min(inferredEnd, endMs);
    if (segEnd > segStart) {
      beats += (current.hrBpm / 60) * ((segEnd - segStart) / 1000);
    }
  }

  return roundMetric(beats, 3);
}

function nearestSample(samples, targetMs, maxDistanceMs = 500) {
  let best = null;
  let bestDistance = Infinity;
  for (const sample of samples) {
    const distance = Math.abs(sample.perfMs - targetMs);
    if (distance <= maxDistanceMs && distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  return best;
}

export function alignDynamicHr(polarSamples, rppgSamples, startMs, endMs) {
  const polar = polarSamples
    .filter((sample) => sample.perfMs >= startMs && sample.perfMs <= endMs && Number.isFinite(sample.hrBpm))
    .sort((a, b) => a.perfMs - b.perfMs);
  const rppg = rppgSamples
    .filter((sample) => sample.perfMs >= startMs - 500 && sample.perfMs <= endMs + 500)
    .sort((a, b) => a.perfMs - b.perfMs);

  const aligned = [];
  for (const polarSample of polar) {
    const second = Math.floor((polarSample.perfMs - startMs) / 1000);
    const targetMs = startMs + second * 1000;
    const rppgSample = nearestSample(rppg, targetMs);
    if (!rppgSample || !Number.isFinite(rppgSample.cwtBpm) || !Number.isFinite(rppgSample.lsBpm)) {
      continue;
    }
    aligned.push({
      second,
      polarBpm: polarSample.hrBpm,
      cwtBpm: rppgSample.cwtBpm,
      lsBpm: rppgSample.lsBpm
    });
  }
  return aligned;
}

export function computePhaseAgreement(pairs, estimateKey) {
  const usable = pairs
    .map((pair) => ({ polar: pair.polarBpm, estimate: pair[estimateKey] }))
    .filter((pair) => Number.isFinite(pair.polar) && Number.isFinite(pair.estimate));

  if (usable.length === 0) {
    return emptyAgreement();
  }

  const errors = usable.map((pair) => pair.estimate - pair.polar);
  const absErrors = errors.map(Math.abs);
  const sqErrors = errors.map((err) => err ** 2);
  const absPctErrors = usable
    .filter((pair) => pair.polar !== 0)
    .map((pair) => Math.abs((pair.estimate - pair.polar) / pair.polar) * 100);
  const meanBias = mean(errors);
  const sdDiff = sampleStd(errors);
  const pearsonR = pearson(usable.map((p) => p.polar), usable.map((p) => p.estimate));

  return {
    nSeconds: usable.length,
    mae: roundMetric(mean(absErrors)),
    rmse: roundMetric(Math.sqrt(mean(sqErrors))),
    meanBias: roundMetric(meanBias),
    mape: roundMetric(mean(absPctErrors)),
    pearsonR: roundMetric(pearsonR),
    linCcc: roundMetric(linCcc(usable)),
    blandAltmanLoaLower: roundMetric(meanBias - 1.96 * sdDiff),
    blandAltmanLoaUpper: roundMetric(meanBias + 1.96 * sdDiff)
  };
}

function emptyAgreement() {
  return {
    nSeconds: 0,
    mae: null,
    rmse: null,
    meanBias: null,
    mape: null,
    pearsonR: null,
    linCcc: null,
    blandAltmanLoaLower: null,
    blandAltmanLoaUpper: null
  };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function pearson(xs, ys) {
  if (xs.length < 2 || ys.length < 2 || xs.length !== ys.length) return null;
  const xMean = mean(xs);
  const yMean = mean(ys);
  let num = 0;
  let xDen = 0;
  let yDen = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    num += dx * dy;
    xDen += dx ** 2;
    yDen += dy ** 2;
  }
  const den = Math.sqrt(xDen * yDen);
  return den === 0 ? null : num / den;
}

function linCcc(pairs) {
  if (pairs.length < 2) return null;
  const xs = pairs.map((pair) => pair.polar);
  const ys = pairs.map((pair) => pair.estimate);
  const xMean = mean(xs);
  const yMean = mean(ys);
  const covariance = pairs.reduce((sum, pair) => sum + (pair.polar - xMean) * (pair.estimate - yMean), 0) / pairs.length;
  const xVar = pairs.reduce((sum, pair) => sum + (pair.polar - xMean) ** 2, 0) / pairs.length;
  const yVar = pairs.reduce((sum, pair) => sum + (pair.estimate - yMean) ** 2, 0) / pairs.length;
  const denominator = xVar + yVar + (xMean - yMean) ** 2;
  return denominator === 0 ? null : (2 * covariance) / denominator;
}
