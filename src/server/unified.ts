/**
 * Care Circle — Unified Server (for deployment)
 *
 * Starts both the MCP server and web server on a single port.
 * The MCP endpoint is at /mcp, the web UI at /, and API at /api/*.
 *
 * This simplifies deployment to platforms like Render, Railway, or Fly.io
 * that support persistent Node.js processes with local SQLite storage.
 */
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiRouter } from './routes.js';
import { createMcpServer } from '../mcp/index.js';
import { seedDatabase } from '../db/seed.js';
import { getDb } from '../db/database.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? '3000');

async function startUnifiedServer() {
  // Seed DB with demo data on first run
  seedDatabase();

  const app = express();
  app.use(express.json());

  // ── MCP endpoint ─────────────────────────────────────────────────────────
  const mcpServer = createMcpServer();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.post('/mcp', async (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version');
    }

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('finish', () => { transport.close().catch(() => {}); });
    } catch (err) {
      console.error('[MCP] Request handling error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.options('/mcp', (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version');
      res.status(204).end();
    } else {
      res.status(403).end();
    }
  });

  // ── Web UI + API ──────────────────────────────────────────────────────────
  // Serve static frontend files
  const webDir = path.resolve(__dirname, '../../src/web');
  app.use(express.static(webDir));

  // API routes
  app.use('/api', createApiRouter());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'care-circle',
      mcp: 'connected',
      timestamp: new Date().toISOString(),
    });
  });

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });

  // ── Start ──────────────────────────────────────────────────────────────────
  const host = '0.0.0.0';
  app.listen(PORT, host, () => {
    console.log(`[Care Circle] Unified server running at http://${host}:${PORT}`);
    console.log(`[Care Circle] MCP endpoint: http://${host}:${PORT}/mcp`);
    console.log(`[Care Circle] Web UI: http://${host}:${PORT}`);
    console.log(`[Care Circle] Protocol: MCP Streamable HTTP (spec 2025-11-25)`);
  });
}

startUnifiedServer().catch(console.error);
