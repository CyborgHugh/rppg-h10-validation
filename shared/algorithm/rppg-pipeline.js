export const PARAMS = {
  targetFs: 30,
  filter: { low: 0.75, high: 3.0, order: 6 },
  posWindowSec: 1.6,
  hrWindowSec: 10.0,
  maxFrameGapMs: 500,
  toleranceMs: 1000,
  skin: { yMin: 60, yMax: 255, cbMin: 77, cbMax: 127, crMin: 133, crMax: 173 }
};

class FilterChain {
  constructor(fs, filter = PARAMS.filter) {
    this.filters = [];
    const q = 0.707;
    for (let i = 0; i < 3; i += 1) this.filters.push(new Biquad(filter.low, fs, 'highpass', q));
    for (let i = 0; i < 3; i += 1) this.filters.push(new Biquad(filter.high, fs, 'lowpass', q));
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
  constructor({
    targetFs = PARAMS.targetFs,
    roiMode = 'boxRectLegacy',
    skinMode = 'hardYcbcr',
    cwtMode = 'raw+gated',
    onProgress = () => {},
    onReady = () => {},
    onHr = () => {},
    onRawSample = () => {},
    onContinuityReset = () => {}
  } = {}) {
    this.targetFs = targetFs;
    this.roiMode = roiMode;
    this.skinMode = skinMode;
    this.cwtMode = cwtMode;
    this.filter = PARAMS.filter;
    this.onProgress = onProgress;
    this.onReady = onReady;
    this.onHr = onHr;
    this.onRawSample = onRawSample;
    this.onContinuityReset = onContinuityReset;
    this.resetFilters();
    this.rawBuffer = [];
    this.resampledBuffer = [];
    this.posBuffer = [];
    this.startTime = 0;
    this.hasSyncedStart = false;
    this.cwtBpm = 0;
    this.lsBpm = 0;
    this.hrLog = [];
    this.lastFrameDebug = null;
    this.lastCwtDebug = null;
    this.lastCwtCountDebug = null;
    this.lastCwtDiagnostic = null;
    this.lastAcceptedCwtBpm = null;
    this.lastSmoothedCwtBpm = null;
    this.lastGatedCwtBpm = null;
    this.lastCwtDiagnosticTime = null;
    this.lastRawFrameTime = null;
    this.lastPhase = null;
    this.frameGapCount = 0;
    this.rawFrameCount = 0;
    this.downsampleMode = targetFs < PARAMS.targetFs ? 'temporalAverage' : 'native';
    this.antiAliasWindowMs = targetFs < PARAMS.targetFs ? 1000 / targetFs : 0;
  }

  resetFilters() {
    this.rFilter = new FilterChain(this.targetFs, this.filter);
    this.gFilter = new FilterChain(this.targetFs, this.filter);
    this.bFilter = new FilterChain(this.targetFs, this.filter);
  }

  reset() {
    this.resetFilters();
    this.rawBuffer = [];
    this.resampledBuffer = [];
    this.posBuffer = [];
    this.hasSyncedStart = false;
    this.cwtBpm = 0;
    this.lsBpm = 0;
    this.hrLog = [];
    this.lastFrameDebug = null;
    this.lastCwtDebug = null;
    this.lastCwtCountDebug = null;
    this.lastCwtDiagnostic = null;
    this.lastAcceptedCwtBpm = null;
    this.lastSmoothedCwtBpm = null;
    this.lastGatedCwtBpm = null;
    this.lastCwtDiagnosticTime = null;
    this.lastRawFrameTime = null;
    this.lastPhase = null;
    this.frameGapCount = 0;
    this.rawFrameCount = 0;
    this.onProgress(0);
  }

  pushFrame(r, g, b, time, frameMeta = {}) {
    const frameDeltaMs = Number.isFinite(this.lastRawFrameTime) ? time - this.lastRawFrameTime : null;
    if (Number.isFinite(frameDeltaMs) && frameDeltaMs > PARAMS.maxFrameGapMs) {
      this.frameGapCount += 1;
      this.resetContinuity({
        reason: 'frame_gap',
        frameDeltaMs,
        phase: frameMeta.phase,
        time
      });
    }
    if (frameMeta.phase && this.lastPhase && frameMeta.phase !== this.lastPhase) {
      this.resetCwtPriors();
    }
    this.lastPhase = frameMeta.phase ?? this.lastPhase;
    if (Number.isFinite(frameMeta.roiMotionPx) && frameMeta.roiMotionPx > 25) {
      this.resetCwtPriors();
    }
    if (frameMeta.scaleJump || (Number.isFinite(frameMeta.interEyeDeltaPct) && Math.abs(frameMeta.interEyeDeltaPct) > 5)) {
      this.resetCwtPriors();
    }
    this.lastRawFrameTime = time;
    this.rawFrameCount += 1;
    const effectiveFrameRate = Number.isFinite(frameDeltaMs) && frameDeltaMs > 0 ? 1000 / frameDeltaMs : null;
    const samplingMeta = {
      targetFs: this.targetFs,
      effectiveFrameRate,
      frameGapCount: this.frameGapCount,
      downsampleMode: this.downsampleMode,
      antiAliasWindowMs: this.antiAliasWindowMs,
      roiMode: frameMeta.roiMode ?? this.roiMode,
      skinMode: frameMeta.skinMode ?? this.skinMode
    };
    this.lastFrameDebug = { t: time, r, g, b, frameDeltaMs, ...samplingMeta, ...frameMeta };
    this.onRawSample({
      debugType: 'frame',
      perfMs: roundForDebug(time, 3),
      rawR: roundForDebug(r),
      rawG: roundForDebug(g),
      rawB: roundForDebug(b),
      frameDeltaMs: roundForDebug(frameDeltaMs, 3),
      ...roundDebugObject(samplingMeta),
      ...roundDebugObject(frameMeta)
    });
    if (!this.hasSyncedStart) {
      this.startTime = time;
      this.hasSyncedStart = true;
      this.rawBuffer = [];
    }
    this.rawBuffer.push({ r, g, b, t: time, meta: { ...samplingMeta, ...frameMeta } });
    if (this.rawBuffer.length > 200) this.rawBuffer.shift();
    this.resampleAndProcess(time);
  }

  resetContinuity(event = { reason: 'unknown' }) {
    this.resetFilters();
    this.rawBuffer = [];
    this.resampledBuffer = [];
    this.posBuffer = [];
    this.hasSyncedStart = false;
    this.resetCwtPriors();
    this.onProgress(0);
    this.onContinuityReset(event);
  }

  resetCwtPriors() {
    this.lastAcceptedCwtBpm = null;
    this.lastSmoothedCwtBpm = null;
    this.lastGatedCwtBpm = null;
    this.lastCwtDiagnosticTime = null;
  }

  resampleAndProcess(now) {
    if (!this.hasSyncedStart || this.rawBuffer.length < 1) return;
    const lastRaw = this.rawBuffer[this.rawBuffer.length - 1];
    const durationMs = lastRaw.t - this.startTime;
    const expectedSamples = Math.floor((durationMs / 1000) * this.targetFs);
    while (this.resampledBuffer.length <= expectedSamples) {
      const targetTime = this.startTime + (this.resampledBuffer.length * 1000 / this.targetFs);
      const idx = this.rawBuffer.findIndex((frame) => frame.t >= targetTime);
      if (idx === 0) {
        const p = this.averageAroundTarget(targetTime) ?? this.rawBuffer[0];
        this.pushResampled(p.r, p.g, p.b, now, targetTime, p.meta);
      } else if (idx > 0) {
        const averaged = this.averageAroundTarget(targetTime);
        if (averaged) {
          this.pushResampled(averaged.r, averaged.g, averaged.b, now, targetTime, averaged.meta);
        } else {
          const p1 = this.rawBuffer[idx - 1];
          const p2 = this.rawBuffer[idx];
          const factor = (targetTime - p1.t) / (p2.t - p1.t);
          this.pushResampled(
            p1.r + (p2.r - p1.r) * factor,
            p1.g + (p2.g - p1.g) * factor,
            p1.b + (p2.b - p1.b) * factor,
            now,
            targetTime,
            p2.meta ?? p1.meta
          );
        }
      } else {
        break;
      }
    }
  }

  averageAroundTarget(targetTime) {
    if (this.targetFs >= PARAMS.targetFs) return null;
    const halfWindow = 500 / this.targetFs;
    const frames = this.rawBuffer.filter((frame) => Math.abs(frame.t - targetTime) <= halfWindow);
    if (frames.length < 2) return null;
    const total = frames.reduce((sum, frame) => ({
      r: sum.r + frame.r,
      g: sum.g + frame.g,
      b: sum.b + frame.b
    }), { r: 0, g: 0, b: 0 });
    return {
      r: total.r / frames.length,
      g: total.g / frames.length,
      b: total.b / frames.length,
      t: targetTime,
      meta: frames[frames.length - 1].meta
    };
  }

  pushResampled(r, g, b, now, targetTime = now, frameMeta = {}) {
    const fr = this.rFilter.process(r);
    const fg = this.gFilter.process(g);
    const fb = this.bFilter.process(b);
    this.resampledBuffer.push({ r, g, b, fr, fg, fb, t: targetTime, meta: frameMeta });
    this.runPipelines(now, targetTime, frameMeta);
  }

  runPipelines(now, targetTime = now, frameMeta = {}) {
    const len = this.resampledBuffer.length;
    const last = this.resampledBuffer[len - 1];
    const posWinSize = Math.round(PARAMS.posWindowSec * this.targetFs);
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
        const posValue = (gn - bn) + alpha * (gn + bn - 2 * rn);
        this.posBuffer.push(posValue);
        if (this.posBuffer.length > this.targetFs * 300) this.posBuffer.shift();
        this.onRawSample({
          debugType: 'pos_sample',
          perfMs: roundForDebug(targetTime, 3),
          callbackPerfMs: roundForDebug(now, 3),
          resampledR: roundForDebug(last.r),
          resampledG: roundForDebug(last.g),
          resampledB: roundForDebug(last.b),
          filteredR: roundForDebug(last.fr),
          filteredG: roundForDebug(last.fg),
          filteredB: roundForDebug(last.fb),
          meanR: roundForDebug(mR),
          meanG: roundForDebug(mG),
          meanB: roundForDebug(mB),
          alpha: roundForDebug(alpha),
          posValue: roundForDebug(posValue),
          posBufferLength: this.posBuffer.length,
          ...roundDebugObject(frameMeta)
        });
      }
    }
    this.estimateHR(now, frameMeta);
  }

  estimateHR(now, frameMeta = {}) {
    const fullWinSize = PARAMS.hrWindowSec * this.targetFs;
    const minWinSize = 3 * this.targetFs;
    const progress = this.posBuffer.length < fullWinSize
      ? Math.floor((this.posBuffer.length / fullWinSize) * 100)
      : 100;
    this.onProgress(progress);
    if (this.posBuffer.length < minWinSize) return;
    const currentWinSize = Math.min(this.posBuffer.length, fullWinSize);
    const currentCwtBpm = this.runCWTOnBuffer(this.posBuffer, currentWinSize);
    const rawCwtDebug = this.lastCwtDebug;
    const currentLsBpm = this.runLSOnBuffer(this.posBuffer, currentWinSize);
    const searchBounds = this.computeCwtSearchBounds(currentLsBpm);
    const constrainedCwtBpm = this.runCWTOnBuffer(this.posBuffer, currentWinSize, searchBounds);
    const constrainedCwtDebug = this.lastCwtDebug;
    this.lastCwtDebug = {
      ...rawCwtDebug,
      constrainedBestBpm: roundForDebug(constrainedCwtBpm),
      constrainedBestPower: constrainedCwtDebug?.bestPower,
      constrainedSecondBpm: constrainedCwtDebug?.secondBpm,
      constrainedSecondPower: constrainedCwtDebug?.secondPower,
      constrainedPowerRatio: constrainedCwtDebug?.powerRatio,
      cwtSearchLowBpm: searchBounds.lowBpm,
      cwtSearchHighBpm: searchBounds.highBpm
    };
    const cwtDiagnostic = this.updateCwtDiagnostic({
      rawBpm: currentCwtBpm,
      constrainedBpm: constrainedCwtBpm,
      lsBpm: currentLsBpm,
      now,
      frameMeta,
      searchLowBpm: searchBounds.lowBpm,
      searchHighBpm: searchBounds.highBpm,
      currentWinSize,
      fullWinSize
    });
    if (currentCwtBpm > 0 && currentLsBpm > 0) {
      this.cwtBpm = currentCwtBpm;
      this.lsBpm = currentLsBpm;
      const sample = {
        t: now,
        cwtBpm: currentCwtBpm,
        lsBpm: currentLsBpm,
        targetFs: this.targetFs,
        roiMode: frameMeta.roiMode ?? this.roiMode,
        skinMode: frameMeta.skinMode ?? this.skinMode,
        effectiveFrameRate: frameMeta.effectiveFrameRate,
        frameGapCount: this.frameGapCount,
        downsampleMode: this.downsampleMode,
        antiAliasWindowMs: this.antiAliasWindowMs,
        roiComposition: frameMeta.roiComposition,
        interEyeDeltaPct: frameMeta.interEyeDeltaPct,
        interEyeVelocityPctPerSec: frameMeta.interEyeVelocityPctPerSec,
        patchAreaDeltaPct: frameMeta.patchAreaDeltaPct,
        scaleJump: frameMeta.scaleJump,
        ...cwtDiagnostic
      };
      this.hrLog.push(sample);
      this.onHr(sample);
      if (currentCwtBpm > 40) this.onReady(sample);
    }
  }

  computeCwtSearchBounds(lsBpm) {
    const minBpm = PARAMS.filter.low * 60;
    const maxBpm = PARAMS.filter.high * 60;
    const prior = Number.isFinite(this.lastAcceptedCwtBpm)
      ? this.lastAcceptedCwtBpm
      : this.lastSmoothedCwtBpm;
    let lowBpm = minBpm;
    let highBpm = maxBpm;
    if (Number.isFinite(lsBpm) && lsBpm > 0 && Number.isFinite(prior) && prior > 0) {
      lowBpm = Math.min(lsBpm, prior) - 25;
      highBpm = Math.max(lsBpm, prior) + 25;
    } else if (Number.isFinite(lsBpm) && lsBpm > 0) {
      lowBpm = lsBpm - 30;
      highBpm = lsBpm + 30;
    } else if (Number.isFinite(prior) && prior > 0) {
      lowBpm = prior - 25;
      highBpm = prior + 25;
    }
    return {
      lowBpm: roundForDebug(clamp(lowBpm, minBpm, maxBpm)),
      highBpm: roundForDebug(clamp(highBpm, minBpm, maxBpm))
    };
  }

  updateCwtDiagnostic({
    rawBpm,
    constrainedBpm,
    lsBpm,
    now,
    frameMeta = {},
    searchLowBpm,
    searchHighBpm,
    currentWinSize = PARAMS.hrWindowSec * this.targetFs,
    fullWinSize = PARAMS.hrWindowSec * this.targetFs
  }) {
    const debug = this.lastCwtDebug ?? {};
    const candidateBpm = Number.isFinite(constrainedBpm) && constrainedBpm > 0 ? constrainedBpm : rawBpm;
    const prior = Number.isFinite(this.lastGatedCwtBpm)
      ? this.lastGatedCwtBpm
      : Number.isFinite(this.lastSmoothedCwtBpm)
        ? this.lastSmoothedCwtBpm
      : this.lastAcceptedCwtBpm;
    const dtSec = Number.isFinite(this.lastCwtDiagnosticTime)
      ? Math.max(1, (now - this.lastCwtDiagnosticTime) / 1000)
      : 1;
    const cwtJumpBpm = Number.isFinite(prior) ? rawBpm - prior : 0;
    const gatedJumpBpm = Number.isFinite(prior) ? candidateBpm - prior : 0;
    const cwtLsDivergenceBpm = Number.isFinite(lsBpm) && Number.isFinite(rawBpm) ? Math.abs(rawBpm - lsBpm) : null;
    const gatedLsDivergenceBpm = Number.isFinite(lsBpm) && Number.isFinite(candidateBpm) ? Math.abs(candidateBpm - lsBpm) : null;
    const cwtCoverageRatio = fullWinSize > 0 ? clamp(currentWinSize / fullWinSize, 0, 1) : 0;
    const reasons = [];
    let quality = 1;

    if (!Number.isFinite(debug.powerRatio) || debug.powerRatio < 1.005) {
      reasons.push('flat_power');
      quality -= 0.25;
    }
    if (!Number.isFinite(debug.signalScale) || debug.signalScale < 0.00005) {
      reasons.push('weak_signal');
      quality -= 0.2;
    }
    if (Number.isFinite(debug.signalClippedFraction) && debug.signalClippedFraction > 0.05) {
      reasons.push('clipped_signal');
      quality -= 0.15;
    }
    if (Number.isFinite(cwtLsDivergenceBpm) && cwtLsDivergenceBpm > 25) {
      reasons.push('cwt_ls_divergence');
      quality -= 0.25;
    }
    if (Number.isFinite(frameMeta.skinFraction) && frameMeta.skinFraction < 0.15) {
      reasons.push('low_skin_fraction');
      quality -= 0.2;
    }
    if (Number.isFinite(frameMeta.roiMotionPx) && frameMeta.roiMotionPx > 25) {
      reasons.push('roi_motion');
      quality -= 0.15;
    }
    if (frameMeta.scaleJump || (Number.isFinite(frameMeta.interEyeDeltaPct) && Math.abs(frameMeta.interEyeDeltaPct) > 5)) {
      reasons.push('scale_jump');
      quality -= 0.3;
    }
    if (Number.isFinite(frameMeta.interEyeVelocityPctPerSec) && Math.abs(frameMeta.interEyeVelocityPctPerSec) > 10) {
      reasons.push('scale_motion');
      quality -= 0.15;
    }
    if (Number.isFinite(cwtJumpBpm) && Math.abs(cwtJumpBpm) > 10 * dtSec) {
      reasons.push('cwt_jump');
      quality -= 0.25;
    }
    if (Number.isFinite(frameMeta.frameDeltaMs) && frameMeta.frameDeltaMs > PARAMS.maxFrameGapMs) {
      reasons.push('frame_gap');
      quality -= 0.3;
    }
    if (cwtCoverageRatio < 0.3) {
      reasons.push('low_coverage');
      quality -= 0.2;
    }

    quality = clamp(quality, 0, 1);
    const cwtRawAccepted = quality >= 0.55;
    const gatedReasons = [];
    const gatedPowerRatio = debug.constrainedPowerRatio ?? debug.powerRatio;
    if (!Number.isFinite(gatedPowerRatio) || gatedPowerRatio < 1.005) gatedReasons.push('flat_power');
    if (Number.isFinite(gatedLsDivergenceBpm) && gatedLsDivergenceBpm > 25) gatedReasons.push('cwt_ls_divergence');
    if (Number.isFinite(gatedJumpBpm) && Math.abs(gatedJumpBpm) > 10 * dtSec) gatedReasons.push('cwt_jump');
    if (reasons.includes('weak_signal')) gatedReasons.push('weak_signal');
    if (reasons.includes('clipped_signal')) gatedReasons.push('clipped_signal');
    if (reasons.includes('low_skin_fraction')) gatedReasons.push('low_skin_fraction');
    if (reasons.includes('roi_motion')) gatedReasons.push('roi_motion');
    if (reasons.includes('scale_jump')) gatedReasons.push('scale_jump');
    if (reasons.includes('scale_motion')) gatedReasons.push('scale_motion');
    if (reasons.includes('frame_gap')) gatedReasons.push('frame_gap');
    if (reasons.includes('low_coverage')) gatedReasons.push('low_coverage');
    const cwtGatedAccepted = gatedReasons.length === 0;
    let cwtGatedBpm = candidateBpm;
    let cwtFallbackReason = '';
    if (!cwtGatedAccepted) {
      const canHoldPrior = Number.isFinite(prior)
        && Number.isFinite(this.lastCwtDiagnosticTime)
        && (now - this.lastCwtDiagnosticTime) <= 3000;
      if (canHoldPrior) {
        cwtGatedBpm = prior;
        cwtFallbackReason = `${gatedReasons.join('|')}|hold_prior`;
      } else if (Number.isFinite(lsBpm) && lsBpm > 0) {
        cwtGatedBpm = lsBpm;
        cwtFallbackReason = `${gatedReasons.join('|')}|fallback_ls`;
      } else if (Number.isFinite(prior)) {
        cwtGatedBpm = prior;
        cwtFallbackReason = `${gatedReasons.join('|')}|hold_prior`;
      } else {
        cwtFallbackReason = gatedReasons.join('|');
      }
    }

    const diagnostic = {
      cwtRawBpm: roundForDebug(rawBpm),
      cwtConstrainedBpm: roundForDebug(constrainedBpm),
      cwtGatedBpm: roundForDebug(cwtGatedBpm),
      cwtSmoothedBpm: roundForDebug(cwtGatedBpm),
      cwtRawAccepted,
      cwtGatedAccepted,
      cwtAccepted: cwtGatedAccepted,
      cwtQuality: roundForDebug(quality),
      cwtRejectReason: cwtRawAccepted ? '' : reasons.join('|'),
      cwtFallbackReason,
      cwtPowerRatio: debug.powerRatio,
      cwtLsDivergenceBpm: roundForDebug(cwtLsDivergenceBpm),
      cwtJumpBpm: roundForDebug(cwtJumpBpm),
      cwtDeltaBpm: roundForDebug(cwtJumpBpm),
      cwtCoverageRatio: roundForDebug(cwtCoverageRatio),
      cwtSearchLowBpm: roundForDebug(searchLowBpm),
      cwtSearchHighBpm: roundForDebug(searchHighBpm)
    };

    this.lastCwtDiagnosticTime = now;
    this.lastSmoothedCwtBpm = cwtGatedBpm;
    this.lastGatedCwtBpm = cwtGatedBpm;
    if (cwtGatedAccepted) this.lastAcceptedCwtBpm = cwtGatedBpm;
    this.lastCwtDiagnostic = diagnostic;
    return diagnostic;
  }

  runCWTOnBuffer(buffer, winSize, options = {}) {
    const normalized = robustNormalizeSignal(buffer.slice(buffer.length - winSize));
    const signal = normalized.values;
    const fs = this.targetFs;
    const mean = signal.reduce((sum, value) => sum + value, 0) / signal.length;
    let bestFreq = 0;
    let maxPower = -1;
    let secondFreq = 0;
    let secondPower = -1;
    const lowHz = clamp((options.lowBpm ?? PARAMS.filter.low * 60) / 60, PARAMS.filter.low, PARAMS.filter.high);
    const highHz = clamp((options.highBpm ?? PARAMS.filter.high * 60) / 60, PARAMS.filter.low, PARAMS.filter.high);
    const candidates = [];
    for (let f = lowHz; f <= highHz; f += 1 / 60) {
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
      candidates.push({ bpm: f * 60, power });
      if (power > maxPower) {
        secondPower = maxPower;
        secondFreq = bestFreq;
        maxPower = power;
        bestFreq = f;
      } else if (power > secondPower) {
        secondPower = power;
        secondFreq = f;
      }
    }
    this.lastCwtDebug = {
      windowSamples: signal.length,
      windowSec: signal.length / fs,
      searchLowBpm: roundForDebug(lowHz * 60),
      searchHighBpm: roundForDebug(highHz * 60),
      bestBpm: roundForDebug(bestFreq * 60),
      bestPower: roundForDebug(maxPower),
      secondBpm: roundForDebug(secondFreq * 60),
      secondPower: roundForDebug(secondPower),
      topCandidates: candidates
        .sort((a, b) => b.power - a.power)
        .slice(0, 5)
        .map((candidate) => ({
          bpm: roundForDebug(candidate.bpm),
          power: roundForDebug(candidate.power)
        })),
      powerRatio: secondPower > 0 ? roundForDebug(maxPower / secondPower) : null,
      signalMedian: roundForDebug(normalized.median),
      signalMad: roundForDebug(normalized.mad),
      signalScale: roundForDebug(normalized.scale),
      signalMaxAbsZ: roundForDebug(normalized.maxAbsZ),
      signalClippedFraction: roundForDebug(normalized.clippedFraction)
    };
    return bestFreq * 60;
  }

  runLSOnBuffer(buffer, winSize) {
    const signal = buffer.slice(buffer.length - winSize);
    const fs = this.targetFs;
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
    const normalized = robustNormalizeSignal(signal);
    signal = normalized.values;
    const fs = this.targetFs;
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
    this.lastCwtCountDebug = {
      signalSamples: signal.length,
      targetSamples,
      rawPeakCount: peaks.length,
      validPeakCount: validPeaks.length,
      signalMedian: roundForDebug(normalized.median),
      signalMad: roundForDebug(normalized.mad),
      signalScale: roundForDebug(normalized.scale),
      signalMaxAbsZ: roundForDebug(normalized.maxAbsZ),
      signalClippedFraction: roundForDebug(normalized.clippedFraction)
    };
    return validPeaks.length;
  }
}

