import assert from 'node:assert/strict';
import {
  analyzeRoiCandidates,
  combinePrimaryRois,
  defineRoiRegions,
  defineLandmarkPatchRegions,
  ROI_MODES,
  COMPACT_LANDMARK_PATCHES,
  DEFAULT_COMPACT_ROI_SAMPLE_COUNT
} from '../shared/algorithm/roi-utils.js';

{
  const faceBox = { x: 100, y: 50, width: 200, height: 300 };
  const regions = defineRoiRegions(faceBox, 640, 480);

  assert.deepEqual(Object.keys(regions), ['forehead', 'leftCheek', 'rightCheek', 'upperFace']);
  assert.ok(regions.forehead.y > faceBox.y, 'forehead should skip the hairline/top edge');
  assert.ok(
    regions.forehead.y + regions.forehead.height <= faceBox.y + faceBox.height * 0.3,
    'forehead should stay above the eye band'
  );
  assert.ok(
    regions.leftCheek.y >= faceBox.y + faceBox.height * 0.38,
    'left cheek should sit below the eye band'
  );
  assert.ok(
    regions.rightCheek.y >= faceBox.y + faceBox.height * 0.38,
    'right cheek should sit below the eye band'
  );
  assert.equal(regions.upperFace.height, Math.round(faceBox.height * 0.6));
}

{
  const imageWidth = 640;
  const imageHeight = 480;
  const landmarks = mockFaceLandmarks({ rollDeg: 18, imageWidth, imageHeight });
  const regions = defineLandmarkPatchRegions(landmarks, imageWidth, imageHeight);

  assert.deepEqual(Object.keys(regions), ['forehead', 'leftCheek', 'rightCheek', 'upperFace']);
  assert.equal(regions.forehead.shape, 'polygon');
  assert.ok(Math.abs(regions.faceRollDeg - 18) < 1, `expected face roll near 18 deg, got ${regions.faceRollDeg}`);
  assert.ok(regions.interEyeDistancePx > 100);
  assert.equal(regions.forehead.roiMode, ROI_MODES.LANDMARK_PATCH_COMPACT);
  assert.equal(regions.forehead.fixedSampleCount, DEFAULT_COMPACT_ROI_SAMPLE_COUNT);
  assert.ok(
    Math.max(...regions.forehead.points.map((point) => point.y))
      < Math.min(...regions.leftCheek.points.map((point) => point.y)),
    'landmark forehead should stay above cheek patches'
  );
  assert.ok(
    Math.max(...regions.forehead.points.map((point) => point.y))
      < Math.min(...regions.rightCheek.points.map((point) => point.y)),
    'landmark forehead should stay above cheek patches'
  );
  const eyeDistance = regions.interEyeDistancePx;
  const oldV2ForeheadArea = normalizedPolygonArea([[-0.42, -0.58], [0.42, -0.58], [0.34, -0.2], [-0.34, -0.2]]) * eyeDistance ** 2;
  const oldV2LeftCheekArea = normalizedPolygonArea([[-0.76, 0.18], [-0.28, 0.08], [-0.2, 0.62], [-0.68, 0.74]]) * eyeDistance ** 2;
  assert.ok(regions.forehead.patchAreaPx < oldV2ForeheadArea * 0.75, 'compact forehead should be smaller than old V2');
  assert.ok(regions.leftCheek.patchAreaPx < oldV2LeftCheekArea * 0.75, 'compact cheek should be smaller than old V2');
  assert.deepEqual(regions.forehead.normalizedPolygon, COMPACT_LANDMARK_PATCHES.forehead);
}

{
  const imageWidth = 160;
  const imageHeight = 120;
  const imageData = solidImageData(imageWidth, imageHeight, 120, 86, 76);
  const landmarks = mockFaceLandmarks({ imageWidth, imageHeight, centerX: 80, centerY: 55, eyeDistance: 52 });
  const hard = analyzeRoiCandidates({
    imageData,
    landmarks,
    imageWidth,
    imageHeight,
    mode: 'landmarkPatchCompact',
    skinMode: 'hardYcbcr',
    previousCandidates: {},
    perfMs: 1000
  });
  const soft = analyzeRoiCandidates({
    imageData,
    landmarks,
    imageWidth,
    imageHeight,
    mode: 'landmarkPatchCompact',
    skinMode: 'softYcbcr',
    previousCandidates: {},
    perfMs: 1000
  });

  const hardForehead = hard.find((candidate) => candidate.name === 'forehead');
  const softForehead = soft.find((candidate) => candidate.name === 'forehead');
  assert.equal(hardForehead.roiMode, 'landmarkPatchCompact');
  assert.equal(hardForehead.fixedSampleCount, 96);
  assert.equal(hardForehead.sampledPixelCount, 96);
  assert.equal(softForehead.skinMode, 'softYcbcr');
  assert.ok(softForehead.effectiveSkinPixelCount >= hardForehead.skinPixelCount);
  assert.ok(softForehead.polygonJson.includes('x'));
  assert.ok(Number.isFinite(softForehead.faceRollDeg));
}

