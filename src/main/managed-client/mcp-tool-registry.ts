import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'node:path';
import type { ManagedClientExternalMcpServerConfig } from './types';
import { getExternalMcpRemotePublicationDecision, type ManagedClientExternalMcpPublicationBlockedReason } from './mcp-server-config';
import { getBuiltInToolsSecurityConfig } from './config';
import {
  getExternalMcpAccessDecision,
  isDesktopToolPublishedForPermissionProfile,
  type BuiltInToolsPermissionProfile,
  type ExternalMcpAccessBlockedReason,
} from '../builtin-tools/types';

const SESSION_DESKTOP_TOOL_NAMES = [
  'session_create',
  'session_stdin',
  'session_wait',
  'session_read_output',
] as const;

const ADVERTISED_DESKTOP_TOOL_NAMES = new Set([
  'shell_execute',
  'file_read',
  ...SESSION_DESKTOP_TOOL_NAMES,
]);

function getEnabledDesktopToolNames(): Set<string> {
  const config = getBuiltInToolsSecurityConfig();
  const enabledTools = new Set<string>();

  if (config.shellExecute.enabled && isDesktopToolPublishedForPermissionProfile(config.permissionProfile, 'shell_execute')) {
    enabledTools.add('shell_execute');
    for (const toolName of SESSION_DESKTOP_TOOL_NAMES.filter((toolName) => isDesktopToolPublishedForPermissionProfile(config.permissionProfile, toolName))) {
      enabledTools.add(toolName);
    }
  }

  if (config.fileRead.enabled && isDesktopToolPublishedForPermissionProfile(config.permissionProfile, 'file_read')) {
    enabledTools.add('file_read');
  }

  return enabledTools;
}

function filterExternalServersByPermissionProfile(
  serverConfigs: ManagedClientExternalMcpServerConfig[],
): ManagedClientExternalMcpServerConfig[] {
  const permissionProfile = getBuiltInToolsSecurityConfig().permissionProfile;
  return serverConfigs.filter((serverConfig) => getExternalMcpAccessDecision(
    permissionProfile,
    serverConfig.transport,
    serverConfig.requiredPermissionProfile,
  ).allowed);
}

function getExternalServerAccessDecision(
  permissionProfile: BuiltInToolsPermissionProfile,
  serverConfig: ManagedClientExternalMcpServerConfig,
): {
  allowed: boolean;
  requiredPermissionProfile: BuiltInToolsPermissionProfile;
  blockedReason?: ExternalMcpAccessBlockedReason;
} {
  return getExternalMcpAccessDecision(
    permissionProfile,
    serverConfig.transport,
    serverConfig.requiredPermissionProfile,
  );
}

export interface ToolBinding {
  advertisedName: string;
  upstreamName: string;
  description: string;
  inputSchema: unknown;
  client: Client;
  source: 'local' | 'external';
  sourceName: string;
}

export interface ManagedClientMcpServerConnectionTestResult {
  name: string;
  transport: 'http' | 'stdio';
  requiredPermissionProfile: BuiltInToolsPermissionProfile;
  success: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
  blockedReason?: ExternalMcpAccessBlockedReason | ManagedClientExternalMcpPublicationBlockedReason;
}

interface ConnectedExternalMcpServer {
  config: ManagedClientExternalMcpServerConfig;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

interface ToolRegistryLogger {
  info: (command: string, stdout: unknown) => void;
  error: (command: string, stdout: unknown, stderr: string) => void;
}

function pathMatchesRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootPath);
  const normalizedCandidate = process.platform === 'win32' ? resolvedCandidate.toLowerCase() : resolvedCandidate;
  const normalizedRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function resolveExternalServerWorkingDirectory(
  serverConfig: ManagedClientExternalMcpServerConfig,
  workspaceRoot?: string,
  defaultWorkingDirectory?: string,
): string | undefined {
  if (serverConfig.transport !== 'stdio') {
    return undefined;
  }

  const configuredCwd = serverConfig.cwd?.trim();
  if (!workspaceRoot) {
    return configuredCwd || defaultWorkingDirectory;
  }

  if (configuredCwd) {
    if (!pathMatchesRoot(configuredCwd, workspaceRoot)) {
      throw new Error(`STDIO MCP server cwd must stay inside managed workspace: ${serverConfig.name}`);
    }
    return configuredCwd;
  }

  return defaultWorkingDirectory ?? workspaceRoot;
}

function getAllowedTools(config: ManagedClientExternalMcpServerConfig): Set<string> | null {
  if (!config.tools || config.tools.length === 0) {
    return null;
  }

  if (config.tools.includes('*')) {
    return null;
  }

  return new Set(config.tools);
}

