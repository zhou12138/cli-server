import type { BuiltInToolsPermissionProfile } from '../builtin-tools/types';

export type ManagedClientMode = 'managed-client' | 'managed-client-mcp-ws';
export type ManagedClientExternalMcpTrustLevel = 'trusted' | 'internal-reviewed' | 'experimental' | 'blocked';

export interface ManagedClientExternalMcpServerBaseConfig {
  name: string;
  toolPrefix?: string;
  tools?: string[];
  requiredPermissionProfile: BuiltInToolsPermissionProfile;
  trustLevel: ManagedClientExternalMcpTrustLevel;
  publishedRemotely: boolean;
}

export interface ManagedClientExternalMcpHttpServerConfig extends ManagedClientExternalMcpServerBaseConfig {
  transport: 'http';
  url: string;
  timeout?: number;
}

export interface ManagedClientExternalMcpStdioServerConfig extends ManagedClientExternalMcpServerBaseConfig {
  transport: 'stdio';
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type ManagedClientExternalMcpServerConfig =
  | ManagedClientExternalMcpHttpServerConfig
  | ManagedClientExternalMcpStdioServerConfig;

export interface ManagedClientRegisterRequest {
  client_name: string;
  capabilities: {
    commands: string[];
  };
  metadata: {
    platform: NodeJS.Platform;
    version: string;
  };
}

export interface ManagedClientRecord {
  client_id: string;
  user_id: string;
  client_name: string;
  status: string;
  capabilities: {
    commands: string[];
  };
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string;
}

export interface ManagedClientTask {
  task_id: string;
  user_id: string;
  client_id: string;
  thread_id: string;
  agent_run_id: string;
  task_type: string;
  command_name: string;
  payload: Record<string, unknown>;
  status: string;
  result: unknown;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  timeout_seconds: number;
}

export interface ManagedClientCompletionRequest {
  client_id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ManagedClientTaskResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ManagedClientRuntimeConfig {
  mode: ManagedClientMode;
  enabled: boolean;
  headless: boolean;
  baseUrl: string | null;
  signinPageUrl: string | null;
  tlsServername: string | null;
  workspaceRoot: string;
  token: string | null;
  clientId: string;
  clientName: string;
  pollWaitSeconds: number;
  retryDelayMs: number;
  version: string;
  supportedCommands: string[];
  mcpServers: ManagedClientExternalMcpServerConfig[];
}