{
  const imageWidth = 320;
  const imageHeight = 240;
  const imageData = solidImageData(imageWidth, imageHeight, 120, 86, 76);
  const near = analyzeRoiCandidates({
    imageData,
    landmarks: mockFaceLandmarks({ imageWidth, imageHeight, centerX: 160, centerY: 105, eyeDistance: 110 }),
    imageWidth,
    imageHeight,
    mode: 'landmarkPatchCompact',
    skinMode: 'hardYcbcr',
    previousCandidates: {},
    perfMs: 1000
  });
  const farther = analyzeRoiCandidates({
    imageData,
    landmarks: mockFaceLandmarks({ imageWidth, imageHeight, centerX: 160, centerY: 105, eyeDistance: 88 }),
    imageWidth,
    imageHeight,
    mode: 'landmarkPatchCompact',
    skinMode: 'hardYcbcr',
    previousCandidates: Object.fromEntries(near.map((candidate) => [candidate.name, candidate])),
    perfMs: 2000
  });
  const nearForehead = near.find((candidate) => candidate.name === 'forehead');
  const farForehead = farther.find((candidate) => candidate.name === 'forehead');

  assert.equal(nearForehead.sampledPixelCount, farForehead.sampledPixelCount);
  assert.equal(farForehead.fixedSampleCount, DEFAULT_COMPACT_ROI_SAMPLE_COUNT);
  assert.ok(farForehead.patchAreaPx < nearForehead.patchAreaPx);
  assert.ok(farForehead.scaleJump, '20% inter-eye change should be marked as a scale jump');
  assert.ok(farForehead.interEyeDeltaPct < -15);
  assert.ok(Number.isFinite(farForehead.interEyeVelocityPctPerSec));
}

{
  const combined = combinePrimaryRois([
    { name: 'forehead', accepted: true, r: 100, g: 90, b: 80, skinPixelCount: 100, x: 10, y: 10, width: 20, height: 10, skinFraction: 0.5 },
    { name: 'leftCheek', accepted: true, r: 140, g: 110, b: 90, skinPixelCount: 300, x: 12, y: 30, width: 12, height: 12, skinFraction: 0.75 },
    { name: 'rightCheek', accepted: false, rejectReason: 'low_skin_fraction', skinPixelCount: 0, sampledPixelCount: 100 },
    { name: 'upperFace', accepted: true, r: 10, g: 10, b: 10, skinPixelCount: 1000, x: 0, y: 0, width: 60, height: 60, skinFraction: 0.9 }
  ]);

  assert.equal(combined.regionSet, 'forehead+leftCheek');
  assert.equal(combined.r, 130);
  assert.equal(combined.g, 105);
  assert.equal(combined.b, 87.5);
  assert.equal(combined.skinPixelCount, 400);
  assert.equal(combined.sampledPixelCount, 0);
  assert.equal(combined.x, 10);
  assert.equal(combined.y, 10);
  assert.equal(combined.width, 20);
  assert.equal(combined.height, 32);
}

{
  const combined = combinePrimaryRois([
    { name: 'forehead', accepted: true, r: 100, g: 90, b: 80, skinPixelCount: 100, effectiveSkinPixelCount: 100, sampledPixelCount: 96, x: 10, y: 10, width: 20, height: 10, skinFraction: 0.5, scaleJump: false },
    { name: 'leftCheek', accepted: true, r: 140, g: 110, b: 90, skinPixelCount: 300, effectiveSkinPixelCount: 300, sampledPixelCount: 96, x: 12, y: 30, width: 12, height: 12, skinFraction: 0.75, scaleJump: true, interEyeDeltaPct: 8, interEyeVelocityPctPerSec: 8 },
    { name: 'rightCheek', accepted: true, r: 160, g: 120, b: 100, skinPixelCount: 300, effectiveSkinPixelCount: 300, sampledPixelCount: 96, x: 42, y: 30, width: 12, height: 12, skinFraction: 0.75, scaleJump: false, interEyeDeltaPct: 8, interEyeVelocityPctPerSec: 8 }
  ], { roiComposition: 'cheeksOnly' });

  assert.equal(combined.regionSet, 'leftCheek+rightCheek');
  assert.equal(combined.roiComposition, 'cheeksOnly');
  assert.equal(combined.fixedSampleCount, 192);
  assert.equal(combined.sampledPixelCount, 192);
  assert.equal(combined.scaleJump, true);
  assert.equal(combined.interEyeDeltaPct, 8);
}

function normalizedPolygonArea(points = []) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i][0] * next[1] - next[0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

function mockFaceLandmarks({
  rollDeg = 0,
  imageWidth = 640,
  imageHeight = 480,
  centerX = 320,
  centerY = 220,
  eyeDistance = 160
} = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: centerX / imageWidth, y: centerY / imageHeight, z: 0 }));
  const theta = rollDeg * Math.PI / 180;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const vx = -Math.sin(theta);
  const vy = Math.cos(theta);
  const place = (index, u, v) => {
    landmarks[index] = {
      x: (centerX + u * ux + v * vx) / imageWidth,
      y: (centerY + u * uy + v * vy) / imageHeight,
      z: 0
    };
  };
  place(33, -eyeDistance / 2, 0);
  place(263, eyeDistance / 2, 0);
  place(168, 0, 12);
  place(1, 0, 58);
  place(152, 0, 150);
  return landmarks;
}

function solidImageData(width, height, r, g, b) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}
