import http from 'node:http';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  appendVideoChunk,
  createCaptureSession,
  finalizeCaptureMetadata,
  finalizeCaptureVideo,
  listCaptureSessions,
  readCaptureManifest,
  saveReplayResult,
  sessionPath
} from '../src/capture-storage.js';
import { readJsonBody } from '../src/http.js';
import { json, serveSharedAlgorithm, serveStatic, text } from '../src/static-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_ROOT = path.join(__dirname, 'data');
const SHARED_DIR = path.join(__dirname, '..', 'shared');
const PORT = Number(process.env.PORT || 3000);

export function createCaptureAppServer({ publicDir = PUBLIC_DIR, dataRoot = DATA_ROOT, sharedDir = SHARED_DIR } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/shared/')) {
        return serveSharedAlgorithm(sharedDir, url.pathname, res);
      }
      if (url.pathname === '/api/health') {
        return json(res, { ok: true, workflow: 'raw-capture' });
      }
      if (req.method === 'GET' && url.pathname === '/api/capture/sessions') {
        return json(res, { sessions: await listCaptureSessions(dataRoot) });
      }
      if (req.method === 'POST' && url.pathname === '/api/capture/session') {
        const body = await readJsonBody(req);
        if (!body.participantId || !String(body.participantId).trim()) {
          return json(res, { error: 'participantId is required' }, 400);
        }
        const session = await createCaptureSession(dataRoot, {
          participantId: String(body.participantId).trim(),
          language: body.language === 'zh' ? 'zh' : 'en'
        });
        return json(res, {
          sessionId: session.sessionId,
          participantId: session.participantId,
          language: session.language,
          createdAt: session.createdAt,
          workflow: session.workflow
        });
      }

      const chunkMatch = url.pathname.match(/^\/api\/capture\/session\/([^/]+)\/video-chunk$/);
      if (req.method === 'POST' && chunkMatch) {
        const sessionId = decodeURIComponent(chunkMatch[1]);
        const chunk = await readBinaryBody(req, 64 * 1024 * 1024);
        const result = await appendVideoChunk(dataRoot, sessionId, chunk, {
          chunkIndex: Number(url.searchParams.get('chunkIndex')),
          mimeType: req.headers['content-type'] || 'video/webm'
        });
        return json(res, result);
      }

      const finalizeVideoMatch = url.pathname.match(/^\/api\/capture\/session\/([^/]+)\/finalize-video$/);
      if (req.method === 'POST' && finalizeVideoMatch) {
        const body = await readJsonBody(req);
        const result = await finalizeCaptureVideo(dataRoot, decodeURIComponent(finalizeVideoMatch[1]), body);
        return json(res, result);
      }

      const finalizeMetadataMatch = url.pathname.match(/^\/api\/capture\/session\/([^/]+)\/finalize-metadata$/);
      if (req.method === 'POST' && finalizeMetadataMatch) {
        const body = await readJsonBody(req);
        const result = await finalizeCaptureMetadata(dataRoot, {
          ...body,
          sessionId: decodeURIComponent(finalizeMetadataMatch[1])
        });
        return json(res, { ok: true, manifest: result });
      }

      const manifestMatch = url.pathname.match(/^\/api\/capture\/session\/([^/]+)\/manifest$/);
      if (req.method === 'GET' && manifestMatch) {
        const manifest = await readCaptureManifest(dataRoot, decodeURIComponent(manifestMatch[1]));
        if (!manifest) return json(res, { error: 'not found' }, 404);
        return json(res, manifest);
      }

      const videoMatch = url.pathname.match(/^\/api\/capture\/session\/([^/]+)\/video$/);
      if (req.method === 'GET' && videoMatch) {
        const videoPath = path.join(sessionPath(dataRoot, decodeURIComponent(videoMatch[1])), 'video.webm');
        res.writeHead(200, { 'Content-Type': 'video/webm' });
        return createReadStream(videoPath).pipe(res);
      }

      const dataFileMatch = url.pathname.match(/^\/api\/capture\/session\/([^/]+)\/(events|polar_hr_1hz|polar_rr|sync_markers)\.csv$/);
      if (req.method === 'GET' && dataFileMatch) {
        const filePath = path.join(sessionPath(dataRoot, decodeURIComponent(dataFileMatch[1])), `${dataFileMatch[2]}.csv`);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
        return createReadStream(filePath).pipe(res);
      }

      const replayMatch = url.pathname.match(/^\/api\/capture\/session\/([^/]+)\/replay$/);
      if (req.method === 'POST' && replayMatch) {
        const body = await readJsonBody(req);
        const result = await saveReplayResult(dataRoot, decodeURIComponent(replayMatch[1]), {
          ...body,
          sharedDir
        });
        return json(res, result);
      }

      return serveStatic(publicDir, url.pathname, res);
    } catch (error) {
      const status = error.message === 'invalid sessionId' ? 400 : 500;
      if (status >= 500) console.error(error);
      return json(res, { error: error.message }, status);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createCaptureAppServer().listen(PORT, () => {
    console.log(`Raw capture and replay app: http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_ROOT}`);
  });
}

function readBinaryBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
