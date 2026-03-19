import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import type { Express, Request, Response } from 'express';
import * as os from 'node:os';
import type { SessionManager } from '../session/manager';

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function error(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true as const };
}

function createMcpServer(sessionManager: SessionManager): McpServer {
  const server = new McpServer({
    name: 'cli-server',
    version: '0.1.0',
  });

  // ── Tool: session_create ──
  server.tool(
    'session_create',
    'Create a new session and run a shell command',
    {
      command: z.string().describe('Shell command to execute'),
      cwd: z.string().optional().describe('Working directory'),
    },
    async ({ command, cwd }) => {
      try {
        const info = sessionManager.create(command, cwd);
        return json(info);
      } catch (err) {
        return error(String(err));
      }
    },
  );

  // ── Tool: session_stdin ──
  server.tool(
    'session_stdin',
    'Send stdin input to a running session',
    {
      sessionId: z.string().describe('Session ID'),
      data: z.string().describe('Data to write to stdin'),
    },
    async ({ sessionId, data }) => {
      try {
        sessionManager.writeStdin(sessionId, data);
        return json({ success: true });
      } catch (err) {
        return error(String(err));
      }
    },
  );

  // ── Tool: session_kill ──
  server.tool(
    'session_kill',
    'Kill a running session',
    {
      sessionId: z.string().describe('Session ID'),
      signal: z.string().optional().describe('Signal to send (default: SIGTERM)'),
    },
    async ({ sessionId, signal }) => {
      try {
        sessionManager.kill(sessionId, (signal as NodeJS.Signals) || 'SIGTERM');
        return json({ success: true });
      } catch (err) {
        return error(String(err));
      }
    },
  );

  // ── Tool: session_read_output ──
  server.tool(
    'session_read_output',
    'Read stdout or stderr output from a session with pagination',
    {
      sessionId: z.string().describe('Session ID'),
      stream: z.enum(['stdout', 'stderr']).describe('Which output stream to read'),
      offset: z.number().optional().describe('Character offset (default: 0)'),
      limit: z.number().optional().describe('Max characters to return (default: 4096)'),
    },
    async ({ sessionId, stream, offset, limit }) => {
      try {
        const result = sessionManager.readOutput(sessionId, stream, offset ?? 0, limit ?? 4096);
        return json(result);
      } catch (err) {
        return error(String(err));
      }
    },
  );

  // ── Tool: session_wait ──
  server.tool(
    'session_wait',
    'Wait for a session to meet one of several conditions (OR semantics). Returns when the first condition is met.',
    {
      sessionId: z.string().describe('Session ID'),
      exited: z.boolean().optional().describe('Wait until the session exits'),
      timeout: z.number().optional().describe('Max milliseconds to wait'),
      idle: z.number().optional().describe('Trigger after no output for N ms'),
      tailLength: z.number().optional().describe('Include last N chars of stdout/stderr in result'),
    },
    async ({ sessionId, exited, timeout, idle, tailLength }) => {
      if (!exited && !timeout && !idle) {
        return error('At least one condition required (exited, timeout, or idle)');
      }
      try {
        const result = await sessionManager.wait(
          sessionId,
          { exited, timeout, idle },
          tailLength ?? 0,
        );
        return json(result);
      } catch (err) {
        return error(String(err));
      }
    },
  );

  // ── Tool: session_list ──
  server.tool(
    'session_list',
    'List sessions with optional state filter and pagination',
    {
      state: z.enum(['running', 'exited', 'all']).optional().describe('Filter by state (default: all)'),
      offset: z.number().optional().describe('Pagination offset (default: 0)'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    async ({ state, offset, limit }) => {
      const result = sessionManager.list(state ?? 'all', offset ?? 0, limit ?? 20);
      return json(result);
    },
  );

  // ── Tool: session_info ──
  server.tool(
    'session_info',
    'Get detailed information about a specific session',
    {
      sessionId: z.string().describe('Session ID'),
    },
    async ({ sessionId }) => {
      try {
        const info = sessionManager.getInfo(sessionId);
        return json(info);
      } catch (err) {
        return error(String(err));
      }
    },
  );

  // ── Resource: machine info ──
  server.resource(
    'machine-info',
    'machine://info',
    {
      description: 'System information about the host machine',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'machine://info',
        mimeType: 'application/json',
        text: JSON.stringify({
          os: `${os.type()} ${os.release()}`,
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          homedir: os.homedir(),
          shell: process.env.SHELL || process.env.COMSPEC || '',
          uptime: os.uptime(),
          cpus: os.cpus().length,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
        }),
      }],
    }),
  );

  return server;
}

// ── Mount MCP SSE endpoints on Express ──

export function mountMcpEndpoints(
  app: Express,
  sessionManager: SessionManager,
): void {
  const transports = new Map<string, SSEServerTransport>();

  app.get('/mcp/sse', async (_req: Request, res: Response) => {
    const server = createMcpServer(sessionManager);
    const transport = new SSEServerTransport('/mcp/messages', res);
    transports.set(transport.sessionId, transport);

    res.on('close', () => {
      transports.delete(transport.sessionId);
    });

    await server.connect(transport);
  });

  app.post('/mcp/messages', async (req: Request, res: Response) => {
    const transportSessionId = req.query.sessionId as string;
    const transport = transports.get(transportSessionId);
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).json({ error: 'No transport found for sessionId' });
    }
  });
}
