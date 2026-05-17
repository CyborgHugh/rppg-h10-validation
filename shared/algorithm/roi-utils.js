export const PRIMARY_ROI_NAMES = ['forehead', 'leftCheek', 'rightCheek'];
export const ROI_MODES = {
  BOX_RECT_LEGACY: 'boxRectLegacy',
  LANDMARK_PATCH_COMPACT: 'landmarkPatchCompact'
};
export const ROI_COMPOSITIONS = {
  ALL: 'all',
  CHEEKS_ONLY: 'cheeksOnly',
  FOREHEAD_ONLY: 'foreheadOnly'
};
export const SKIN_MODES = {
  HARD_YCBCR: 'hardYcbcr',
  SOFT_YCBCR: 'softYcbcr'
};
export const COMPACT_LANDMARK_PATCHES = {
  forehead: [[-0.30, -0.44], [0.30, -0.44], [0.26, -0.24], [-0.26, -0.24]],
  leftCheek: [[-0.56, 0.26], [-0.34, 0.22], [-0.31, 0.52], [-0.54, 0.56]],
  rightCheek: [[0.34, 0.22], [0.56, 0.26], [0.54, 0.56], [0.31, 0.52]]
};
export const DEFAULT_COMPACT_ROI_SAMPLE_COUNT = 96;
const DEFAULT_SKIN_PARAMS = { yMin: 60, yMax: 255, cbMin: 77, cbMax: 127, crMin: 133, crMax: 173 };

export function faceBoxFromLandmarks(landmarks, imageWidth, imageHeight) {
  if (!landmarks?.length) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const pt of landmarks) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  const x = clamp(Math.round(minX * imageWidth), 0, imageWidth - 1);
  const y = clamp(Math.round(minY * imageHeight), 0, imageHeight - 1);
  const width = clamp(Math.round((maxX - minX) * imageWidth), 1, imageWidth - x);
  const height = clamp(Math.round((maxY - minY) * imageHeight), 1, imageHeight - y);
  return { x, y, width, height };
}

export function defineRoiRegions(faceBox, imageWidth, imageHeight) {
  const region = (name, rx, ry, rw, rh) => {
    const x = clamp(Math.round(faceBox.x + faceBox.width * rx), 0, imageWidth - 1);
    const y = clamp(Math.round(faceBox.y + faceBox.height * ry), 0, imageHeight - 1);
    const width = clamp(Math.round(faceBox.width * rw), 1, imageWidth - x);
    const height = clamp(Math.round(faceBox.height * rh), 1, imageHeight - y);
    return { name, shape: 'rect', x, y, width, height, points: rectPoints(x, y, width, height) };
  };

  return {
    forehead: region('forehead', 0.3, 0.1, 0.4, 0.16),
    leftCheek: region('leftCheek', 0.18, 0.4, 0.22, 0.24),
    rightCheek: region('rightCheek', 0.6, 0.4, 0.22, 0.24),
    upperFace: region('upperFace', 0, 0, 1, 0.6)
  };
}

