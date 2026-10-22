/**
 * Care Circle — Web Server
 *
 * Serves the static web UI and REST API.
 * The API proxies all data operations through the MCP client.
 *
 * Start order:
 *   1. node dist/mcp/index.js   (MCP server on port 3001)
 *   2. node dist/server/index.js (Web server on port 3000)
 *
 * Or in single-command dev: npm run dev
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiRouter } from './routes.js';
import { pingMcpServer } from './mcpClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? '3000');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Serve static frontend files from src/web
// In production you'd serve from dist/web after a build step
const webDir = path.resolve(__dirname, '../../src/web');
app.use(express.static(webDir));

// API routes
app.use('/api', createApiRouter());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'care-circle-web', timestamp: new Date().toISOString() });
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(webDir, 'index.html'));
});

// Start server
const server = app.listen(PORT, '127.0.0.1', async () => {
  console.log(`[Web] Care Circle web app at http://localhost:${PORT}`);

  // Verify MCP server connectivity
  const mcpOk = await pingMcpServer();
  if (mcpOk) {
    console.log(`[Web] MCP server connected at http://127.0.0.1:${process.env.MCP_PORT ?? 3001}/mcp`);
  } else {
    console.warn(
      `[Web] ⚠️  MCP server not reachable at http://127.0.0.1:${process.env.MCP_PORT ?? 3001}\n` +
      `       Start the MCP server first with: npm run dev:mcp`
    );
  }
});

export { app, server };
