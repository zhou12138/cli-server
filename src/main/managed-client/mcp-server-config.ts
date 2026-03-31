import type {
  ManagedClientExternalMcpServerConfig,
  ManagedClientExternalMcpHttpServerConfig,
  ManagedClientExternalMcpStdioServerConfig,
} from './types';
import {
  normalizeExternalMcpPermissionProfile,
  type BuiltInToolsPermissionProfile,
} from '../builtin-tools/types';

export interface ManagedClientFileMcpServerConfig {
  transport?: string;
  url?: string;
  timeout?: number;
  command?: string;
  args?: string[];
  tools?: string[];
  cwd?: string;
  env?: Record<string, string>;
  enabled?: boolean;
  toolPrefix?: string;
  requiredPermissionProfile?: BuiltInToolsPermissionProfile;
}

export function parseManagedClientMcpServers(
  mcpServers: Record<string, ManagedClientFileMcpServerConfig> | undefined,
): ManagedClientExternalMcpServerConfig[] {
  if (!mcpServers || typeof mcpServers !== 'object') {
    return [];
  }

  const servers: ManagedClientExternalMcpServerConfig[] = [];

  for (const [name, server] of Object.entries(mcpServers)) {
    if (!server || server.enabled === false) {
      continue;
    }

    const toolPrefix = typeof server.toolPrefix === 'string' && server.toolPrefix.trim()
      ? server.toolPrefix.trim()
      : undefined;
    const tools = Array.isArray(server.tools)
      ? server.tools.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : undefined;

    if (server.transport === 'http') {
      if (typeof server.url !== 'string' || !server.url.trim()) {
        continue;
      }

      servers.push({
        name,
        transport: 'http',
        url: server.url.trim(),
        timeout: typeof server.timeout === 'number' && server.timeout > 0 ? Math.floor(server.timeout) : undefined,
        toolPrefix,
        tools,
        requiredPermissionProfile: normalizeExternalMcpPermissionProfile(server.requiredPermissionProfile, 'http'),
      } satisfies ManagedClientExternalMcpHttpServerConfig);
      continue;
    }

    if (typeof server.command !== 'string' || !server.command.trim()) {
      continue;
    }

    servers.push({
      name,
      transport: 'stdio',
      command: server.command,
      args: Array.isArray(server.args) ? server.args.filter((value): value is string => typeof value === 'string') : [],
      cwd: typeof server.cwd === 'string' && server.cwd.trim() ? server.cwd : undefined,
      env: server.env && typeof server.env === 'object'
        ? Object.fromEntries(Object.entries(server.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : undefined,
      toolPrefix,
      tools,
      requiredPermissionProfile: normalizeExternalMcpPermissionProfile(server.requiredPermissionProfile, 'stdio'),
    } satisfies ManagedClientExternalMcpStdioServerConfig);
  }

  return servers;
}