export function defineLandmarkPatchRegions(landmarks, imageWidth, imageHeight) {
  if (!landmarks?.length) return null;
  const leftEye = landmarkPoint(landmarks, 33, imageWidth, imageHeight);
  const rightEye = landmarkPoint(landmarks, 263, imageWidth, imageHeight);
  const nose = landmarkPoint(landmarks, 1, imageWidth, imageHeight)
    ?? landmarkPoint(landmarks, 168, imageWidth, imageHeight);
  const chin = landmarkPoint(landmarks, 152, imageWidth, imageHeight);
  if (!leftEye || !rightEye || !nose) return null;

  const eyeDx = rightEye.x - leftEye.x;
  const eyeDy = rightEye.y - leftEye.y;
  const interEyeDistancePx = Math.max(1, Math.hypot(eyeDx, eyeDy));
  const xAxis = { x: eyeDx / interEyeDistancePx, y: eyeDy / interEyeDistancePx };
  let yAxis = { x: -xAxis.y, y: xAxis.x };
  const midEye = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const downAnchor = chin ?? nose;
  const downDot = (downAnchor.x - midEye.x) * yAxis.x + (downAnchor.y - midEye.y) * yAxis.y;
  if (downDot < 0) yAxis = { x: -yAxis.x, y: -yAxis.y };
  const faceRollDeg = Math.atan2(xAxis.y, xAxis.x) * 180 / Math.PI;
  const scale = interEyeDistancePx;
  const point = (u, v) => clampPoint({
    x: midEye.x + u * scale * xAxis.x + v * scale * yAxis.x,
    y: midEye.y + u * scale * xAxis.y + v * scale * yAxis.y
  }, imageWidth, imageHeight);
  const polygon = (name, coords, sampleCount = DEFAULT_COMPACT_ROI_SAMPLE_COUNT) => {
    const points = coords.map(([u, v]) => point(u, v));
    const box = boundsFromPoints(points, imageWidth, imageHeight);
    const normalizedSamples = normalizedSamplePoints(coords, sampleCount);
    const samplePoints = normalizedSamples.map(([u, v]) => point(u, v));
    const patchAreaPx = polygonArea(points);
    return {
      name,
      shape: 'polygon',
      roiMode: ROI_MODES.LANDMARK_PATCH_COMPACT,
      points,
      normalizedPolygon: coords.map(([u, v]) => [u, v]),
      normalizedSamples,
      samplePoints,
      fixedSampleCount: normalizedSamples.length,
      patchAreaPx,
      ...box
    };
  };
  const regions = {
    forehead: polygon('forehead', COMPACT_LANDMARK_PATCHES.forehead),
    leftCheek: polygon('leftCheek', COMPACT_LANDMARK_PATCHES.leftCheek),
    rightCheek: polygon('rightCheek', COMPACT_LANDMARK_PATCHES.rightCheek),
    upperFace: defineRoiRegions(faceBoxFromLandmarks(landmarks, imageWidth, imageHeight), imageWidth, imageHeight).upperFace
  };
  Object.defineProperties(regions, {
    faceRollDeg: { value: faceRollDeg, enumerable: false },
    interEyeDistancePx: { value: interEyeDistancePx, enumerable: false },
    faceScalePx: { value: scale, enumerable: false }
  });
  return regions;
}

export function analyzeRoiCandidates(...args) {
  const options = normalizeAnalyzeArgs(args);
  const {
    imageData,
    faceBox,
    landmarks,
    skinParams,
    previousCandidates,
    mode,
    skinMode,
    roiComposition,
    perfMs
  } = options;
  const regions = mode === ROI_MODES.LANDMARK_PATCH_COMPACT && landmarks?.length
    ? defineLandmarkPatchRegions(landmarks, imageData.width, imageData.height)
    : defineRoiRegions(faceBox, imageData.width, imageData.height);
  if (!regions) return [];
  return Object.values(regions).map((region) => analyzeRoiRegion(
    imageData,
    region,
    skinParams,
    previousCandidates[region.name],
    {
      roiMode: mode,
      skinMode,
      faceRollDeg: regions.faceRollDeg,
      interEyeDistancePx: regions.interEyeDistancePx,
      faceScalePx: regions.faceScalePx,
      roiComposition,
      perfMs
    }
  ));
}

