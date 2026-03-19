import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
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

function createMcpServer(sessionManager: SessionManager, clientIp: string): McpServer {
  const server = new McpServer({
    name: 'cli-server',
    version: '0.1.0',
  });

  const sessionShell = os.platform() === 'win32' ? 'powershell' : 'sh';

  // ── Tool: session_create ──
  server.tool(
    'session_create',
    `Create a new session and run a shell command. Commands are executed via ${sessionShell} on ${os.platform()} (${os.arch()}). Use ${sessionShell} syntax for pipes, redirects, and quoting.`,
    {
      command: z.string().describe(`Shell command to execute (${sessionShell} syntax)`),
      cwd: z.string().optional().describe('Working directory'),
    },
    async ({ command, cwd }) => {
      try {
        const info = sessionManager.create(command, cwd, clientIp);
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
    'Kill a running session (kills entire process tree on Windows)',
    {
      sessionId: z.string().describe('Session ID'),
    },
    async ({ sessionId }) => {
      try {
        sessionManager.kill(sessionId);
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
    'Wait for a session to meet one of several conditions (OR semantics). Returns when the first condition is met. A safety timeout of 5 minutes is always applied.',
    {
      sessionId: z.string().describe('Session ID'),
      exited: z.boolean().optional().describe('Wait until the session exits'),
      timeoutMs: z.number().optional().describe('Max milliseconds to wait (default: 300000 = 5 min)'),
      idleMs: z.number().optional().describe('Trigger after no output for N ms'),
      tailLength: z.number().optional().describe('Include last N chars of stdout/stderr in result'),
    },
    async ({ sessionId, exited, timeoutMs, idleMs, tailLength }) => {
      if (!exited && !timeoutMs && !idleMs) {
        return error('At least one condition required (exited, timeoutMs, or idleMs)');
      }
      // Always enforce a max timeout to prevent indefinite waits
      const safeTimeout = Math.min(timeoutMs ?? 300_000, 300_000);
      try {
        const result = await sessionManager.wait(
          sessionId,
          { exited, timeout: safeTimeout, idle: idleMs },
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
          sessionShell,
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

// ── Mount MCP Streamable HTTP endpoint on Express ──

export function mountMcpEndpoints(
  app: Express,
  sessionManager: SessionManager,
): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // Existing session — reuse transport
      await transports.get(sessionId)!.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      const clientIp = req.socket.remoteAddress || 'unknown';
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      const server = createMcpServer(sessionManager, clientIp);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID' },
      id: null,
    });
  });

  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').send('Method Not Allowed');
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res);
      transports.delete(sessionId);
    } else {
      res.status(404).send('Session not found');
    }
  });
}
