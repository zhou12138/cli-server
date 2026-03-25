import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ManagedClientRuntimeConfig } from './types';

interface ManagedClientFileConfig {
  bootstrapBaseUrl?: string;
  baseUrl?: string;
  token?: string;
  clientName?: string;
  pollWaitSeconds?: number;
  retryDelayMs?: number;
  enabled?: boolean;
}

function getManagedClientConfigPath(): string {
  return path.resolve(process.cwd(), 'managed-client.config.json');
}

export function loadManagedClientFileConfig(): ManagedClientFileConfig {
  const configPath = getManagedClientConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as ManagedClientFileConfig;
  return parsed ?? {};
}

export function saveManagedClientFileConfig(config: ManagedClientFileConfig): void {
  const current = loadManagedClientFileConfig();
  const next = {
    ...current,
    ...config,
  };

  fs.writeFileSync(getManagedClientConfigPath(), JSON.stringify(next, null, 2), 'utf-8');
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseNumberFlag(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getArgValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }

  return undefined;
}

function hasArg(args: string[], name: string): boolean {
  return args.includes(name);
}

export function getManagedClientRuntimeConfig(version: string, args = process.argv): ManagedClientRuntimeConfig {
  const fileConfig = loadManagedClientFileConfig();
  // Startup config resolution order: CLI args -> UI bootstrap value -> system environment -> default file fallback.
  const enabled =
    hasArg(args, '--enable-managed-client-runtime')
    || hasArg(args, '--managed-client-only')
    || parseBooleanFlag(process.env.ENABLE_MANAGED_CLIENT_RUNTIME)
    || fileConfig.enabled === true;

  const headless = hasArg(args, '--managed-client-only');
  const baseUrl =
    getArgValue(args, '--managed-client-base-url')
    ?? fileConfig.bootstrapBaseUrl
    ?? process.env.MANAGED_CLIENT_BASE_URL
    ?? fileConfig.baseUrl
    ?? null;
  const token = getArgValue(args, '--managed-client-token') ?? process.env.MANAGED_CLIENT_BEARER_TOKEN ?? fileConfig.token ?? null;
  const clientName = getArgValue(args, '--managed-client-name') ?? process.env.MANAGED_CLIENT_NAME ?? fileConfig.clientName ?? os.hostname();
  const pollWaitSeconds = parseNumberFlag(
    getArgValue(args, '--managed-client-wait-seconds') ?? process.env.MANAGED_CLIENT_WAIT_SECONDS ?? String(fileConfig.pollWaitSeconds ?? ''),
    20,
  );
  const retryDelayMs = parseNumberFlag(
    getArgValue(args, '--managed-client-retry-ms') ?? process.env.MANAGED_CLIENT_RETRY_MS ?? String(fileConfig.retryDelayMs ?? ''),
    3000,
  );

  return {
    enabled,
    headless,
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, '') : null,
    token,
    clientName,
    pollWaitSeconds,
    retryDelayMs,
    version,
    supportedCommands: ['run_command', 'read_file'],
  };
}