export function combinePrimaryRois(candidates, options = {}) {
  const primaryNames = primaryNamesForComposition(options.roiComposition, options.primaryRoiNames);
  const accepted = candidates.filter((candidate) => (
    primaryNames.includes(candidate.name) && candidate.accepted
  ));
  if (!accepted.length) return null;

  const totalSkin = accepted.reduce((sum, roi) => sum + finiteOrZero(roi.effectiveSkinPixelCount ?? roi.skinPixelCount), 0);
  const totalSampled = accepted.reduce((sum, roi) => sum + finiteOrZero(roi.sampledPixelCount), 0);
  const weighted = (key) => totalSkin > 0
    ? accepted.reduce((sum, roi) => sum + finiteOrZero(roi[key]) * finiteOrZero(roi.effectiveSkinPixelCount ?? roi.skinPixelCount), 0) / totalSkin
    : null;
  const minX = Math.min(...accepted.map((roi) => roi.x));
  const minY = Math.min(...accepted.map((roi) => roi.y));
  const maxX = Math.max(...accepted.map((roi) => roi.x + roi.width));
  const maxY = Math.max(...accepted.map((roi) => roi.y + roi.height));
  const maxMotion = accepted.reduce((max, roi) => Math.max(max, finiteOrZero(roi.roiMotionPx)), 0);
  const maxRgbJump = accepted.reduce((max, roi) => Math.max(max, finiteOrZero(roi.rgbJump)), 0);
  const maxAbsField = (key) => accepted.reduce((best, roi) => (
    Math.abs(finiteOrZero(roi[key])) > Math.abs(best) ? finiteOrZero(roi[key]) : best
  ), 0);
  const totalFixedSamples = accepted.reduce((sum, roi) => sum + finiteOrZero(roi.fixedSampleCount), 0);

  return {
    r: weighted('r'),
    g: weighted('g'),
    b: weighted('b'),
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    skinPixelCount: totalSkin,
    effectiveSkinPixelCount: totalSkin,
    sampledPixelCount: totalSampled,
    fixedSampleCount: totalFixedSamples || totalSampled,
    effectiveSkinSampleCount: totalSkin,
    skinFraction: totalSampled > 0 ? totalSkin / totalSampled : 0,
    hardSkinFraction: totalSampled > 0
      ? accepted.reduce((sum, roi) => sum + finiteOrZero(roi.hardSkinPixelCount ?? roi.skinPixelCount), 0) / totalSampled
      : 0,
    roiMotionPx: maxMotion,
    rgbJump: maxRgbJump,
    regionSet: accepted.map((roi) => roi.name).join('+'),
    candidateCount: accepted.length,
    roiMode: accepted[0]?.roiMode,
    skinMode: accepted[0]?.skinMode,
    roiComposition: options.roiComposition ?? accepted[0]?.roiComposition ?? ROI_COMPOSITIONS.ALL,
    faceRollDeg: accepted[0]?.faceRollDeg,
    interEyeDistancePx: accepted[0]?.interEyeDistancePx,
    faceScalePx: accepted[0]?.faceScalePx,
    interEyeDeltaPct: maxAbsField('interEyeDeltaPct'),
    interEyeVelocityPctPerSec: maxAbsField('interEyeVelocityPctPerSec'),
    patchAreaPx: accepted.reduce((sum, roi) => sum + finiteOrZero(roi.patchAreaPx), 0),
    patchAreaDeltaPct: maxAbsField('patchAreaDeltaPct'),
    scaleJump: accepted.some((roi) => roi.scaleJump)
  };
}

