import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ManagedClientFileMcpServerConfig } from '../../main/managed-client/mcp-server-config';
import {
  DEFAULT_BUILT_IN_TOOLS_PERMISSION_PROFILE,
  getDefaultExternalMcpPermissionProfile,
  getExternalMcpAccessDecision,
  type BuiltInToolsPermissionProfile,
  type BuiltInToolsSecurityConfig,
} from '../../main/builtin-tools/types';

type ConfigMode = 'form' | 'json';
type TransportType = 'http' | 'stdio';

interface SingleServerJsonConfig extends ManagedClientFileMcpServerConfig {
  name?: string;
}

interface EditableMcpServer {
  id: string;
  createdOrder: number;
  persistedName: string | null;
  name: string;
  transport: TransportType;
  enabled: boolean;
  url: string;
  timeout: string;
  command: string;
  argsText: string;
  toolsText: string;
  cwd: string;
  envText: string;
  toolPrefix: string;
  requiredPermissionProfile: BuiltInToolsPermissionProfile;
  editorMode: ConfigMode;
  jsonDraft: string;
  jsonTouched: boolean;
  collapsed: boolean;
}

interface McpTestResult {
  name: string;
  transport: TransportType;
  requiredPermissionProfile: BuiltInToolsPermissionProfile;
  success: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
  blockedReason?: 'profile-too-low' | 'transport-blocked';
}

const PERMISSION_PROFILE_OPTIONS: BuiltInToolsPermissionProfile[] = ['command-only', 'interactive-trusted', 'full-local-admin'];

function parseEnvText(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid env line: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    if (!key) {
      throw new Error(`Invalid env line: ${line}`);
    }
    env[key] = value;
  }

  return Object.keys(env).length ? env : undefined;
}

function serializeEnv(env?: Record<string, string>): string {
  if (!env) {
    return '';
  }

  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function formatSingleServerJson(server: EditableMcpServer, config: ManagedClientFileMcpServerConfig): string {
  return JSON.stringify({
    name: server.name,
    ...config,
  } satisfies SingleServerJsonConfig, null, 2);
}

function buildDraftSingleServerConfig(server: EditableMcpServer): ManagedClientFileMcpServerConfig {
  const toolPrefix = server.toolPrefix.trim() || undefined;
  const tools = server.toolsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (server.transport === 'http') {
    const timeoutValue = server.timeout.trim();
    const parsedTimeout = timeoutValue ? Number(timeoutValue) : undefined;

    return {
      transport: 'http',
      url: server.url.trim() || undefined,
      timeout: parsedTimeout !== undefined && Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : undefined,
      enabled: server.enabled,
      toolPrefix,
      tools: tools.length > 0 ? tools : undefined,
      requiredPermissionProfile: server.requiredPermissionProfile,
    };
  }

  return {
    transport: 'stdio',
    command: server.command.trim() || undefined,
    args: server.argsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    tools: tools.length > 0 ? tools : undefined,
    cwd: server.cwd.trim() || undefined,
    env: (() => {
      try {
        return parseEnvText(server.envText);
      } catch {
        return undefined;
      }
    })(),
    enabled: server.enabled,
    toolPrefix,
    requiredPermissionProfile: server.requiredPermissionProfile,
  };
}

function parseSingleServerJson(text: string): SingleServerJsonConfig {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON root must be an object');
  }

  return parsed as SingleServerJsonConfig;
}

function toEditableMcpServer(
  name: string,
  config: ManagedClientFileMcpServerConfig,
  index: number,
  createdOrder = index + 1,
): EditableMcpServer {
  const draftConfig = {
    transport: config.transport === 'http' ? 'http' : 'stdio',
    ...config,
  } satisfies ManagedClientFileMcpServerConfig;

  return {
    id: `mcp-loaded-${index}-${name}`,
    createdOrder,
    persistedName: name,
    name,
    transport: config.transport === 'http' ? 'http' : 'stdio',
    enabled: config.enabled !== false,
    url: config.url ?? '',
    timeout: typeof config.timeout === 'number' ? String(config.timeout) : '30000',
    command: config.command ?? '',
    argsText: Array.isArray(config.args) ? config.args.join('\n') : '',
    toolsText: Array.isArray(config.tools) ? config.tools.join('\n') : '*',
    cwd: config.cwd ?? '',
    envText: serializeEnv(config.env),
    toolPrefix: config.toolPrefix ?? '',
    requiredPermissionProfile: config.requiredPermissionProfile ?? getDefaultExternalMcpPermissionProfile(config.transport === 'http' ? 'http' : 'stdio'),
    editorMode: 'form',
    jsonDraft: '',
    jsonTouched: false,
    collapsed: false,
  };
}

