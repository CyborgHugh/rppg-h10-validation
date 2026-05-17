import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJsonBody } from '../src/http.js';
import { json, serveSharedAlgorithm, serveStatic } from '../src/static-server.js';
import { createSession, finalizeSession } from './src/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_ROOT = path.join(__dirname, 'data');
const SHARED_DIR = path.join(__dirname, '..', 'shared');
const PORT = Number(process.env.PORT || 3000);

export function createAppServer({ publicDir = PUBLIC_DIR, dataRoot = DATA_ROOT, sharedDir = SHARED_DIR } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/shared/')) {
        return serveSharedAlgorithm(sharedDir, url.pathname, res);
      }
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
