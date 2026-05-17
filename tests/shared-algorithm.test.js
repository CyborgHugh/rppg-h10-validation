import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const originalApp = await readFile(new URL('../main/public/app.js', import.meta.url), 'utf8');
const simplifiedApp = await readFile(new URL('../simplified/public/app.js', import.meta.url), 'utf8');
const mainAnalysis = await readFile(new URL('../main/src/analysis.js', import.meta.url), 'utf8');

assert.match(originalApp, /from ['"]\/shared\/algorithm\/rppg-pipeline\.js['"]/);
assert.match(originalApp, /from ['"]\/shared\/algorithm\/roi-utils\.js['"]/);
assert.match(simplifiedApp, /from ['"]\/shared\/algorithm\/rppg-pipeline\.js['"]/);
assert.match(simplifiedApp, /from ['"]\/shared\/algorithm\/roi-utils\.js['"]/);
assert.match(mainAnalysis, /from ['"]\.\.\/\.\.\/shared\/algorithm\/madan-interval\.js['"]/);
assert.match(simplifiedApp, /from ['"]\/shared\/algorithm\/madan-interval\.js['"]/);
assert.match(originalApp, /madanPcaCwtBeats/);
assert.match(originalApp, /madanPosCwtBeats/);
assert.doesNotMatch(originalApp, /cwtGatedBeats/);

const originalPipeline = await readFile(new URL('../main/public/rppg-pipeline.js', import.meta.url), 'utf8');
const simplifiedPipeline = await readFile(new URL('../simplified/public/rppg-pipeline.js', import.meta.url), 'utf8');
assert.match(originalPipeline, /export \* from ['"]\/shared\/algorithm\/rppg-pipeline\.js['"]/);
assert.match(simplifiedPipeline, /export \* from ['"]\/shared\/algorithm\/rppg-pipeline\.js['"]/);

const manifest = await import('../shared/algorithm/manifest.js');
assert.equal(manifest.ALGORITHM_MANIFEST.algorithmName, 'rppg-pos-ls-cwt');
assert.ok(manifest.ALGORITHM_MANIFEST.algorithmVersion);
assert.ok(manifest.ALGORITHM_MANIFEST.params.targetFs > 0);
