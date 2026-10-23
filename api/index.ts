/**
 * Vercel Serverless Function entry point.
 *
 * Vercel's @vercel/node runtime detects an Express app exported from
 * this file in the /api directory and runs it as a serverless function.
 * All routes (/mcp, /api/*, /health, static files) are handled by the
 * unified Express app.
 */
import express, { type Request, type Response } from 'express';
import path from 'path';
import { createApiRouter } from '../src/server/routes.js';
import { createMcpServer } from '../src/mcp/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Initialise DB and seed on cold start (runs once per function instance)
let _initialised = false;
async function ensureInitialised() {
  if (_initialised) return;
  await seedDatabase();
  _initialised = true;
}

const app = express();
app.use(express.json());

const mcpServer = createMcpServer();

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── MCP endpoint ─────────────────────────────────────────────────────────────
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
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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

// ── Web UI + API ──────────────────────────────────────────────────────────────
// Serve static frontend files — use process.cwd() so it works on Vercel
// (Lambda runs from project root) and locally (cwd is project root)
const webDir = path.resolve(process.cwd(), 'src', 'web');
app.use(express.static(webDir));

// API routes
app.use('/api', createApiRouter());

// Health check
app.get('/health', async (_req, res) => {
  await ensureInitialised();
  res.json({
    status: 'ok',
    service: 'care-circle',
    mcp: 'connected',
    timestamp: new Date().toISOString(),
  });
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(webDir, 'index.html'));
});

// Initialise on cold start
ensureInitialised().catch(console.error);

export default app;