function filterToolsByConfig<T extends { name: string }>(
  config: ManagedClientExternalMcpServerConfig,
  tools: T[],
): T[] {
  const allowedTools = getAllowedTools(config);
  if (!allowedTools) {
    return tools;
  }

  return tools.filter((tool) => allowedTools.has(tool.name));
}

function shouldPublishExternalServerRemotely(serverConfig: ManagedClientExternalMcpServerConfig): {
  allowed: boolean;
  blockedReason?: ManagedClientExternalMcpPublicationBlockedReason;
} {
  return getExternalMcpRemotePublicationDecision(serverConfig);
}

function getExternalAdvertisedToolName(config: ManagedClientExternalMcpServerConfig, toolName: string): string {
  const prefix = (config.toolPrefix ?? config.name).trim();
  return `${prefix}.${toolName}`;
}

export class ManagedClientMcpToolRegistry {
  private readonly toolBindings = new Map<string, ToolBinding>();

  private constructor(
    private readonly localClient: Client,
    private readonly externalServers: ConnectedExternalMcpServer[],
  ) {}

  static async create(params: {
    localClient: Client;
    externalServerConfigs: ManagedClientExternalMcpServerConfig[];
    version: string;
    logger: ToolRegistryLogger;
    workspaceRoot?: string;
    defaultWorkingDirectory?: string;
  }): Promise<ManagedClientMcpToolRegistry> {
    const externalServers = await ManagedClientMcpToolRegistry.connectExternalMcpServers(
      filterExternalServersByPermissionProfile(params.externalServerConfigs),
      params.version,
      params.logger,
      params.workspaceRoot,
      params.defaultWorkingDirectory,
    );
    const registry = new ManagedClientMcpToolRegistry(params.localClient, externalServers);
    await registry.buildBindings();
    return registry;
  }

  static async testExternalServers(params: {
    externalServerConfigs: ManagedClientExternalMcpServerConfig[];
    version: string;
    workspaceRoot?: string;
    defaultWorkingDirectory?: string;
  }): Promise<ManagedClientMcpServerConnectionTestResult[]> {
    const results: ManagedClientMcpServerConnectionTestResult[] = [];
    const permissionProfile = getBuiltInToolsSecurityConfig().permissionProfile;

    for (const serverConfig of params.externalServerConfigs) {
      const accessDecision = getExternalServerAccessDecision(permissionProfile, serverConfig);
      if (!accessDecision.allowed) {
        results.push({
          name: serverConfig.name,
          transport: serverConfig.transport,
          requiredPermissionProfile: accessDecision.requiredPermissionProfile,
          success: false,
          toolCount: 0,
          tools: [],
          blockedReason: accessDecision.blockedReason,
          error: `Blocked by current permission profile: ${permissionProfile}`,
        });
        continue;
      }

      const client = new Client({
        name: `cli-server-managed-client-mcp-ws-test-${serverConfig.name}`,
        version: params.version,
      });
      const resolvedWorkingDirectory = resolveExternalServerWorkingDirectory(
        serverConfig,
        params.workspaceRoot,
        params.defaultWorkingDirectory,
      );
      const transport = serverConfig.transport === 'http'
        ? new StreamableHTTPClientTransport(new URL(serverConfig.url))
        : new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args,
          cwd: resolvedWorkingDirectory,
          env: serverConfig.env,
          stderr: 'pipe',
        });