function std(values) {
  const mu = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / values.length);
}

function robustNormalizeSignal(values) {
  if (!values.length) return emptyRobustSignal();
  const med = median(values);
  const centered = values.map((value) => value - med);
  const mad = median(centered.map(Math.abs));
  const scale = mad > 1e-9 ? 1.4826 * mad : std(centered);
  if (!Number.isFinite(scale) || scale <= 1e-9) {
    return {
      values: centered,
      median: med,
      mad,
      scale,
      maxAbsZ: 0,
      clippedFraction: 0
    };
  }
  const clip = 3.5 * scale;
  let clippedCount = 0;
  let maxAbsZ = 0;
  const normalized = centered.map((value) => {
    const absZ = Math.abs(value / scale);
    maxAbsZ = Math.max(maxAbsZ, absZ);
    const clipped = Math.max(-clip, Math.min(clip, value));
    if (clipped !== value) clippedCount += 1;
    return clipped / scale;
  });
  return {
    values: normalized,
    median: med,
    mad,
    scale,
    maxAbsZ,
    clippedFraction: clippedCount / values.length
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function emptyRobustSignal() {
  return {
    values: [],
    median: 0,
    mad: 0,
    scale: 0,
    maxAbsZ: 0,
    clippedFraction: 0
  };
}

function roundForDebug(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function roundDebugObject(value) {
  const rounded = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    rounded[key] = Number.isFinite(entry) ? roundForDebug(entry, 6) : entry;
  }
  return rounded;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