function sortServersByCreatedOrder(servers: EditableMcpServer[]): EditableMcpServer[] {
  return [...servers].sort((left, right) => right.createdOrder - left.createdOrder);
}

function applyConfigToEditableServer(
  server: EditableMcpServer,
  config: SingleServerJsonConfig,
): EditableMcpServer {
  return {
    ...server,
    name: typeof config.name === 'string' && config.name.trim() ? config.name : server.name,
    transport: config.transport === 'http' ? 'http' : 'stdio',
    enabled: config.enabled !== false,
    url: config.url ?? '',
    timeout: typeof config.timeout === 'number' ? String(config.timeout) : '30000',
    command: config.command ?? '',
    argsText: Array.isArray(config.args) ? config.args.join('\n') : '',
    toolsText: Array.isArray(config.tools) ? config.tools.join('\n') : '*',
    cwd: config.cwd ?? '',
    envText: serializeEnv(config.env),
    toolPrefix: config.toolPrefix ?? '',
    requiredPermissionProfile: config.requiredPermissionProfile ?? getDefaultExternalMcpPermissionProfile(config.transport === 'http' ? 'http' : 'stdio'),
  };
}

function createEditableServer(index: number): EditableMcpServer {
  return toEditableMcpServer(
    `server-${index}`,
    {
      transport: 'http',
      enabled: true,
      timeout: 30000,
      tools: ['*'],
      requiredPermissionProfile: getDefaultExternalMcpPermissionProfile('http'),
    },
    index,
  );
}

function buildSingleServerConfig(server: EditableMcpServer): ManagedClientFileMcpServerConfig {
  const toolPrefix = server.toolPrefix.trim() || undefined;
  const tools = server.toolsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (server.transport === 'http') {
    const url = server.url.trim();
    if (!url) {
      throw new Error(`HTTP server URL is required: ${server.name.trim() || server.id}`);
    }

    const timeout = server.timeout.trim() ? Number(server.timeout.trim()) : undefined;
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      throw new Error(`Invalid timeout: ${server.name.trim() || server.id}`);
    }

    return {
      transport: 'http',
      url,
      timeout,
      enabled: server.enabled,
      toolPrefix,
      tools: tools.length > 0 ? tools : undefined,
      requiredPermissionProfile: server.requiredPermissionProfile,
    };
  }

  const command = server.command.trim();
  if (!command) {
    throw new Error(`STDIO command is required: ${server.name.trim() || server.id}`);
  }

  return {
    transport: 'stdio',
    command,
    args: server.argsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    tools: tools.length > 0 ? tools : undefined,
    cwd: server.cwd.trim() || undefined,
    env: parseEnvText(server.envText),
    enabled: server.enabled,
    toolPrefix,
    requiredPermissionProfile: server.requiredPermissionProfile,
  };
}

function buildServerEntry(server: EditableMcpServer): [string, ManagedClientFileMcpServerConfig] {
  let name = server.name.trim();
  let config: ManagedClientFileMcpServerConfig;

  if (server.editorMode === 'json') {
    const parsed = parseSingleServerJson(server.jsonDraft);
    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      name = parsed.name.trim();
    }
    config = {
      transport: parsed.transport,
      url: parsed.url,
      timeout: parsed.timeout,
      command: parsed.command,
      args: parsed.args,
      tools: parsed.tools,
      cwd: parsed.cwd,
      env: parsed.env,
      enabled: parsed.enabled,
      toolPrefix: parsed.toolPrefix,
      requiredPermissionProfile: parsed.requiredPermissionProfile,
    };
  } else {
    config = buildSingleServerConfig(server);
  }

  if (!name) {
    throw new Error('Server name is required');
  }

  return [name, config];
}