      try {
        await client.connect(transport);
        const toolList = await client.listTools();
        const filteredTools = filterToolsByConfig(serverConfig, toolList.tools);
        results.push({
          name: serverConfig.name,
          transport: serverConfig.transport,
          requiredPermissionProfile: accessDecision.requiredPermissionProfile,
          success: true,
          toolCount: filteredTools.length,
          tools: filteredTools.map((tool) => tool.name),
        });
      } catch (error) {
        results.push({
          name: serverConfig.name,
          transport: serverConfig.transport,
          requiredPermissionProfile: accessDecision.requiredPermissionProfile,
          success: false,
          toolCount: 0,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    }

    return results;
  }

  async close(): Promise<void> {
    await Promise.all(this.externalServers.map(async (externalServer) => {
      await externalServer.client.close().catch(() => undefined);
      await externalServer.transport.close().catch(() => undefined);
    }));
    this.toolBindings.clear();
  }

  getToolDefinitions(): Record<string, unknown> {
    return Object.fromEntries(
      Array.from(this.toolBindings.values()).map((binding) => [binding.advertisedName, {
        name: binding.advertisedName,
        description: binding.source === 'external'
          ? `[${binding.sourceName}] ${binding.description}`
          : binding.description,
        input_schema: binding.inputSchema,
      }]),
    );
  }

  getToolBinding(toolName: string): ToolBinding | null {
    return this.toolBindings.get(toolName) ?? null;
  }

  async callTool(toolName: string, argumentsPayload: Record<string, unknown>) {
    const binding = this.toolBindings.get(toolName);
    if (!binding) {
      throw new Error(`Unknown desktop tool: ${toolName}`);
    }

    const result = await binding.client.callTool({
      name: binding.upstreamName,
      arguments: argumentsPayload,
    });

    return {
      binding,
      result,
    };
  }

  private async buildBindings(): Promise<void> {
    const localToolList = await this.localClient.listTools();
    const enabledDesktopToolNames = getEnabledDesktopToolNames();

    for (const tool of localToolList.tools) {
      if (!ADVERTISED_DESKTOP_TOOL_NAMES.has(tool.name)) {
        continue;
      }

      if (!enabledDesktopToolNames.has(tool.name)) {
        continue;
      }

      this.toolBindings.set(tool.name, {
        advertisedName: tool.name,
        upstreamName: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
        client: this.localClient,
        source: 'local',
        sourceName: 'local',
      });
    }

    for (const externalServer of this.externalServers) {
      const publicationDecision = shouldPublishExternalServerRemotely(externalServer.config);
      if (!publicationDecision.allowed) {
        continue;
      }

      const toolList = await externalServer.client.listTools();
      const filteredTools = filterToolsByConfig(externalServer.config, toolList.tools);
      for (const tool of filteredTools) {
        const advertisedName = getExternalAdvertisedToolName(externalServer.config, tool.name);
        this.toolBindings.set(advertisedName, {
          advertisedName,
          upstreamName: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema,
          client: externalServer.client,
          source: 'external',
          sourceName: externalServer.config.name,
        });
      }
    }
  }

  private static async connectExternalMcpServers(
    serverConfigs: ManagedClientExternalMcpServerConfig[],
    version: string,
    logger: ToolRegistryLogger,
    workspaceRoot?: string,
    defaultWorkingDirectory?: string,
  ): Promise<ConnectedExternalMcpServer[]> {
    if (serverConfigs.length === 0) {
      return [];
    }

    const connected: ConnectedExternalMcpServer[] = [];

    for (const serverConfig of serverConfigs) {
      const client = new Client({
        name: `cli-server-managed-client-mcp-ws-${serverConfig.name}`,
        version,
      });
      const resolvedWorkingDirectory = resolveExternalServerWorkingDirectory(
        serverConfig,
        workspaceRoot,
        defaultWorkingDirectory,
      );
      const transport = serverConfig.transport === 'http'
        ? new StreamableHTTPClientTransport(new URL(serverConfig.url))
        : new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args,
          cwd: resolvedWorkingDirectory,
          env: serverConfig.env,
          stderr: 'pipe',
        });

      try {
        await client.connect(transport);
        connected.push({
          config: serverConfig,
          client,
          transport,
        });
        logger.info('[managed-client-mcp-ws] external mcp server connected', {
          name: serverConfig.name,
          transport: serverConfig.transport,
          publishedRemotely: serverConfig.publishedRemotely,
          trustLevel: serverConfig.trustLevel,
          command: serverConfig.transport === 'stdio' ? serverConfig.command : undefined,
          args: serverConfig.transport === 'stdio' ? serverConfig.args : undefined,
          cwd: serverConfig.transport === 'stdio' ? resolvedWorkingDirectory : undefined,
          tools: serverConfig.tools,
          url: serverConfig.transport === 'http' ? serverConfig.url : undefined,
        });
      } catch (error) {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
        logger.error('[managed-client-mcp-ws] external mcp server failed', {
          name: serverConfig.name,
          transport: serverConfig.transport,
          publishedRemotely: serverConfig.publishedRemotely,
          trustLevel: serverConfig.trustLevel,
          command: serverConfig.transport === 'stdio' ? serverConfig.command : undefined,
          args: serverConfig.transport === 'stdio' ? serverConfig.args : undefined,
          cwd: serverConfig.transport === 'stdio' ? resolvedWorkingDirectory : undefined,
          tools: serverConfig.tools,
          url: serverConfig.transport === 'http' ? serverConfig.url : undefined,
        }, error instanceof Error ? error.message : String(error));
      }
    }

    return connected;
  }
}