function analyzeRoiRegion(imageData, region, skinParams, previous, options = {}) {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let weightSum = 0;
  let skinPixelCount = 0;
  let sampledPixelCount = 0;

  if (region.samplePoints?.length) {
    for (const samplePoint of region.samplePoints) {
      sampledPixelCount += 1;
      const { r, g, b } = bilinearRgb(imageData, samplePoint.x, samplePoint.y);
      const hardSkin = isSkinPixel(r, g, b, skinParams);
      const weight = options.skinMode === SKIN_MODES.SOFT_YCBCR
        ? skinWeightYcbcr(r, g, b, skinParams)
        : (hardSkin ? 1 : 0);
      if (hardSkin) {
        skinPixelCount += 1;
      }
      if (weight > 0) {
        rSum += r * weight;
        gSum += g * weight;
        bSum += b * weight;
        weightSum += weight;
      }
    }
  } else {
    const data = imageData.data;
    for (let y = region.y; y < region.y + region.height; y += 2) {
      for (let x = region.x; x < region.x + region.width; x += 2) {
        if (region.shape === 'polygon' && !pointInPolygon(x + 0.5, y + 0.5, region.points)) continue;
        sampledPixelCount += 1;
        const idx = (y * imageData.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const hardSkin = isSkinPixel(r, g, b, skinParams);
        const weight = options.skinMode === SKIN_MODES.SOFT_YCBCR
          ? skinWeightYcbcr(r, g, b, skinParams)
          : (hardSkin ? 1 : 0);
        if (hardSkin) {
          skinPixelCount += 1;
        }
        if (weight > 0) {
          rSum += r * weight;
          gSum += g * weight;
          bSum += b * weight;
          weightSum += weight;
        }
      }
    }
  }

  const skinFraction = sampledPixelCount > 0 ? skinPixelCount / sampledPixelCount : 0;
  const effectiveSkinFraction = sampledPixelCount > 0 ? weightSum / sampledPixelCount : 0;
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const roiMotionPx = previous
    ? Math.hypot(centerX - previous.roiCenterX, centerY - previous.roiCenterY)
    : 0;
  const skinFractionDelta = previous
    ? skinFraction - finiteOrZero(previous.skinFraction)
    : 0;
  const rMean = weightSum > 0 ? rSum / weightSum : null;
  const gMean = weightSum > 0 ? gSum / weightSum : null;
  const bMean = weightSum > 0 ? bSum / weightSum : null;
  const rgbJump = previous && Number.isFinite(previous.r) && Number.isFinite(previous.g) && Number.isFinite(previous.b)
    ? Math.hypot(finiteOrZero(rMean) - previous.r, finiteOrZero(gMean) - previous.g, finiteOrZero(bMean) - previous.b)
    : 0;
  const rejectReason = roiRejectReason(sampledPixelCount, weightSum, effectiveSkinFraction);
  const patchAreaPx = roundForDebug(Number.isFinite(region.patchAreaPx)
    ? region.patchAreaPx
    : (region.shape === 'polygon' ? polygonArea(region.points) : region.width * region.height), 3);
  const interEyeDeltaPct = previous && Number.isFinite(options.interEyeDistancePx) && Number.isFinite(previous.interEyeDistancePx) && previous.interEyeDistancePx > 0
    ? ((options.interEyeDistancePx - previous.interEyeDistancePx) / previous.interEyeDistancePx) * 100
    : 0;
  const patchAreaDeltaPct = previous && Number.isFinite(patchAreaPx) && Number.isFinite(previous.patchAreaPx) && previous.patchAreaPx > 0
    ? ((patchAreaPx - previous.patchAreaPx) / previous.patchAreaPx) * 100
    : 0;
  const dtSec = previous && Number.isFinite(options.perfMs) && Number.isFinite(previous.perfMs)
    ? Math.max(1e-3, (options.perfMs - previous.perfMs) / 1000)
    : null;
  const interEyeVelocityPctPerSec = Number.isFinite(dtSec) ? interEyeDeltaPct / dtSec : 0;
  const scaleJump = Math.abs(interEyeDeltaPct) > 5;

  return {
    roiName: region.name,
    name: region.name,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    shape: region.shape,
    polygonJson: JSON.stringify((region.points ?? []).map((point) => ({
      x: roundForDebug(point.x, 3),
      y: roundForDebug(point.y, 3)
    }))),
    normalizedPolygonJson: JSON.stringify(region.normalizedPolygon ?? []),
    patchAreaPx,
    patchAreaDeltaPct: roundForDebug(patchAreaDeltaPct),
    fixedSampleCount: region.fixedSampleCount ?? sampledPixelCount,
    roiCenterX: centerX,
    roiCenterY: centerY,
    roiMotionPx,
    skinPixelCount: options.skinMode === SKIN_MODES.SOFT_YCBCR ? weightSum : skinPixelCount,
    hardSkinPixelCount: skinPixelCount,
    effectiveSkinPixelCount: weightSum,
    effectiveSkinSampleCount: weightSum,
    sampledPixelCount,
    skinFraction: options.skinMode === SKIN_MODES.SOFT_YCBCR ? effectiveSkinFraction : skinFraction,
    hardSkinFraction: skinFraction,
    effectiveSkinFraction,
    skinFractionDelta,
    rgbJump,
    roiMode: options.roiMode,
    skinMode: options.skinMode,
    roiComposition: options.roiComposition,
    perfMs: options.perfMs,
    faceRollDeg: options.faceRollDeg,
    interEyeDistancePx: options.interEyeDistancePx,
    interEyeDeltaPct: roundForDebug(interEyeDeltaPct),
    interEyeVelocityPctPerSec: roundForDebug(interEyeVelocityPctPerSec),
    scaleJump,
    faceScalePx: options.faceScalePx,
    accepted: rejectReason === '',
    rejectReason,
    r: rMean,
    g: gMean,
    b: bMean
  };
}

function roiRejectReason(sampledPixelCount, skinPixelCount, skinFraction) {
  if (sampledPixelCount <= 0) return 'no_samples';
  if (skinPixelCount < 50) return 'low_skin_pixels';
  if (skinFraction < 0.15) return 'low_skin_fraction';
  return '';
}

function isSkinPixel(r, g, b, skinParams) {
  const { yVal, cb, cr } = rgbToYcbcr(r, g, b);
  return yVal > skinParams.yMin
    && cb >= skinParams.cbMin
    && cb <= skinParams.cbMax
    && cr >= skinParams.crMin
    && cr <= skinParams.crMax;
}

function skinWeightYcbcr(r, g, b, skinParams) {
  const { yVal, cb, cr } = rgbToYcbcr(r, g, b);
  return Math.min(
    softBandWeight(yVal, skinParams.yMin, skinParams.yMax, 35),
    softBandWeight(cb, skinParams.cbMin, skinParams.cbMax, 20),
    softBandWeight(cr, skinParams.crMin, skinParams.crMax, 20)
  );
}

function rgbToYcbcr(r, g, b) {
  const yVal = 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255;
  const cb = 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255;
  const cr = 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255;
  return { yVal, cb, cr };
}

function softBandWeight(value, min, max, margin) {
  if (value >= min && value <= max) return 1;
  if (value < min) return clamp(1 - ((min - value) / margin), 0, 1);
  return clamp(1 - ((value - max) / margin), 0, 1);
}

function normalizeAnalyzeArgs(args) {
  const [first, second, third, fourth] = args;
  if (first?.imageData) {
    const faceBox = first.faceBox ?? (first.landmarks
      ? faceBoxFromLandmarks(first.landmarks, first.imageWidth ?? first.imageData.width, first.imageHeight ?? first.imageData.height)
      : null);
    return {
      imageData: first.imageData,
      faceBox,
      landmarks: first.landmarks,
      skinParams: first.skinParams ?? DEFAULT_SKIN_PARAMS,
      previousCandidates: first.previousCandidates ?? {},
      mode: first.mode ?? ROI_MODES.BOX_RECT_LEGACY,
      skinMode: first.skinMode ?? SKIN_MODES.HARD_YCBCR,
      roiComposition: first.roiComposition ?? ROI_COMPOSITIONS.ALL,
      perfMs: first.perfMs
    };
  }
  return {
    imageData: first,
    faceBox: second,
    landmarks: null,
    skinParams: third ?? DEFAULT_SKIN_PARAMS,
    previousCandidates: fourth ?? {},
    mode: ROI_MODES.BOX_RECT_LEGACY,
    skinMode: SKIN_MODES.HARD_YCBCR,
    roiComposition: ROI_COMPOSITIONS.ALL,
    perfMs: null
  };
}

function landmarkPoint(landmarks, index, imageWidth, imageHeight) {
  const point = landmarks[index];
  if (!point) return null;
  return { x: point.x * imageWidth, y: point.y * imageHeight };
}

function rectPoints(x, y, width, height) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ];
}

