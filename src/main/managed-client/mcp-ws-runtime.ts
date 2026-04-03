import { randomUUID } from 'node:crypto';
import tls from 'node:tls';
import type { ClientOptions as WebSocketClientOptions } from 'ws';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SessionManager } from '../session/manager';
import { auditLogger } from '../audit/logger';
import { emitServerEvent } from '../server';
import { createMcpServer } from '../mcp/server';
import type { ManagedClientRuntimeConfig } from './types';
import { getBuiltInToolsSecurityConfig } from './config';
import { ManagedClientMcpToolRegistry } from './mcp-tool-registry';
import { createManagedClientDefenseLayer } from './tool-defense';
import { prepareManagedClientWorkspace } from './workspace';
import { getManagedClientToolResultMode } from '../builtin-tools/types';

type DesktopWsMessage = Record<string, unknown>;
const HANDSHAKE_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stringifyForAudit(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > 10_000 ? `${text.slice(0, 10_000)}...` : text;
  } catch {
    return String(value);
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeManagedClientToken(token: string | null | undefined): string | null {
  const trimmed = token?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/^Bearer\s+/i, '').trim();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

function getWebSocketTlsSocket(socket: WebSocket): tls.TLSSocket | null {
  const candidate = (socket as WebSocket & { _socket?: unknown })._socket;
  return candidate instanceof tls.TLSSocket ? candidate : null;
}

function buildTlsTrustLogPayload(wsUrl: string, servername: string, tlsSocket: tls.TLSSocket): Record<string, unknown> {
  const peerCertificate = tlsSocket.getPeerCertificate();
  const subject = peerCertificate && typeof peerCertificate === 'object' ? peerCertificate.subject : undefined;
  const issuer = peerCertificate && typeof peerCertificate === 'object' ? peerCertificate.issuer : undefined;

  return {
    wsUrl,
    servername,
    authorized: tlsSocket.authorized,
    authorizationError: tlsSocket.authorizationError ?? null,
    subject,
    issuer,
    validFrom: peerCertificate?.valid_from ?? null,
    validTo: peerCertificate?.valid_to ?? null,
  };
}

function getManagedClientTlsConnectionOptions(
  wsUrl: string,
  config: Pick<ManagedClientRuntimeConfig, 'tlsServername'>,
): tls.ConnectionOptions | undefined {
  const url = new URL(wsUrl);
  if (url.protocol !== 'wss:') {
    return undefined;
  }

  const servername = config.tlsServername?.trim() || url.hostname;

  return {
    rejectUnauthorized: true,
    servername,
    checkServerIdentity: (_hostname: string, peerCertificate: tls.PeerCertificate) => {
      return tls.checkServerIdentity(servername, peerCertificate);
    },
  };
}

function getManagedClientTlsOptions(
  wsUrl: string,
  config: Pick<ManagedClientRuntimeConfig, 'tlsServername'>,
): (WebSocketClientOptions & tls.ConnectionOptions) | undefined {
  const tlsOptions = getManagedClientTlsConnectionOptions(wsUrl, config);
  if (!tlsOptions) {
    return undefined;
  }

  return tlsOptions as WebSocketClientOptions & tls.ConnectionOptions;
}

function getDesktopWebSocketUrl(baseUrl: string, token: string | null): string {
  const url = new URL(baseUrl);
  const isLoopback = isLoopbackHostname(url.hostname);

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (!isLoopback && url.protocol !== 'https:') {
      throw new Error(`Managed MCP websocket mode requires https:// for non-localhost base URLs: ${baseUrl}`);
    }

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  } else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Managed MCP websocket mode requires http(s) or ws(s) base URL, received ${url.protocol}`);
  }

  if (!isLoopback && url.protocol !== 'wss:') {
    throw new Error(`Managed MCP websocket mode requires wss:// for non-localhost base URLs: ${baseUrl}`);
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (!normalizedPath || normalizedPath === '/') {
    url.pathname = '/api/mcphub/ws';
  } else if (!normalizedPath.endsWith('/mcphub/ws') && !normalizedPath.endsWith('/desktop/ws')) {
    url.pathname = `${normalizedPath}/mcphub/ws`;
  } else {
    url.pathname = normalizedPath;
  }

  url.hash = '';
  if (token) {
    url.searchParams.set('access_token', token);
  } else {
    url.searchParams.delete('access_token');
  }

  return url.toString();
}