function buildMcpServerConfig(entries: EditableMcpServer[]): Record<string, ManagedClientFileMcpServerConfig> {
  const config: Record<string, ManagedClientFileMcpServerConfig> = {};

  for (const server of entries) {
    const [name, entryConfig] = buildServerEntry(server);
    if (config[name]) {
      throw new Error(`Duplicate server name: ${name}`);
    }
    config[name] = entryConfig;
  }

  return config;
}

function getServerConfigSignature(config: ManagedClientFileMcpServerConfig): string {
  return JSON.stringify(config);
}

function getServerDisplayTitle(server: EditableMcpServer, fallbackTitle: string): string {
  const name = server.name.trim();
  return name || fallbackTitle;
}

export default function ExternalMcpServers() {
  const { t } = useI18n();
  const [mcpServers, setMcpServers] = useState<EditableMcpServer[]>([]);
  const [persistedMcpServers, setPersistedMcpServers] = useState<Record<string, ManagedClientFileMcpServerConfig>>({});
  const [mcpSaving, setMcpSaving] = useState(false);
  const [savingServerId, setSavingServerId] = useState<string | null>(null);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpRefreshing, setMcpRefreshing] = useState(false);
  const [mcpMessage, setMcpMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, McpTestResult>>({});
  const [managedClientBootstrap, setManagedClientBootstrap] = useState<{
    mode: 'cli-server' | 'managed-client' | 'managed-client-mcp-ws';
    running: boolean;
  } | null>(null);
  const [builtInToolsConfig, setBuiltInToolsConfig] = useState<BuiltInToolsSecurityConfig | null>(null);

  const isManagedMcpWsRunning = managedClientBootstrap?.mode === 'managed-client-mcp-ws' && managedClientBootstrap.running;

  const mcpStatusClassName = useMemo(() => {
    if (!mcpMessage) {
      return '';
    }
    if (mcpMessage.type === 'error') {
      return 'text-red-400';
    }
    if (mcpMessage.type === 'success') {
      return 'text-green-400';
    }
    return 'text-slate-400';
  }, [mcpMessage]);

  const syncServerJsonDraft = (server: EditableMcpServer): EditableMcpServer => ({
    ...server,
    jsonDraft: formatSingleServerJson(server, buildDraftSingleServerConfig(server)),
  });

  const reloadBuiltInToolsConfig = async () => {
    const builtInToolsState = await window.electronAPI.getBuiltInToolsSecurityConfig();
    setBuiltInToolsConfig(builtInToolsState.config);
  };

  useEffect(() => {
    Promise.all([
      window.electronAPI.getManagedClientMcpServersConfig(),
      window.electronAPI.getManagedClientBootstrapState(),
      window.electronAPI.getBuiltInToolsSecurityConfig(),
    ]).then(([mcpConfigState, bootstrapState, builtInToolsState]) => {
      setManagedClientBootstrap({
        mode: bootstrapState.mode,
        running: bootstrapState.running,
      });
      setBuiltInToolsConfig(builtInToolsState.config);

      setPersistedMcpServers(mcpConfigState.mcpServers);
      const entries = Object.entries(mcpConfigState.mcpServers);
      setMcpServers(sortServersByCreatedOrder(entries.map(([name, config], index) => {
        const server = toEditableMcpServer(name, config, index, entries.length - index);
        return syncServerJsonDraft(server);
      })));
    });

    const dispose = window.electronAPI.onServerEvent(async () => {
      const bootstrapState = await window.electronAPI.getManagedClientBootstrapState();
      setManagedClientBootstrap({
        mode: bootstrapState.mode,
        running: bootstrapState.running,
      });
    });

    const handleBuiltInToolsConfigChanged = () => {
      void reloadBuiltInToolsConfig();
    };

    const handleWindowFocus = () => {
      void reloadBuiltInToolsConfig();
    };

    window.addEventListener('managed-client:built-in-tools-config-changed', handleBuiltInToolsConfigChanged);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      dispose();
      window.removeEventListener('managed-client:built-in-tools-config-changed', handleBuiltInToolsConfigChanged);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, []);

  const updateMcpServer = (
    id: string,
    updater: (server: EditableMcpServer) => EditableMcpServer,
    options?: { syncJsonFromFields?: boolean },
  ) => {
    const syncJsonFromFields = options?.syncJsonFromFields !== false;

    setMcpServers((current) => current.map((server) => {
      if (server.id !== id) {
        return server;
      }

      const next = updater(server);
      if (syncJsonFromFields) {
        return syncServerJsonDraft(next);
      }

      return next;
    }));

    setMcpTestResults((current) => {
      if (!current[id]) {
        return current;
      }

      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const serverPersistenceState = useMemo(() => {
    return Object.fromEntries(mcpServers.map((server) => {
      try {
        const [name, config] = buildServerEntry(server);
        const persistedConfig = persistedMcpServers[name];
        const matchesPersistedName = server.persistedName === name;
        const matchesPersistedConfig = matchesPersistedName
          && !!persistedConfig
          && getServerConfigSignature(persistedConfig) === getServerConfigSignature(config);

        return [server.id, {
          dirty: !matchesPersistedConfig,
          canSave: true,
        }];
      } catch {
        return [server.id, {
          dirty: true,
          canSave: false,
        }];
      }
    }));
  }, [mcpServers, persistedMcpServers]);

  const currentPermissionProfile = builtInToolsConfig?.permissionProfile ?? DEFAULT_BUILT_IN_TOOLS_PERMISSION_PROFILE;

  const effectiveServersSummary = useMemo(() => {
    return mcpServers.reduce((summary, server) => {
      if (!server.enabled) {
        return {
          ...summary,
          disabled: summary.disabled + 1,
        };
      }

      const decision = getExternalMcpAccessDecision(
        currentPermissionProfile,
        server.transport,
        server.requiredPermissionProfile,
      );

      if (decision.allowed) {
        return {
          ...summary,
          active: summary.active + 1,
        };
      }

      return {
        ...summary,
        blocked: summary.blocked + 1,
      };
    }, { active: 0, blocked: 0, disabled: 0 });
  }, [currentPermissionProfile, mcpServers]);

  const allowedTransportSummary = currentPermissionProfile === 'command-only'
    ? t('settings.externalMcpAllowedTransportsCommandOnly')
    : currentPermissionProfile === 'interactive-trusted'
      ? t('settings.externalMcpAllowedTransportsInteractiveTrusted')
      : t('settings.externalMcpAllowedTransportsFullLocalAdmin');

  const getBlockedReasonText = (reason: 'profile-too-low' | 'transport-blocked' | undefined) => {
    if (reason === 'transport-blocked') {
      return t('settings.externalMcpStatusBlockedTransport');
    }

    return t('settings.externalMcpStatusBlockedProfile');
  };

  const handleSwitchServerMode = (server: EditableMcpServer, nextMode: ConfigMode) => {
    if (server.editorMode === nextMode) {
      return;
    }

    if (nextMode === 'json') {
      const jsonDraft = formatSingleServerJson(server, buildDraftSingleServerConfig(server));
      updateMcpServer(server.id, (current) => ({
        ...current,
        editorMode: 'json',
        jsonDraft,
        jsonTouched: false,
      }));
      setMcpMessage(null);
      return;
    }

    try {
      const parsed = parseSingleServerJson(server.jsonDraft);
      updateMcpServer(server.id, () => ({
        ...syncServerJsonDraft(toEditableMcpServer(
          typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : server.name,
          parsed,
          0,
        )),
        id: server.id,
        createdOrder: server.createdOrder,
        persistedName: server.persistedName,
        editorMode: 'form',
        jsonTouched: false,
        collapsed: server.collapsed,
      }));
      setMcpMessage(null);
    } catch (err) {
      setMcpMessage({ type: 'error', text: t('settings.externalMcpJsonInvalid', { error: String(err) }) });
    }
  };

  const handleAddMcpServer = () => {
    setMcpServers((current) => {
      const nextServer = {
        ...createEditableServer(current.length + 1),
        createdOrder: current.reduce((maxOrder, server) => Math.max(maxOrder, server.createdOrder), 0) + 1,
      };

      return sortServersByCreatedOrder([...current, nextServer]);
    });
  };

  const handleDeleteMcpServer = (id: string) => {
    setMcpServers((current) => current.filter((server) => server.id !== id));
    setMcpTestResults((current) => {
      if (!current[id]) {
        return current;
      }

      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const handleToggleCollapsed = (id: string) => {
    setMcpServers((current) => current.map((server) => server.id === id
      ? { ...server, collapsed: !server.collapsed }
      : server));
  };

  const handleSaveMcpServer = async (server: EditableMcpServer) => {
    setSavingServerId(server.id);
    setMcpMessage(null);

    try {
      const [name, config] = buildServerEntry(server);
      const nextPersisted = { ...persistedMcpServers };
      if (server.persistedName && server.persistedName !== name) {
        delete nextPersisted[server.persistedName];
      }
      nextPersisted[name] = config;

      await window.electronAPI.saveManagedClientMcpServersConfig({
        mcpServers: nextPersisted,
        apply: false,
      });

      setPersistedMcpServers(nextPersisted);
      setMcpServers((current) => sortServersByCreatedOrder(current.map((item) => item.id === server.id
        ? {
          ...item,
          persistedName: name,
          name,
          jsonTouched: false,
        }
        : item)));
      setMcpMessage({ type: 'success', text: t('settings.externalMcpSaveItemOnly') });
    } catch (err) {
      setMcpMessage({ type: 'error', text: t('settings.externalMcpSaveFailed', { error: String(err) }) });
    } finally {
      setSavingServerId(null);
    }
  };

  const handleTestMcpServers = async (server?: EditableMcpServer) => {
    setMcpTesting(true);
    setMcpMessage(null);

    try {
      const mcpConfig = server
        ? Object.fromEntries([buildServerEntry(server)])
        : buildMcpServerConfig(mcpServers);
      const result = await window.electronAPI.testManagedClientMcpServersConfig({ mcpServers: mcpConfig });

      if (server) {
        const singleResult = result.results[0];
        if (singleResult) {
          setMcpTestResults((current) => ({ ...current, [server.id]: singleResult }));
        }
      } else {
        const mappedResults: Record<string, McpTestResult> = {};
        for (const item of mcpServers) {
          const match = result.results.find((entry) => entry.name === item.name.trim());
          if (match) {
            mappedResults[item.id] = match;
          }
        }
        setMcpTestResults(mappedResults);
      }

      const successCount = result.results.filter((entry) => entry.success).length;
      setMcpMessage({
        type: successCount === result.results.length ? 'success' : 'info',
        text: t('settings.externalMcpTestSummary', {
          success: successCount,
          total: result.results.length,
        }),
      });
    } catch (err) {
      setMcpMessage({ type: 'error', text: t('settings.externalMcpTestFailed', { error: String(err) }) });
    } finally {
      setMcpTesting(false);
    }
  };

  const handleSaveMcpServers = async () => {
    setMcpSaving(true);
    setMcpMessage(null);

    try {
      const mcpConfig = buildMcpServerConfig(sortServersByCreatedOrder(mcpServers));
      const saveResult = await window.electronAPI.saveManagedClientMcpServersConfig({ mcpServers: mcpConfig, apply: true });
      setPersistedMcpServers(mcpConfig);
      const entries = Object.entries(mcpConfig);
      setMcpServers(sortServersByCreatedOrder(entries.map(([name, config], index) => {
        const server = toEditableMcpServer(name, config, index, entries.length - index);
        return syncServerJsonDraft(server);
      })));
      setMcpMessage({
        type: saveResult.applied ? 'success' : 'info',
        text: saveResult.applied
          ? t('settings.externalMcpSaveApplied', { toolCount: saveResult.toolCount })
          : t('settings.externalMcpSaveOnly'),
      });
    } catch (err) {
      setMcpMessage({ type: 'error', text: t('settings.externalMcpSaveFailed', { error: String(err) }) });
    } finally {
      setMcpSaving(false);
    }
  };

  const handleRefreshMcpTools = async () => {
    setMcpRefreshing(true);
    setMcpMessage(null);

    try {
      const result = await window.electronAPI.refreshManagedClientMcpTools();
      setMcpMessage({
        type: result.applied ? 'success' : 'info',
        text: result.applied
          ? t('settings.externalMcpRefreshApplied', { toolCount: result.toolCount })
          : t('settings.externalMcpRefreshSkipped'),
      });
    } catch (err) {
      setMcpMessage({ type: 'error', text: t('settings.externalMcpRefreshFailed', { error: String(err) }) });
    } finally {
      setMcpRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">{t('settings.externalMcpTitle')}</h2>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="space-y-1">
              <CardTitle>{t('settings.externalMcpTitle')}</CardTitle>
              <p className="text-xs text-slate-500">{t('settings.externalMcpDescription')}</p>
            </div>
            <Badge variant={isManagedMcpWsRunning ? 'success' : 'info'}>
              {isManagedMcpWsRunning ? t('settings.externalMcpLive') : t('settings.externalMcpInactive')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleAddMcpServer}
              className="px-3 py-1.5 text-sm border border-dashed border-slate-700 text-slate-300 rounded hover:border-slate-500 hover:text-white transition-colors"
            >
              {t('settings.externalMcpAdd')}
            </button>
            <div className="flex-1" />
            <button
              onClick={() => handleTestMcpServers()}
              disabled={mcpTesting}
              className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {mcpTesting ? t('settings.externalMcpTesting') : t('settings.externalMcpTestAll')}
            </button>
            <button
              onClick={handleRefreshMcpTools}
              disabled={mcpRefreshing}
              className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {mcpRefreshing ? t('settings.externalMcpRefreshing') : t('settings.externalMcpRepublish')}
            </button>
            <button
              onClick={handleSaveMcpServers}
              disabled={mcpSaving}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {mcpSaving ? t('settings.externalMcpSaving') : t('settings.externalMcpSave')}
            </button>
          </div>

          {mcpMessage && <div className={`text-xs ${mcpStatusClassName}`}>{mcpMessage.text}</div>}

          <div className="text-xs text-slate-500">
            {isManagedMcpWsRunning ? t('settings.externalMcpLiveHint') : t('settings.externalMcpInactiveHint')}
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-300">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">{t('settings.externalMcpCurrentPermissionProfile')}</span>
              <Badge variant="info">{t(`builtInTools.permissionProfile.${currentPermissionProfile}`)}</Badge>
              <span className="text-slate-500">{allowedTransportSummary}</span>
            </div>
            <div className="mt-2 text-slate-500">
              {t('settings.externalMcpEffectiveSummary', effectiveServersSummary)}
            </div>
          </div>

          <div className="space-y-4">
            {mcpServers.length === 0 && (
              <div className="rounded-md border border-dashed border-slate-700 px-4 py-6 text-sm text-slate-500 text-center">
                {t('settings.externalMcpEmpty')}
              </div>
            )}

            {mcpServers.map((server, index) => {
              const testResult = mcpTestResults[server.id];
              const persistenceState = serverPersistenceState[server.id] ?? { dirty: true, canSave: false };
              const accessDecision = getExternalMcpAccessDecision(
                currentPermissionProfile,
                server.transport,
                server.requiredPermissionProfile,
              );
              const statusTone = !server.enabled
                ? 'border-slate-700 bg-slate-900/60 text-slate-400'
                : accessDecision.allowed
                  ? 'border-green-900 bg-green-950/30 text-green-300'
                  : 'border-amber-900 bg-amber-950/30 text-amber-200';
              const statusText = !server.enabled
                ? t('settings.externalMcpStatusDisabled')
                : accessDecision.allowed
                  ? t('settings.externalMcpStatusActive')
                  : getBlockedReasonText(accessDecision.blockedReason);

              return (
                <div key={server.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleToggleCollapsed(server.id)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                      aria-label={server.collapsed ? t('settings.externalMcpExpand') : t('settings.externalMcpCollapse')}
                      title={server.collapsed ? t('settings.externalMcpExpand') : t('settings.externalMcpCollapse')}
                    >
                      {server.collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    <div className="text-sm font-medium text-slate-100">
                      {getServerDisplayTitle(server, t('settings.externalMcpServerCard', { index: server.createdOrder }))}
                    </div>
                    <div className={`rounded-full border px-2 py-1 text-[11px] ${statusTone}`}>
                      {statusText}
                    </div>
                    <div className="flex-1" />
                    <button
                      onClick={() => handleSwitchServerMode(server, 'form')}
                      className={`px-3 py-1.5 text-xs rounded transition-colors ${server.editorMode === 'form'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                    >
                      {t('settings.externalMcpFormMode')}
                    </button>
                    <button
                      onClick={() => handleSwitchServerMode(server, 'json')}
                      className={`px-3 py-1.5 text-xs rounded transition-colors ${server.editorMode === 'json'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                    >
                      {t('settings.externalMcpJsonMode')}
                    </button>
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={server.enabled}
                        onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, enabled: event.target.checked }))}
                      />
                      {t('settings.externalMcpEnabled')}
                    </label>
                    <button
                      onClick={() => handleTestMcpServers(server)}
                      disabled={mcpTesting}
                      className="px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('settings.externalMcpTestOne')}
                    </button>
                    <button
                      onClick={() => handleSaveMcpServer(server)}
                      disabled={!persistenceState.canSave || !persistenceState.dirty || savingServerId === server.id}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {savingServerId === server.id
                        ? t('settings.externalMcpSaving')
                        : persistenceState.dirty
                          ? t('settings.externalMcpSave')
                          : t('settings.externalMcpSaved')}
                    </button>
                    <button
                      onClick={() => handleDeleteMcpServer(server.id)}
                      className="px-3 py-1.5 text-xs bg-red-950/50 border border-red-900 text-red-200 rounded hover:bg-red-900/40 transition-colors"
                    >
                      {t('settings.externalMcpDelete')}
                    </button>
                  </div>

                  {server.collapsed ? null : (
                    <>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="block text-xs text-slate-500">{t('settings.externalMcpName')}</label>
                        <Input
                          value={server.name}
                          onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, name: event.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs text-slate-500">{t('settings.externalMcpToolPrefix')}</label>
                        <Input
                          value={server.toolPrefix}
                          onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, toolPrefix: event.target.value }))}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="block text-xs text-slate-500">{t('settings.externalMcpRequiredPermissionProfile')}</label>
                        <div className="flex flex-wrap gap-2">
                          {PERMISSION_PROFILE_OPTIONS.map((profile) => (
                            <button
                              key={profile}
                              type="button"
                              onClick={() => updateMcpServer(server.id, (current) => ({ ...current, requiredPermissionProfile: profile }))}
                              className={`px-3 py-1.5 text-xs rounded transition-colors ${server.requiredPermissionProfile === profile
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
                                }`}
                            >
                              {t(`builtInTools.permissionProfile.${profile}`)}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-slate-500">
                          {t('settings.externalMcpRequiredPermissionProfileHint', {
                            current: t(`builtInTools.permissionProfile.${currentPermissionProfile}`),
                            required: t(`builtInTools.permissionProfile.${server.requiredPermissionProfile}`),
                          })}
                        </p>
                      </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="block text-xs text-slate-500">{t('settings.externalMcpTools')}</label>
                          <textarea
                            value={server.toolsText}
                            onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, toolsText: event.target.value }))}
                            rows={3}
                            className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
                            placeholder="*&#10;query&#10;list_tables"
                          />
                        </div>
                    </div>

                    {server.editorMode === 'json' ? (
                      <div className="space-y-2">
                        <label className="block text-xs text-slate-500">{t('settings.externalMcpJsonLabel')}</label>
                        <textarea
                          value={server.jsonDraft}
                          onChange={(event) => updateMcpServer(
                            server.id,
                            (current) => {
                              const nextDraft = event.target.value;
                              let next = {
                                ...current,
                                jsonDraft: nextDraft,
                                jsonTouched: true,
                              };
                              try {
                                next = applyConfigToEditableServer(next, parseSingleServerJson(nextDraft));
                              } catch {
                                // Keep the raw draft while the JSON is incomplete or invalid.
                              }

                              return next;
                            },
                            { syncJsonFromFields: false },
                          )}
                          rows={14}
                          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm font-mono text-slate-200 resize-y focus:outline-none focus:border-slate-600"
                          spellCheck={false}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <label className="block text-xs text-slate-500">{t('settings.externalMcpTransport')}</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateMcpServer(server.id, (current) => ({ ...current, transport: 'http' }))}
                              className={`px-3 py-1.5 text-sm rounded transition-colors ${server.transport === 'http'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
                                }`}
                            >
                              HTTP
                            </button>
                            <button
                              onClick={() => updateMcpServer(server.id, (current) => ({ ...current, transport: 'stdio' }))}
                              className={`px-3 py-1.5 text-sm rounded transition-colors ${server.transport === 'stdio'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
                                }`}
                            >
                              STDIO
                            </button>
                          </div>
                        </div>

                        {server.transport === 'http' ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1 md:col-span-2">
                              <label className="block text-xs text-slate-500">URL</label>
                              <Input
                                value={server.url}
                                onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, url: event.target.value }))}
                                placeholder="http://localhost:4000/mcp"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs text-slate-500">{t('settings.externalMcpTimeout')}</label>
                              <Input
                                value={server.timeout}
                                onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, timeout: event.target.value }))}
                                placeholder="30000"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-1 md:col-span-2">
                                <label className="block text-xs text-slate-500">{t('settings.externalMcpCommand')}</label>
                                <Input
                                  value={server.command}
                                  onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, command: event.target.value }))}
                                  placeholder="npx"
                                />
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <label className="block text-xs text-slate-500">{t('settings.externalMcpArgs')}</label>
                                <textarea
                                  value={server.argsText}
                                  onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, argsText: event.target.value }))}
                                  rows={4}
                                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
                                  placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;C:/workspace"
                                />
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <label className="block text-xs text-slate-500">{t('settings.externalMcpCwd')}</label>
                                <Input
                                  value={server.cwd}
                                  onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, cwd: event.target.value }))}
                                  placeholder="C:/workspace"
                                />
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <label className="block text-xs text-slate-500">{t('settings.externalMcpEnv')}</label>
                                <textarea
                                  value={server.envText}
                                  onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, envText: event.target.value }))}
                                  rows={4}
                                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
                                  placeholder="API_KEY=demo-token&#10;LOG_LEVEL=debug"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {testResult && (
                      <div className={`rounded-md border px-3 py-2 text-xs ${testResult.success
                        ? 'border-green-900 bg-green-950/30 text-green-300'
                        : testResult.blockedReason
                          ? 'border-amber-900 bg-amber-950/30 text-amber-200'
                          : 'border-red-900 bg-red-950/30 text-red-300'
                        }`}>
                        {testResult.success
                          ? t('settings.externalMcpTestSuccess', { toolCount: testResult.toolCount })
                          : testResult.blockedReason
                            ? t('settings.externalMcpTestBlocked', {
                              required: t(`builtInTools.permissionProfile.${testResult.requiredPermissionProfile}`),
                              current: t(`builtInTools.permissionProfile.${currentPermissionProfile}`),
                              reason: getBlockedReasonText(testResult.blockedReason),
                            })
                          : t('settings.externalMcpTestError', { error: testResult.error ?? 'Unknown error' })}
                      </div>
                    )}
                  </>
                  )}
                </div>
              );
            })}

          </div>
        </CardContent>
      </Card>
    </div>
  );
}