function primaryNamesForComposition(roiComposition = ROI_COMPOSITIONS.ALL, explicitNames = null) {
  if (explicitNames?.length) return explicitNames;
  if (roiComposition === ROI_COMPOSITIONS.CHEEKS_ONLY) return ['leftCheek', 'rightCheek'];
  if (roiComposition === ROI_COMPOSITIONS.FOREHEAD_ONLY) return ['forehead'];
  return PRIMARY_ROI_NAMES;
}

function normalizedSamplePoints(points, sampleCount) {
  const minU = Math.min(...points.map(([u]) => u));
  const maxU = Math.max(...points.map(([u]) => u));
  const minV = Math.min(...points.map(([, v]) => v));
  const maxV = Math.max(...points.map(([, v]) => v));
  const candidates = [];
  const columns = Math.ceil(Math.sqrt(sampleCount * ((maxU - minU) / Math.max(maxV - minV, 1e-6))));
  const rows = Math.ceil(sampleCount / Math.max(1, columns)) + 2;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns + 2; col += 1) {
      const u = minU + ((col + 0.5) / (columns + 2)) * (maxU - minU);
      const v = minV + ((row + 0.5) / rows) * (maxV - minV);
      if (pointInNormalizedPolygon(u, v, points)) candidates.push([u, v]);
    }
  }
  if (candidates.length >= sampleCount) return evenlyPick(candidates, sampleCount);
  const filled = [...candidates];
  while (filled.length < sampleCount && candidates.length) filled.push(candidates[filled.length % candidates.length]);
  return filled;
}