export async function validateManagedClientTlsConfig(config: Pick<ManagedClientRuntimeConfig, 'baseUrl' | 'tlsServername'>): Promise<{
  valid: boolean;
  skipped: boolean;
  wsUrl: string;
  servername: string | null;
  message: string;
}> {
  if (!config.baseUrl?.trim()) {
    throw new Error('MANAGED_CLIENT_BASE_URL is required');
  }

  const wsUrl = getDesktopWebSocketUrl(config.baseUrl, null);
  const url = new URL(wsUrl);
  const servername = config.tlsServername?.trim() || url.hostname;

  if (isLoopbackHostname(url.hostname) || url.protocol !== 'wss:') {
    return {
      valid: true,
      skipped: true,
      wsUrl,
      servername,
      message: 'Loopback base URL skips TLS validation.',
    };
  }

  const tlsOptions = getManagedClientTlsConnectionOptions(wsUrl, config);
  if (!tlsOptions) {
    throw new Error(`Managed MCP websocket TLS validation requires a wss:// endpoint: ${wsUrl}`);
  }

  await new Promise<void>((resolve, reject) => {
    const socket = tls.connect({
      host: url.hostname,
      port: url.port ? Number(url.port) : 443,
      ...tlsOptions,
    });

    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };

    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => {
      finish(() => reject(new Error(`Timed out validating TLS for ${url.hostname}`)));
    });
    socket.once('secureConnect', () => finish(resolve));
    socket.once('error', (error) => finish(() => reject(error)));
  });

  return {
    valid: true,
    skipped: false,
    wsUrl,
    servername,
    message: `TLS validation succeeded for ${servername}`,
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenToolResult(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const textParts: string[] = [];

  for (const item of content) {
    if (!isJsonObject(item)) {
      continue;
    }

    if (item.type === 'text' && typeof item.text === 'string') {
      textParts.push(item.text);
      continue;
    }

    textParts.push(JSON.stringify(item, null, 2));
  }

  if (textParts.length > 0) {
    return textParts.join('\n');
  }

  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent, null, 2);
  }

  return '(no output)';
}

