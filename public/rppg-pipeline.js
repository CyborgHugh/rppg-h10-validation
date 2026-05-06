export const PARAMS = {
  targetFs: 30,
  filter: { low: 0.75, high: 3.0, order: 6 },
  posWindowSec: 1.6,
  hrWindowSec: 10.0,
  toleranceMs: 1000,
  skin: { yMin: 60, yMax: 255, cbMin: 77, cbMax: 127, crMin: 133, crMax: 173 }
};

class FilterChain {
  constructor(fs) {
    this.filters = [];
    const q = 0.707;
    for (let i = 0; i < 3; i += 1) this.filters.push(new Biquad(PARAMS.filter.low, fs, 'highpass', q));
    for (let i = 0; i < 3; i += 1) this.filters.push(new Biquad(PARAMS.filter.high, fs, 'lowpass', q));
  }
  process(value) {
    let out = value;
    for (const filter of this.filters) out = filter.process(out);
    return out;
  }
}

class Biquad {
  constructor(freq, fs, type, q) {
    const w0 = 2 * Math.PI * freq / fs;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    if (type === 'lowpass') {
      this.b0 = (1 - cosw0) / 2; this.b1 = 1 - cosw0; this.b2 = (1 - cosw0) / 2;
      this.a0 = 1 + alpha; this.a1 = -2 * cosw0; this.a2 = 1 - alpha;
    } else {
      this.b0 = (1 + cosw0) / 2; this.b1 = -(1 + cosw0); this.b2 = (1 + cosw0) / 2;
      this.a0 = 1 + alpha; this.a1 = -2 * cosw0; this.a2 = 1 - alpha;
    }
    this.b0 /= this.a0; this.b1 /= this.a0; this.b2 /= this.a0;
    this.a1 /= this.a0; this.a2 /= this.a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export class RPPGPipeline {
  constructor({ onProgress = () => {}, onReady = () => {}, onHr = () => {} } = {}) {
    this.onProgress = onProgress;
    this.onReady = onReady;
    this.onHr = onHr;
    this.rFilter = new FilterChain(PARAMS.targetFs);
    this.gFilter = new FilterChain(PARAMS.targetFs);
    this.bFilter = new FilterChain(PARAMS.targetFs);
    this.rawBuffer = [];
    this.resampledBuffer = [];
    this.posBuffer = [];
    this.startTime = 0;
    this.hasSyncedStart = false;
    this.cwtBpm = 0;
    this.lsBpm = 0;
    this.hrLog = [];
  }

  reset() {
    this.rawBuffer = [];
    this.resampledBuffer = [];
    this.posBuffer = [];
    this.hasSyncedStart = false;
    this.cwtBpm = 0;
    this.lsBpm = 0;
    this.hrLog = [];
    this.onProgress(0);
  }

  pushFrame(r, g, b, time) {
    if (!this.hasSyncedStart) {
      this.startTime = time;
      this.hasSyncedStart = true;
      this.rawBuffer = [];
    }
    this.rawBuffer.push({ r, g, b, t: time });
    if (this.rawBuffer.length > 200) this.rawBuffer.shift();
    this.resampleAndProcess(time);
  }

  resampleAndProcess(now) {
    if (!this.hasSyncedStart || this.rawBuffer.length < 1) return;
    const lastRaw = this.rawBuffer[this.rawBuffer.length - 1];
    const durationMs = lastRaw.t - this.startTime;
    const expectedSamples = Math.floor((durationMs / 1000) * PARAMS.targetFs);
    while (this.resampledBuffer.length <= expectedSamples) {
      const targetTime = this.startTime + (this.resampledBuffer.length * 1000 / PARAMS.targetFs);
      const idx = this.rawBuffer.findIndex((frame) => frame.t >= targetTime);
      if (idx === 0) {
        const p = this.rawBuffer[0];
        this.pushResampled(p.r, p.g, p.b, now);
      } else if (idx > 0) {
        const p1 = this.rawBuffer[idx - 1];
        const p2 = this.rawBuffer[idx];
        const factor = (targetTime - p1.t) / (p2.t - p1.t);
        this.pushResampled(
          p1.r + (p2.r - p1.r) * factor,
          p1.g + (p2.g - p1.g) * factor,
          p1.b + (p2.b - p1.b) * factor,
          now
        );
      } else {
        break;
      }
    }
  }

  pushResampled(r, g, b, now) {
    const fr = this.rFilter.process(r);
    const fg = this.gFilter.process(g);
    const fb = this.bFilter.process(b);
    this.resampledBuffer.push({ r, g, b, fr, fg, fb });
    this.runPipelines(now);
  }

  runPipelines(now) {
    const len = this.resampledBuffer.length;
    const last = this.resampledBuffer[len - 1];
    const posWinSize = Math.round(PARAMS.posWindowSec * PARAMS.targetFs);
    if (len >= posWinSize) {
      const posWindow = this.resampledBuffer.slice(len - posWinSize, len);
      let mR = 0, mG = 0, mB = 0;
      for (const p of posWindow) { mR += p.r; mG += p.g; mB += p.b; }
      mR /= posWinSize; mG /= posWinSize; mB /= posWinSize;
      if (mR >= 1) {
        const s1arr = [];
        const s2arr = [];
        for (const p of posWindow) {
          const rn = p.fr / mR;
          const gn = p.fg / mG;
          const bn = p.fb / mB;
          s1arr.push(gn - bn);
          s2arr.push(gn + bn - 2 * rn);
        }
        const sigma1 = std(s1arr);
        const sigma2 = std(s2arr);
        const alpha = sigma2 > 0.00001 ? sigma1 / sigma2 : 0;
        const rn = last.fr / mR;
        const gn = last.fg / mG;
        const bn = last.fb / mB;
        this.posBuffer.push((gn - bn) + alpha * (gn + bn - 2 * rn));
        if (this.posBuffer.length > PARAMS.targetFs * 300) this.posBuffer.shift();
      }
    }
    this.estimateHR(now);
  }

  estimateHR(now) {
    const fullWinSize = PARAMS.hrWindowSec * PARAMS.targetFs;
    const minWinSize = 3 * PARAMS.targetFs;
    const progress = this.posBuffer.length < fullWinSize
      ? Math.floor((this.posBuffer.length / fullWinSize) * 100)
      : 100;
    this.onProgress(progress);
    if (this.posBuffer.length < minWinSize) return;
    const currentWinSize = Math.min(this.posBuffer.length, fullWinSize);
    const currentCwtBpm = this.runCWTOnBuffer(this.posBuffer, currentWinSize);
    const currentLsBpm = this.runLSOnBuffer(this.posBuffer, currentWinSize);
    if (currentCwtBpm > 0 && currentLsBpm > 0) {
      this.cwtBpm = currentCwtBpm;
      this.lsBpm = currentLsBpm;
      const sample = { t: now, cwtBpm: currentCwtBpm, lsBpm: currentLsBpm };
      this.hrLog.push(sample);
      this.onHr(sample);
      if (currentCwtBpm > 40) this.onReady(sample);
    }
  }

  runCWTOnBuffer(buffer, winSize) {
    const signal = buffer.slice(buffer.length - winSize);
    const fs = PARAMS.targetFs;
    const mean = signal.reduce((sum, value) => sum + value, 0) / signal.length;
    let bestFreq = 0;
    let maxPower = -1;
    for (let f = PARAMS.filter.low; f <= PARAMS.filter.high; f += 1 / 60) {
      let real = 0;
      let imag = 0;
      const sigma = 1 / f;
      const twoSigmaSq = 2 * sigma * sigma;
      for (let k = 0; k < signal.length; k += 1) {
        const t = (k - signal.length / 2) / fs;
        const env = Math.exp(-(t * t) / twoSigmaSq);
        const val = (signal[k] - mean) * env;
        real += val * Math.cos(2 * Math.PI * f * t);
        imag += val * Math.sin(2 * Math.PI * f * t);
      }
      const power = (real * f) ** 2 + (imag * f) ** 2;
      if (power > maxPower) {
        maxPower = power;
        bestFreq = f;
      }
    }
    return bestFreq * 60;
  }

  runLSOnBuffer(buffer, winSize) {
    const signal = buffer.slice(buffer.length - winSize);
    const fs = PARAMS.targetFs;
    const meanValue = signal.reduce((sum, value) => sum + value, 0) / signal.length;
    const variance = signal.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / signal.length;
    if (variance === 0) return 0;
    const candidates = [];
    for (let f = PARAMS.filter.low; f <= PARAMS.filter.high; f += 1 / 60) {
      const omega = 2 * Math.PI * f;
      let sumSin2 = 0, sumCos2 = 0;
      for (let i = 0; i < signal.length; i += 1) {
        const t = i / fs;
        sumSin2 += Math.sin(2 * omega * t);
        sumCos2 += Math.cos(2 * omega * t);
      }
      const tau = Math.atan2(sumSin2, sumCos2) / (2 * omega);
      let sumCosSq = 0, sumSinSq = 0, termCos = 0, termSin = 0;
      for (let i = 0; i < signal.length; i += 1) {
        const t = i / fs;
        const xc = signal[i] - meanValue;
        const arg = omega * (t - tau);
        const c = Math.cos(arg);
        const s = Math.sin(arg);
        termCos += xc * c;
        termSin += xc * s;
        sumCosSq += c * c;
        sumSinSq += s * s;
      }
      const power = 0.5 * ((termCos ** 2) / sumCosSq + (termSin ** 2) / sumSinSq) / variance;
      candidates.push({ freq: f, power });
    }
    candidates.sort((a, b) => b.power - a.power);
    const top = candidates.slice(0, Math.max(1, Math.ceil(candidates.length * 0.05)));
    const den = top.reduce((sum, c) => sum + c.power, 0);
    const hz = den > 0 ? top.reduce((sum, c) => sum + c.freq * c.power, 0) / den : 0;
    return hz * 60;
  }

  countBeatsCWT(signal, targetSamples) {
    if (!signal.length) return 0;
    const fs = PARAMS.targetFs;
    const meanValue = signal.reduce((sum, value) => sum + value, 0) / signal.length;
    const reconstructedSignal = new Float32Array(signal.length);
    const maxPowerAtTime = new Float32Array(signal.length);
    const w0 = 6;
    for (let f = PARAMS.filter.low; f <= PARAMS.filter.high; f += 1 / 60) {
      const s = w0 / (2 * Math.PI * f);
      const twoSigmaSq = 2 * s * s;
      for (let i = 0; i < signal.length; i += 1) {
        let real = 0;
        let imag = 0;
        const halfWin = Math.ceil(3 * s * fs);
        const start = Math.max(0, i - halfWin);
        const end = Math.min(signal.length - 1, i + halfWin);
        for (let k = start; k <= end; k += 1) {
          const t = (k - i) / fs;
          const env = Math.exp(-(t * t) / twoSigmaSq);
          const val = (signal[k] - meanValue) * env;
          real += val * Math.cos(2 * Math.PI * f * t);
          imag += val * Math.sin(2 * Math.PI * f * t);
        }
        const power = (real * f) ** 2 + (imag * f) ** 2;
        if (power > maxPowerAtTime[i]) {
          maxPowerAtTime[i] = power;
          reconstructedSignal[i] = real * f;
        }
      }
    }
    const peaks = [];
    const startIndex = Math.max(0, signal.length - targetSamples);
    for (let i = startIndex; i < signal.length - 1; i += 1) {
      if (i > 0 && reconstructedSignal[i] > reconstructedSignal[i - 1] && reconstructedSignal[i] > reconstructedSignal[i + 1] && reconstructedSignal[i] > 0) {
        peaks.push(i);
      }
    }
    const minDistanceSamples = Math.floor(fs / PARAMS.filter.high);
    const validPeaks = [];
    for (const peak of peaks) {
      if (!validPeaks.length || peak - validPeaks[validPeaks.length - 1] >= minDistanceSamples) {
        validPeaks.push(peak);
      } else if (reconstructedSignal[peak] > reconstructedSignal[validPeaks[validPeaks.length - 1]]) {
        validPeaks[validPeaks.length - 1] = peak;
      }
    }
    return validPeaks.length;
  }
}

function std(values) {
  const mu = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / values.length);
}