function evenlyPick(values, count) {
  if (values.length <= count) return values;
  const picked = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(values[Math.floor((i * values.length) / count)]);
  }
  return picked;
}

function pointInNormalizedPolygon(u, v, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [ui, vi] = points[i];
    const [uj, vj] = points[j];
    const intersects = ((vi > v) !== (vj > v))
      && (u < ((uj - ui) * (v - vi) / ((vj - vi) || 1e-9)) + ui);
    if (intersects) inside = !inside;
  }
  return inside;
}

function bilinearRgb(imageData, x, y) {
  const width = imageData.width;
  const height = imageData.height;
  const x0 = clamp(Math.floor(x), 0, width - 1);
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  const c00 = pixelRgb(imageData, x0, y0);
  const c10 = pixelRgb(imageData, x1, y0);
  const c01 = pixelRgb(imageData, x0, y1);
  const c11 = pixelRgb(imageData, x1, y1);
  return {
    r: bilerp(c00.r, c10.r, c01.r, c11.r, tx, ty),
    g: bilerp(c00.g, c10.g, c01.g, c11.g, tx, ty),
    b: bilerp(c00.b, c10.b, c01.b, c11.b, tx, ty)
  };
}

function pixelRgb(imageData, x, y) {
  const idx = (y * imageData.width + x) * 4;
  return {
    r: imageData.data[idx],
    g: imageData.data[idx + 1],
    b: imageData.data[idx + 2]
  };
}

function bilerp(c00, c10, c01, c11, tx, ty) {
  return c00 * (1 - tx) * (1 - ty)
    + c10 * tx * (1 - ty)
    + c01 * (1 - tx) * ty
    + c11 * tx * ty;
}

function boundsFromPoints(points, imageWidth, imageHeight) {
  const minX = clamp(Math.floor(Math.min(...points.map((point) => point.x))), 0, imageWidth - 1);
  const minY = clamp(Math.floor(Math.min(...points.map((point) => point.y))), 0, imageHeight - 1);
  const maxX = clamp(Math.ceil(Math.max(...points.map((point) => point.x))), minX + 1, imageWidth);
  const maxY = clamp(Math.ceil(Math.max(...points.map((point) => point.y))), minY + 1, imageHeight);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function clampPoint(point, imageWidth, imageHeight) {
  return {
    x: clamp(point.x, 0, imageWidth - 1),
    y: clamp(point.y, 0, imageHeight - 1)
  };
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi) / ((yj - yi) || 1e-9)) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonArea(points = []) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(area) / 2;
}

function roundForDebug(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}
