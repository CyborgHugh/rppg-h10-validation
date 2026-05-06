import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSession, finalizeSession, readJsonBody } from './src/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_ROOT = path.join(__dirname, 'data');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export function createAppServer({ publicDir = PUBLIC_DIR, dataRoot = DATA_ROOT } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/api/health') {
        return json(res, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/session') {
        const body = await readJsonBody(req);
        if (!body.participantId || !String(body.participantId).trim()) {
          return json(res, { error: 'participantId is required' }, 400);
        }
        const session = await createSession(dataRoot, {
          participantId: String(body.participantId).trim(),
          language: body.language === 'zh' ? 'zh' : 'en'
        });
        return json(res, {
          sessionId: session.sessionId,
          participantId: session.participantId,
          language: session.language,
          createdAt: session.createdAt
        });
      }
      const finalizeMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/finalize$/);
      if (req.method === 'POST' && finalizeMatch) {
        const body = await readJsonBody(req);
        const summary = await finalizeSession(dataRoot, {
          ...body,
          sessionId: decodeURIComponent(finalizeMatch[1])
        });
        return json(res, { ok: true, summary });
      }

      return serveStatic(publicDir, url.pathname, res);
    } catch (error) {
      console.error(error);
      return json(res, { error: error.message }, 500);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAppServer().listen(PORT, () => {
    console.log(`rPPG x Polar H10 validation app: http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_ROOT}`);
  });
}

async function serveStatic(publicDir, requestPath, res) {
  const safePath = decodeURIComponent(requestPath).replace(/^\/+/, '') || 'index.html';
  const fullPath = path.normalize(path.join(publicDir, safePath));
  if (!fullPath.startsWith(publicDir)) {
    return text(res, 'Forbidden', 403);
  }
  const fileStat = await stat(fullPath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    return text(res, 'Not found', 404);
  }
  const ext = path.extname(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  createReadStream(fullPath).pipe(res);
}

function json(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function text(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(payload);
}
