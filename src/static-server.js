import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm'
};

export async function serveStatic(rootDir, requestPath, res) {
  const safePath = decodeURIComponent(requestPath).replace(/^\/+/, '') || 'index.html';
  const fullPath = path.normalize(path.join(rootDir, safePath));
  if (!isInside(rootDir, fullPath)) {
    return text(res, 'Forbidden', 403);
  }
  const fileStat = await stat(fullPath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    return text(res, 'Not found', 404);
  }
  const ext = path.extname(fullPath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ...cacheHeadersFor(ext)
  });
  createReadStream(fullPath).pipe(res);
}

function cacheHeadersFor(ext) {
  if (ext === '.html' || ext === '.js' || ext === '.css') {
    return { 'Cache-Control': 'no-store, max-age=0' };
  }
  return {};
}

export async function serveSharedAlgorithm(sharedDir, pathname, res) {
  const relativePath = pathname.replace(/^\/shared\//, '');
  return serveStatic(sharedDir, relativePath, res);
}

export function json(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

export function text(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(payload);
}

export function isInside(rootDir, fullPath) {
  const relative = path.relative(rootDir, fullPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
