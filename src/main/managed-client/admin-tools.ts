import { getBuiltInToolsSecurityConfig, getManagedClientMcpServersConfig, saveManagedClientMcpServersConfig } from './config';
import type { ManagedClientFileMcpServerConfig } from './mcp-server-config';

export interface ManagedMcpServerApplyResult {
  applied: boolean;
  toolCount: number;
  tools: string[];
  reason?: 'runtime-inactive' | 'bridge-not-ready';
}

export interface UpsertManagedMcpServerInput {
  name: string;
  transport: 'http' | 'stdio';
  enabled?: boolean;
  toolPrefix?: string;
  tools?: string[];
  url?: string;
  timeout?: number;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

let applyHook: (() => Promise<ManagedMcpServerApplyResult>) | null = null;

function trimOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeStringList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const next = values.map((value) => value.trim()).filter(Boolean);
  return next.length > 0 ? next : undefined;
}

function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env || typeof env !== 'object') {
    return undefined;
  }

  const next = Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key, value]) => key && typeof value === 'string'),
  );

  return Object.keys(next).length > 0 ? next : undefined;
}

function buildManagedMcpServerConfig(input: UpsertManagedMcpServerInput): ManagedClientFileMcpServerConfig {
  const securityConfig = getBuiltInToolsSecurityConfig().managedMcpServerAdmin;
  if (!securityConfig.enabled) {
    throw new Error('managed_mcp_server_upsert is disabled by built-in tool policy');
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error('Server name is required');
  }

  const common = {
    enabled: input.enabled ?? true,
    toolPrefix: trimOptionalString(input.toolPrefix),
    tools: sanitizeStringList(input.tools),
  } satisfies Pick<ManagedClientFileMcpServerConfig, 'enabled' | 'toolPrefix' | 'tools'>;

  if (input.transport === 'http') {
    if (!securityConfig.allowHttpServers) {
      throw new Error('HTTP MCP servers are disabled by built-in tool policy');
    }

    const url = trimOptionalString(input.url);
    if (!url) {
      throw new Error('HTTP MCP server URL is required');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('HTTP MCP server URL must be valid');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`HTTP MCP server URL must use http or https, received ${parsedUrl.protocol}`);
    }

    return {
      ...common,
      transport: 'http',
      url: parsedUrl.toString(),
      timeout: typeof input.timeout === 'number' && Number.isFinite(input.timeout) && input.timeout > 0
        ? Math.floor(input.timeout)
        : undefined,
    };
  }

  if (!securityConfig.allowStdioServers) {
    throw new Error('stdio MCP servers are disabled by built-in tool policy');
  }

  const command = trimOptionalString(input.command);
  if (!command) {
    throw new Error('stdio MCP server command is required');
  }

  return {
    ...common,
    transport: 'stdio',
    command,
    args: Array.isArray(input.args) ? input.args.filter((value) => typeof value === 'string') : [],
    cwd: trimOptionalString(input.cwd),
    env: sanitizeEnv(input.env),
  };
}

async function applyManagedMcpServerUpdate(): Promise<ManagedMcpServerApplyResult> {
  if (!applyHook) {
    return {
      applied: false,
      toolCount: 0,
      tools: [],
      reason: 'runtime-inactive',
    };
  }

  return applyHook();
}

export function registerManagedMcpServerApplyHook(
  hook: (() => Promise<ManagedMcpServerApplyResult>) | null,
): void {
  applyHook = hook;
}

export async function upsertManagedMcpServer(input: UpsertManagedMcpServerInput): Promise<{
  name: string;
  created: boolean;
  config: ManagedClientFileMcpServerConfig;
  applied: boolean;
  toolCount: number;
  tools: string[];
  reason?: 'runtime-inactive' | 'bridge-not-ready';
}> {
  const name = input.name.trim();
  const nextConfig = buildManagedMcpServerConfig(input);
  const current = getManagedClientMcpServersConfig();
  const created = !(name in current);

  saveManagedClientMcpServersConfig({
    ...current,
    [name]: nextConfig,
  });

  const applied = await applyManagedMcpServerUpdate();

  return {
    name,
    created,
    config: nextConfig,
    ...applied,
  };
}