function parseStructuredToolResult(result: Record<string, unknown>): Record<string, unknown> | null {
  if (isJsonObject(result.structuredContent)) {
    return result.structuredContent;
  }

  const text = flattenToolResult(result);
  if (!text || text === '(no output)') {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildMinimalToolSuccessPayload(
  toolName: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const parsedResult = parseStructuredToolResult(result);

  if (toolName === 'session_create' && parsedResult) {
    return {
      success: true,
      sessionId: typeof parsedResult.sessionId === 'string' ? parsedResult.sessionId : null,
      pid: typeof parsedResult.pid === 'number' ? parsedResult.pid : null,
      state: typeof parsedResult.state === 'string' ? parsedResult.state : null,
    };
  }

  if (toolName === 'session_wait' && parsedResult) {
    return {
      success: true,
      triggered: typeof parsedResult.triggered === 'string' ? parsedResult.triggered : null,
      state: typeof parsedResult.state === 'string' ? parsedResult.state : null,
      exitCode: typeof parsedResult.exitCode === 'number' || parsedResult.exitCode === null ? parsedResult.exitCode : null,
      stdoutLength: typeof parsedResult.stdoutLength === 'number' ? parsedResult.stdoutLength : null,
      stderrLength: typeof parsedResult.stderrLength === 'number' ? parsedResult.stderrLength : null,
    };
  }

  return { success: true };
}

export class ManagedClientMcpWsRuntime {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private socket: WebSocket | null = null;
  private readonly defenseLayer;
  private pullStatus: 'idle' | 'waiting' | 'task-assigned' | 'task-completed' | 'task-failed' = 'idle';
  private pulledTaskCount = 0;
  private emptyPollCount = 0;
  private lastPollStatus: number | null = null;
  private lastTaskCommand: string | null = null;
  private lastPolledAt: string | null = null;
  private receivedEventCount = 0;
  private pingCount = 0;
  private pongSentCount = 0;
  private lastEventAt: string | null = null;
  private lastEventName: string | null = null;
  private lastPingAt: string | null = null;
  private connectionId: string | null = null;
  private toolRegistry: ManagedClientMcpToolRegistry | null = null;
  private localClient: Client | null = null;
  private activeConnectionSignal: AbortSignal | null = null;

  constructor(
    private readonly config: ManagedClientRuntimeConfig,
    private readonly sessionManager: SessionManager,
  ) {
    this.defenseLayer = createManagedClientDefenseLayer(config);
  }

  start(): void {
    if (!this.config.enabled || this.running) {
      return;
    }

    if (!this.config.baseUrl) {
      throw new Error('Managed MCP websocket mode requires MANAGED_CLIENT_BASE_URL');
    }

    this.running = true;
    this.abortController = new AbortController();
    this.loopPromise = this.runLoop(this.abortController.signal)
      .catch((error) => {
        const message = toErrorMessage(error);
        this.running = false;
        this.pullStatus = 'task-failed';
        this.appendAuditEntry('[managed-client-mcp-ws] startup failed', '', 1, message);
        emitServerEvent('managed-client-mcp-ws:error', { message });
      })
      .finally(() => {
        this.loopPromise = null;
      });
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }

  async stopAndWait(): Promise<void> {
    this.stop();
    await this.loopPromise?.catch(() => undefined);
  }

  async updateMcpServers(mcpServers: ManagedClientRuntimeConfig['mcpServers']): Promise<{
    applied: boolean;
    toolCount: number;
    tools: string[];
    reason?: 'runtime-inactive' | 'bridge-not-ready';
  }> {
    this.config.mcpServers = mcpServers;

    if (!this.running) {
      return {
        applied: false,
        toolCount: 0,
        tools: [],
        reason: 'runtime-inactive',
      };
    }

    if (!this.localClient) {
      return {
        applied: false,
        toolCount: 0,
        tools: [],
        reason: 'bridge-not-ready',
      };
    }

    const nextRegistry = await ManagedClientMcpToolRegistry.create({
      localClient: this.localClient,
      externalServerConfigs: mcpServers,
      version: this.config.version,
      logger: {
        info: (command, stdout) => this.appendAuditEntry(command, stdout, 0),
        error: (command, stdout, stderr) => this.appendAuditEntry(command, stdout, 1, stderr),
      },
    });

    const toolDefinitions = nextRegistry.getToolDefinitions();
    const toolNames = Object.keys(toolDefinitions);

    const socket = this.socket;
    const activeConnectionSignal = this.activeConnectionSignal;
    const connectionId = this.connectionId;
    const canPublishImmediately = socket
      && socket.readyState === WebSocket.OPEN
      && activeConnectionSignal
      && connectionId;

    if (canPublishImmediately) {
      await this.sendRequest(socket, activeConnectionSignal, 'update_tools', {
        reset: true,
        tools: toolDefinitions,
      });

      this.appendAuditEntry('[managed-client-mcp-ws] update_tools request (dynamic)', {
        connectionId,
        reset: true,
        toolCount: toolNames.length,
        tools: toolNames,
        note: 'Desktop-facing tool set re-published after config update.',
      }, 0);
      emitServerEvent('managed-client-mcp-ws:update-tools:request', {
        connectionId,
        reset: true,
        toolCount: toolNames.length,
        tools: toolNames,
      });
    }

    await this.toolRegistry?.close().catch(() => undefined);
    this.toolRegistry = nextRegistry;

    return canPublishImmediately
      ? {
        applied: true,
        toolCount: toolNames.length,
        tools: toolNames,
      }
      : {
        applied: false,
        toolCount: toolNames.length,
        tools: toolNames,
        reason: 'bridge-not-ready',
      };
  }

  getStatus(): {
    enabled: boolean;
    running: boolean;
    clientId: string | null;
    connectionId: string | null;
    baseUrl: string | null;
    pullStatus: 'idle' | 'waiting' | 'task-assigned' | 'task-completed' | 'task-failed';
    pulledTaskCount: number;
    emptyPollCount: number;
    lastPollStatus: number | null;
    lastTaskCommand: string | null;
    lastPolledAt: string | null;
    receivedEventCount: number;
    pingCount: number;
    pongSentCount: number;
    lastEventAt: string | null;
    lastEventName: string | null;
    lastPingAt: string | null;
  } {
    return {
      enabled: this.config.enabled,
      running: this.running,
      clientId: this.config.clientId,
      connectionId: this.connectionId,
      baseUrl: this.config.baseUrl,
      pullStatus: this.pullStatus,
      pulledTaskCount: this.pulledTaskCount,
      emptyPollCount: this.emptyPollCount,
      lastPollStatus: this.lastPollStatus,
      lastTaskCommand: this.lastTaskCommand,
      lastPolledAt: this.lastPolledAt,
      receivedEventCount: this.receivedEventCount,
      pingCount: this.pingCount,
      pongSentCount: this.pongSentCount,
      lastEventAt: this.lastEventAt,
      lastEventName: this.lastEventName,
      lastPingAt: this.lastPingAt,
    };
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    const token = normalizeManagedClientToken(this.config.token);
    const workspace = prepareManagedClientWorkspace(this.config.workspaceRoot);
    const wsUrl = getDesktopWebSocketUrl(this.config.baseUrl!, token);

    console.log('[managed-client-mcp-ws] Connecting to MCP Hub websocket', {
      baseUrl: this.config.baseUrl,
      wsUrl,
      hasAccessTokenQuery: Boolean(token),
      workspaceRoot: workspace.rootDir,
      workspaceCurrentDir: workspace.currentDir,
      workspaceArchiveDir: workspace.archiveDir,
      archivedPreviousRun: workspace.archivedRunDir,
    });

    this.appendAuditEntry('[managed-client-mcp-ws] runtime start', {
      baseUrl: this.config.baseUrl,
      wsUrl,
      hasAccessTokenQuery: Boolean(token),
      workspaceRoot: workspace.rootDir,
      workspaceCurrentDir: workspace.currentDir,
      workspaceArchiveDir: workspace.archiveDir,
      archivedPreviousRun: workspace.archivedRunDir,
      archiveWarning: workspace.archiveWarning,
      clientId: this.config.clientId,
      clientName: this.config.clientName,
      headless: this.config.headless,
    }, 0);
    emitServerEvent('managed-client-mcp-ws:starting', {
      baseUrl: this.config.baseUrl,
      wsUrl,
      hasAccessTokenQuery: Boolean(token),
      workspaceRoot: workspace.rootDir,
      workspaceCurrentDir: workspace.currentDir,
      workspaceArchiveDir: workspace.archiveDir,
      archivedPreviousRun: workspace.archivedRunDir,
      archiveWarning: workspace.archiveWarning,
      clientId: this.config.clientId,
      clientName: this.config.clientName,
      headless: this.config.headless,
    });

    if (workspace.archiveWarning) {
      this.appendAuditEntry('[managed-client-mcp-ws] workspace archive skipped', {
        workspaceRoot: workspace.rootDir,
        workspaceCurrentDir: workspace.currentDir,
        workspaceArchiveDir: workspace.archiveDir,
        warning: workspace.archiveWarning,
      }, 1, workspace.archiveWarning);
      emitServerEvent('managed-client-mcp-ws:workspace-archive-skipped', {
        workspaceRoot: workspace.rootDir,
        workspaceCurrentDir: workspace.currentDir,
        workspaceArchiveDir: workspace.archiveDir,
        warning: workspace.archiveWarning,
      });
    }

    while (!signal.aborted) {
      try {
        await this.connectOnce(wsUrl, signal, workspace);
        if (!signal.aborted) {
          this.emptyPollCount += 1;
          await sleep(this.config.retryDelayMs);
        }
      } catch (error) {
        if (signal.aborted) {
          break;
        }

        const message = toErrorMessage(error);
        this.pullStatus = 'task-failed';
        this.appendAuditEntry('[managed-client-mcp-ws] error', '', 1, message);
        emitServerEvent('managed-client-mcp-ws:error', { message });
        this.emptyPollCount += 1;
        await sleep(this.config.retryDelayMs);
      }
    }

    this.running = false;
    this.pullStatus = 'idle';
    this.appendAuditEntry('[managed-client-mcp-ws] runtime stopped', '', 0);
    emitServerEvent('managed-client-mcp-ws:stopped');
  }

  private async connectOnce(
    wsUrl: string,
    signal: AbortSignal,
    workspace: ReturnType<typeof prepareManagedClientWorkspace>,
  ): Promise<void> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(this.sessionManager, 'managed-client-mcp-ws', {
      defaultWorkingDirectory: workspace.currentDir,
      enforcedWorkingDirectoryRoot: workspace.rootDir,
      requireShellAllowlist: true,
      exposeManagedAdminTool: true,
    });
    const client = new Client({
      name: 'cli-server-managed-client-mcp-ws',
      version: this.config.version,
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    this.localClient = client;
    this.activeConnectionSignal = signal;
    this.toolRegistry = await ManagedClientMcpToolRegistry.create({
      localClient: client,
      externalServerConfigs: this.config.mcpServers,
      version: this.config.version,
      workspaceRoot: workspace.rootDir,
      defaultWorkingDirectory: workspace.currentDir,
      logger: {
        info: (command, stdout) => this.appendAuditEntry(command, stdout, 0),
        error: (command, stdout, stderr) => this.appendAuditEntry(command, stdout, 1, stderr),
      },
    });

    const socket = await this.openSocket(wsUrl, signal);
    this.socket = socket;

    try {
      await this.performHandshake(socket, signal);
      await this.readLoop(socket, signal);
    } finally {
      this.connectionId = null;
      this.socket = null;
      this.localClient = null;
      this.activeConnectionSignal = null;
      await this.toolRegistry?.close().catch(() => undefined);
      this.toolRegistry = null;
      this.lastPollStatus = null;
      this.lastPolledAt = new Date().toISOString();
      if (!signal.aborted) {
        this.pullStatus = 'idle';
        this.appendAuditEntry('[managed-client-mcp-ws] disconnected', { wsUrl }, 0);
        emitServerEvent('managed-client-mcp-ws:disconnected', { wsUrl });
      }

      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  }

  private async openSocket(wsUrl: string, signal: AbortSignal): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(wsUrl, getManagedClientTlsOptions(wsUrl, this.config));
      const servername = this.config.tlsServername?.trim() || new URL(wsUrl).hostname;
      const onAbort = () => {
        socket.close();
        reject(new Error('Managed MCP websocket connection aborted'));
      };

      signal.addEventListener('abort', onAbort, { once: true });

      socket.once('open', () => {
        signal.removeEventListener('abort', onAbort);
        this.lastPollStatus = 101;
        this.lastPolledAt = new Date().toISOString();
        const tlsSocket = getWebSocketTlsSocket(socket);
        if (tlsSocket) {
          const tlsTrustLog = buildTlsTrustLogPayload(wsUrl, servername, tlsSocket);
          console.log('[managed-client-mcp-ws] TLS trust status', tlsTrustLog);
          this.appendAuditEntry('[managed-client-mcp-ws] tls trust status', tlsTrustLog, tlsSocket.authorized ? 0 : 1);
        }
        this.appendAuditEntry('[managed-client-mcp-ws] socket open', { wsUrl }, 0);
        emitServerEvent('managed-client-mcp-ws:connected', { wsUrl });
        resolve(socket);
      });

      socket.once('error', (error) => {
        signal.removeEventListener('abort', onAbort);
        const tlsSocket = getWebSocketTlsSocket(socket);
        if (tlsSocket && tlsSocket.authorizationError) {
          const tlsTrustLog = buildTlsTrustLogPayload(wsUrl, servername, tlsSocket);
          console.log('[managed-client-mcp-ws] TLS trust status', tlsTrustLog);
          this.appendAuditEntry('[managed-client-mcp-ws] tls trust status', tlsTrustLog, 1, toErrorMessage(tlsSocket.authorizationError));
        }

        reject(error instanceof Error ? error : new Error(String(error)));
      });

      socket.once('close', (code, reason) => {
        signal.removeEventListener('abort', onAbort);
        if (socket.readyState !== WebSocket.OPEN) {
          reject(new Error(`Managed MCP websocket closed during connect (${code}): ${reason.toString('utf-8')}`));
        }
      });
    });
  }

  private async performHandshake(socket: WebSocket, signal: AbortSignal): Promise<void> {
    this.appendAuditEntry('[managed-client-mcp-ws] waiting for session_opened', {
      baseUrl: this.config.baseUrl,
      clientId: this.config.clientId,
      clientName: this.config.clientName,
    }, 0);
    emitServerEvent('managed-client-mcp-ws:waiting-for-session-opened', {
      clientId: this.config.clientId,
      clientName: this.config.clientName,
    });
    const openedMessage = await this.waitForEvent(socket, signal, 'session_opened', HANDSHAKE_TIMEOUT_MS);
    const openedPayload = isJsonObject(openedMessage.payload) ? openedMessage.payload : null;
    const connectionId = typeof openedPayload?.connection_id === 'string' ? openedPayload.connection_id : null;
    if (!connectionId) {
      throw new Error('Desktop websocket protocol did not provide connection_id in session_opened event');
    }

    this.connectionId = connectionId;
    this.pullStatus = 'waiting';
    this.lastPolledAt = new Date().toISOString();
    this.appendAuditEntry('[managed-client-mcp-ws] session opened', {
      connectionId: this.connectionId,
      clientId: this.config.clientId,
      clientName: this.config.clientName,
    }, 0);
    emitServerEvent('managed-client-mcp-ws:session-opened', {
      connectionId: this.connectionId,
      clientId: this.config.clientId,
      clientName: this.config.clientName,
    });

    this.appendAuditEntry('[managed-client-mcp-ws] register request', {
      connectionId: this.connectionId,
      clientId: this.config.clientId,
      clientName: this.config.clientName,
      note: 'Desktop capabilities are advertised in update_tools, not register.',
    }, 0);
    emitServerEvent('managed-client-mcp-ws:register:request', {
      connectionId: this.connectionId,
      clientId: this.config.clientId,
      clientName: this.config.clientName,
    });
    const registerResponse = await this.sendRequest(socket, signal, 'register', {
      client_id: this.config.clientId,
      client_name: this.config.clientName,
    });
    this.appendAuditEntry('[managed-client-mcp-ws] register response', {
      connectionId: this.connectionId,
      ok: registerResponse.ok === true,
      response: registerResponse,
    }, registerResponse.ok === true ? 0 : 1);
    emitServerEvent('managed-client-mcp-ws:register:response', {
      connectionId: this.connectionId,
      ok: registerResponse.ok === true,
    });
    if (!registerResponse.ok) {
      throw new Error(`Desktop websocket register failed: ${stringifyForAudit(registerResponse)}`);
    }

    const toolDefinitions = this.toolRegistry?.getToolDefinitions() ?? {};
    this.appendAuditEntry('[managed-client-mcp-ws] update_tools request', {
      connectionId: this.connectionId,
      reset: true,
      toolCount: Object.keys(toolDefinitions).length,
      tools: Object.keys(toolDefinitions),
      note: 'Desktop-facing tool set advertised to the server.',
    }, 0);
    emitServerEvent('managed-client-mcp-ws:update-tools:request', {
      connectionId: this.connectionId,
      reset: true,
      toolCount: Object.keys(toolDefinitions).length,
      tools: Object.keys(toolDefinitions),
    });
    const updateToolsResponse = await this.sendRequest(socket, signal, 'update_tools', {
      reset: true,
      tools: toolDefinitions,
    });
    this.appendAuditEntry('[managed-client-mcp-ws] update_tools response', {
      connectionId: this.connectionId,
      ok: updateToolsResponse.ok === true,
      response: updateToolsResponse,
    }, updateToolsResponse.ok === true ? 0 : 1);
    emitServerEvent('managed-client-mcp-ws:update-tools:response', {
      connectionId: this.connectionId,
      ok: updateToolsResponse.ok === true,
    });
    if (!updateToolsResponse.ok) {
      throw new Error(`Desktop websocket update_tools failed: ${stringifyForAudit(updateToolsResponse)}`);
    }

    this.appendAuditEntry('[managed-client-mcp-ws] tools published', {
      connectionId: this.connectionId,
      toolCount: Object.keys(toolDefinitions).length,
      tools: Object.keys(toolDefinitions),
    }, 0);
    emitServerEvent('managed-client-mcp-ws:tools-published', {
      connectionId: this.connectionId,
      toolCount: Object.keys(toolDefinitions).length,
      tools: Object.keys(toolDefinitions),
    });
  }

  private async readLoop(socket: WebSocket, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        resolve();
      };

      const onMessage = (raw: WebSocket.RawData) => {
        void this.handleRawMessage(socket, raw).catch((error) => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      };

      const onClose = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        socket.off('message', onMessage);
        socket.off('close', onClose);
        socket.off('error', onError);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      socket.on('message', onMessage);
      socket.once('close', onClose);
      socket.once('error', onError);
    });
  }

  private async handleRawMessage(socket: WebSocket, raw: WebSocket.RawData): Promise<void> {
    const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
    const message = JSON.parse(text) as DesktopWsMessage;

    if (message.type === 'event' && message.event === 'ping') {
      this.recordIncomingEvent('ping');
      this.lastPingAt = this.lastEventAt;
      await this.sendPong(socket);
      return;
    }

    if (message.type === 'event') {
      this.recordIncomingEvent(typeof message.event === 'string' ? message.event : 'unknown');
      return;
    }

    if (message.type === 'req') {
      const requestId = typeof message.id === 'string' ? message.id : randomUUID();
      const method = typeof message.method === 'string' ? message.method : '';
      const params = isJsonObject(message.params) ? message.params : {};

      if (method === 'tool_call') {
        await this.handleToolCall(socket, requestId, params);
        return;
      }

      await this.sendToolError(socket, requestId, 'unsupported_method', `Unknown request method: ${method || '(missing)'}`);
    }
  }

  private async handleToolCall(socket: WebSocket, requestId: string, payload: Record<string, unknown>): Promise<void> {
    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
    const argumentsPayload = isJsonObject(payload.arguments) ? payload.arguments : {};
    const binding = this.toolRegistry?.getToolBinding(toolName) ?? null;

    if (!toolName) {
      await this.sendToolError(socket, requestId, 'invalid_request', 'tool_call payload is missing tool_name');
      return;
    }

    if (!binding) {
      await this.sendToolError(socket, requestId, 'unknown_tool', `Unknown desktop tool: ${toolName}`);
      return;
    }

    const requestInspection = await this.defenseLayer.inspectToolCall({
      requestId,
      connectionId: this.connectionId,
      toolName,
      argumentsPayload,
      rawPayload: payload,
      binding,
      runtimeConfig: {
        baseUrl: this.config.baseUrl,
        clientId: this.config.clientId,
        clientName: this.config.clientName,
        mode: this.config.mode,
      },
    });

    if (!requestInspection.allowed) {
      const message = requestInspection.message ?? `Desktop tool call blocked by defense layer: ${toolName}`;
      this.pullStatus = 'task-failed';
      this.lastTaskCommand = toolName;
      this.lastPolledAt = new Date().toISOString();
      this.appendAuditEntry(`[managed-client-mcp-ws] tool_call blocked: ${toolName}`, {
        requestId,
        toolName,
        source: binding.source,
        sourceName: binding.sourceName,
        findings: requestInspection.findings,
      }, 1, message);
      emitServerEvent('managed-client-mcp-ws:task:blocked', {
        requestId,
        toolName,
        code: requestInspection.code ?? 'tool_call_blocked',
      });
      await this.sendToolError(socket, requestId, requestInspection.code ?? 'tool_call_blocked', message);
      return;
    }

    const effectiveArgumentsPayload = requestInspection.argumentsPayload;

    this.pullStatus = 'task-assigned';
    this.pulledTaskCount += 1;
    this.lastTaskCommand = toolName;
    this.lastPolledAt = new Date().toISOString();
    this.appendAuditEntry('[managed-client-mcp-ws] tool_call received', {
      requestId,
      toolName,
      arguments: effectiveArgumentsPayload,
      defenseFindings: requestInspection.findings,
    }, 0);
    emitServerEvent('managed-client-mcp-ws:task:started', { requestId, toolName });

    try {
      const { result } = await this.toolRegistry!.callTool(toolName, effectiveArgumentsPayload);
      const text = flattenToolResult(result);

      if (result.isError) {
        const rawMessage = text && text !== '(no output)' ? text : 'Tool execution failed';
        const responseInspection = await this.defenseLayer.inspectToolResponse({
          requestId,
          connectionId: this.connectionId,
          toolName,
          binding,
          success: false,
          responseText: rawMessage,
          responseMode: 'error',
          rawResult: result,
          runtimeConfig: {
            baseUrl: this.config.baseUrl,
            clientId: this.config.clientId,
            clientName: this.config.clientName,
            mode: this.config.mode,
          },
        });
        const message = responseInspection.allowed
          ? responseInspection.responseText
          : (responseInspection.message ?? `Desktop tool response blocked by defense layer: ${toolName}`);
        this.pullStatus = 'task-failed';
        this.lastTaskCommand = toolName;
        this.appendAuditEntry(`[managed-client-mcp-ws] tool_call failed: ${toolName}`, {
          requestId,
          toolName,
          source: binding.source,
          sourceName: binding.sourceName,
          result,
          defenseFindings: responseInspection.findings,
        }, 1, message);
        emitServerEvent('managed-client-mcp-ws:task:completed', {
          requestId,
          toolName,
          success: false,
        });
        await this.sendToolError(socket, requestId, responseInspection.allowed ? 'tool_execution_failed' : (responseInspection.code ?? 'tool_response_blocked'), message);
        return;
      }

      const permissionProfile = getBuiltInToolsSecurityConfig().permissionProfile;
      const resultMode = getManagedClientToolResultMode(permissionProfile, toolName, binding.source);
      const outboundResponseText = resultMode === 'full'
        ? (text && text !== '(no output)' ? text : '(no output)')
        : JSON.stringify(resultMode === 'handle'
          ? buildMinimalToolSuccessPayload(toolName, result)
          : { success: true });
      const responseInspection = await this.defenseLayer.inspectToolResponse({
        requestId,
        connectionId: this.connectionId,
        toolName,
        binding,
        success: true,
        responseText: outboundResponseText,
        responseMode: resultMode,
        rawResult: result,
        runtimeConfig: {
          baseUrl: this.config.baseUrl,
          clientId: this.config.clientId,
          clientName: this.config.clientName,
          mode: this.config.mode,
        },
      });

      if (!responseInspection.allowed) {
        const message = responseInspection.message ?? `Desktop tool response blocked by defense layer: ${toolName}`;
        this.pullStatus = 'task-failed';
        this.lastTaskCommand = toolName;
        this.appendAuditEntry(`[managed-client-mcp-ws] tool_call response blocked: ${toolName}`, {
          requestId,
          toolName,
          source: binding.source,
          sourceName: binding.sourceName,
          result,
          defenseFindings: responseInspection.findings,
        }, 1, message);
        emitServerEvent('managed-client-mcp-ws:task:completed', {
          requestId,
          toolName,
          success: false,
        });
        await this.sendToolError(socket, requestId, responseInspection.code ?? 'tool_response_blocked', message);
        return;
      }

      if (resultMode === 'full') {
        if (responseInspection.responseText && responseInspection.responseText !== '(no output)') {
          await this.sendToolResultChunk(socket, requestId, responseInspection.responseText, false);
        }
        await this.sendToolResultChunk(
          socket,
          requestId,
          responseInspection.responseText && responseInspection.responseText !== '(no output)' ? '\n[completed]' : '(no output)',
          true,
        );
      } else {
        await this.sendToolResultChunk(socket, requestId, responseInspection.responseText, true);
      }

      this.pullStatus = 'task-completed';
      this.lastTaskCommand = toolName;
      this.appendAuditEntry(`[managed-client-mcp-ws] tool_call completed: ${toolName}`, {
        requestId,
        toolName,
        source: binding.source,
        sourceName: binding.sourceName,
        result,
        defenseFindings: responseInspection.findings,
      }, 0);
      emitServerEvent('managed-client-mcp-ws:task:completed', {
        requestId,
        toolName,
        success: true,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      this.pullStatus = 'task-failed';
      this.appendAuditEntry(`[managed-client-mcp-ws] tool_call failed: ${toolName}`, {
        requestId,
        toolName,
      }, 1, message);
      emitServerEvent('managed-client-mcp-ws:task:completed', {
        requestId,
        toolName,
        success: false,
      });
      await this.sendToolError(socket, requestId, 'tool_execution_failed', message);
    }
  }

  private async waitForEvent(
    socket: WebSocket,
    signal: AbortSignal,
    expectedEvent: string,
    timeoutMs = 0,
  ): Promise<DesktopWsMessage> {
    return new Promise<DesktopWsMessage>((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;

      const onAbort = () => {
        cleanup();
        reject(new Error(`Aborted while waiting for ${expectedEvent}`));
      };

      const onMessage = (raw: WebSocket.RawData) => {
        try {
          const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
          const message = JSON.parse(text) as DesktopWsMessage;
          if (message.type === 'event' && message.event === expectedEvent) {
            this.recordIncomingEvent(expectedEvent);
            cleanup();
            resolve(message);
            return;
          }

          if (message.type === 'event' && message.event === 'ping') {
            this.recordIncomingEvent('ping');
            this.lastPingAt = this.lastEventAt;
            void this.sendPong(socket).catch(reject);
            return;
          }

          if (message.type === 'event') {
            this.recordIncomingEvent(typeof message.event === 'string' ? message.event : 'unknown');
          }

          this.appendAuditEntry(`[managed-client-mcp-ws] handshake message while waiting for ${expectedEvent}`, {
            message,
          }, 0);
          emitServerEvent('managed-client-mcp-ws:handshake-message', {
            expectedEvent,
            messageType: typeof message.type === 'string' ? message.type : null,
            event: typeof message.event === 'string' ? message.event : null,
            method: typeof message.method === 'string' ? message.method : null,
          });
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      const onClose = () => {
        cleanup();
        reject(new Error(`Connection closed while waiting for ${expectedEvent}`));
      };

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        signal.removeEventListener('abort', onAbort);
        socket.off('message', onMessage);
        socket.off('close', onClose);
      };

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          this.appendAuditEntry(`[managed-client-mcp-ws] timeout waiting for ${expectedEvent}`, {
            timeoutMs,
          }, 1);
          emitServerEvent('managed-client-mcp-ws:handshake-timeout', {
            expectedEvent,
            timeoutMs,
          });
          cleanup();
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${expectedEvent}`));
        }, timeoutMs);
      }

      signal.addEventListener('abort', onAbort, { once: true });
      socket.on('message', onMessage);
      socket.once('close', onClose);
    });
  }

  private async sendRequest(socket: WebSocket, signal: AbortSignal, method: string, params: Record<string, unknown>): Promise<DesktopWsMessage> {
    const requestId = `${method}-${randomUUID()}`;
    return new Promise<DesktopWsMessage>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(new Error(`Aborted while waiting for response to ${method}`));
      };

      const onMessage = (raw: WebSocket.RawData) => {
        try {
          const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
          const message = JSON.parse(text) as DesktopWsMessage;

          if (message.type === 'event' && message.event === 'ping') {
            this.recordIncomingEvent('ping');
            this.lastPingAt = this.lastEventAt;
            void this.sendPong(socket).catch((error) => {
              cleanup();
              reject(error instanceof Error ? error : new Error(String(error)));
            });
            return;
          }

          if (message.type === 'event') {
            this.recordIncomingEvent(typeof message.event === 'string' ? message.event : 'unknown');
          }

          if (message.type === 'res' && message.id === requestId) {
            cleanup();
            resolve(message);
          }
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      const onClose = () => {
        cleanup();
        reject(new Error(`Connection closed while waiting for response to ${method}`));
      };

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        socket.off('message', onMessage);
        socket.off('close', onClose);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      socket.on('message', onMessage);
      socket.once('close', onClose);

      void this.sendJson(socket, {
        type: 'req',
        id: requestId,
        method,
        params,
      }).catch((error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private async sendToolResultChunk(socket: WebSocket, requestId: string, text: string, isFinal: boolean): Promise<void> {
    await this.sendEvent(socket, 'tool_result_chunk', {
      request_id: requestId,
      data: { text },
      is_final: isFinal,
    });
  }

  private async sendToolError(socket: WebSocket, requestId: string, code: string, message: string): Promise<void> {
    await this.sendEvent(socket, 'tool_error', {
      request_id: requestId,
      error: {
        code,
        message,
        retryable: false,
      },
    });
  }

  private async sendEvent(socket: WebSocket, event: string, payload: Record<string, unknown>): Promise<void> {
    await this.sendJson(socket, {
      type: 'event',
      event,
      payload,
    });
  }

  private async sendPong(socket: WebSocket): Promise<void> {
    this.pongSentCount += 1;
    await this.sendEvent(socket, 'pong', {
      connection_id: this.connectionId,
    });
  }

  private recordIncomingEvent(eventName: string): void {
    this.receivedEventCount += 1;
    this.lastEventName = eventName;
    this.lastEventAt = new Date().toISOString();
    this.lastPolledAt = this.lastEventAt;
    if (eventName === 'ping') {
      this.pingCount += 1;
    }
  }

  private async sendJson(socket: WebSocket, payload: Record<string, unknown>): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      socket.send(JSON.stringify(payload), (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
  private appendAuditEntry(command: string, stdout: unknown, exitCode: number | null, stderr = ''): void {
    auditLogger.appendEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      command,
      cwd: this.config.baseUrl ?? '',
      exitCode,
      signal: null,
      stdout: stringifyForAudit(stdout),
      stderr,
      durationMs: 0,
      clientIp: 'managed-client-mcp-ws',
    });
  }
}
