import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import PermissionProfileSummary from '../components/PermissionProfileSummary';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  getExternalMcpRemotePublicationDecision,
  normalizeManagedClientExternalMcpTrustLevel,
  type ManagedClientExternalMcpPublicationBlockedReason,
  type ManagedClientFileMcpServerConfig,
} from '../../main/managed-client/mcp-server-config';
import type { ManagedClientExternalMcpTrustLevel } from '../../main/managed-client/types';
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
  trustLevel: ManagedClientExternalMcpTrustLevel;
  publishedRemotely: boolean;
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
  blockedReason?: 'profile-too-low' | 'transport-blocked' | ManagedClientExternalMcpPublicationBlockedReason;
}

function parseToolsText(text: string): string[] {
  return Array.from(new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
}

function assertExplicitTools(tools: string[] | undefined, serverLabel: string): string[] {
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(`Allowed tools cannot be empty: ${serverLabel}`);
  }

  if (tools.includes('*')) {
    throw new Error(`Allowed tools cannot include wildcard '*': ${serverLabel}`);
  }

  return tools;
}

function serializeTools(tools: string[]): string {
  return tools.join('\n');
}

function toggleToolSelection(currentText: string, toolName: string, checked: boolean): string {
  const currentTools = parseToolsText(currentText).filter((tool) => tool !== '*');
  const nextTools = checked
    ? Array.from(new Set([...currentTools, toolName])).sort((left, right) => left.localeCompare(right))
    : currentTools.filter((tool) => tool !== toolName);

  return serializeTools(nextTools);
}

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
  const tools = parseToolsText(server.toolsText);

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
      trustLevel: server.trustLevel,
      publishedRemotely: server.publishedRemotely,
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
    trustLevel: server.trustLevel,
    publishedRemotely: server.publishedRemotely,
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
    toolsText: Array.isArray(config.tools) ? config.tools.join('\n') : '',
    cwd: config.cwd ?? '',
    envText: serializeEnv(config.env),
    toolPrefix: config.toolPrefix ?? '',
    requiredPermissionProfile: config.requiredPermissionProfile ?? getDefaultExternalMcpPermissionProfile(config.transport === 'http' ? 'http' : 'stdio'),
    trustLevel: normalizeManagedClientExternalMcpTrustLevel(config.trustLevel),
    publishedRemotely: config.publishedRemotely === true,
    editorMode: 'form',
    jsonDraft: '',
    jsonTouched: false,
    collapsed: true,
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
    toolsText: Array.isArray(config.tools) ? config.tools.join('\n') : '',
    cwd: config.cwd ?? '',
    envText: serializeEnv(config.env),
    toolPrefix: config.toolPrefix ?? '',
    requiredPermissionProfile: config.requiredPermissionProfile ?? getDefaultExternalMcpPermissionProfile(config.transport === 'http' ? 'http' : 'stdio'),
    trustLevel: normalizeManagedClientExternalMcpTrustLevel(config.trustLevel),
    publishedRemotely: config.publishedRemotely === true,
  };
}

function createEditableServer(index: number): EditableMcpServer {
  return toEditableMcpServer(
    `server-${index}`,
    {
      transport: 'http',
      enabled: true,
      timeout: 30000,
      tools: [],
      requiredPermissionProfile: getDefaultExternalMcpPermissionProfile('http'),
      trustLevel: 'experimental',
      publishedRemotely: false,
    },
    index,
  );
}

function buildSingleServerConfig(server: EditableMcpServer, options?: { skipToolsValidation?: boolean }): ManagedClientFileMcpServerConfig {
  const toolPrefix = server.toolPrefix.trim() || undefined;
  const parsedTools = parseToolsText(server.toolsText);
  const tools = options?.skipToolsValidation ? parsedTools : assertExplicitTools(parsedTools, server.name.trim() || server.id);

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
      tools,
      requiredPermissionProfile: server.requiredPermissionProfile,
      trustLevel: server.trustLevel,
      publishedRemotely: server.publishedRemotely,
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
    tools,
    cwd: server.cwd.trim() || undefined,
    env: parseEnvText(server.envText),
    enabled: server.enabled,
    toolPrefix,
    requiredPermissionProfile: server.requiredPermissionProfile,
    trustLevel: server.trustLevel,
    publishedRemotely: server.publishedRemotely,
  };
}

function buildServerEntry(server: EditableMcpServer, options?: { skipToolsValidation?: boolean }): [string, ManagedClientFileMcpServerConfig] {
  let name = server.name.trim();
  let config: ManagedClientFileMcpServerConfig;

  if (server.editorMode === 'json') {
    const parsed = parseSingleServerJson(server.jsonDraft);
    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      name = parsed.name.trim();
    }
    const rawTools = Array.isArray(parsed.tools) ? parsed.tools.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : undefined;
    const tools = options?.skipToolsValidation ? (rawTools ?? []) : assertExplicitTools(rawTools, name || server.id);
    config = {
      transport: parsed.transport,
      url: parsed.url,
      timeout: parsed.timeout,
      command: parsed.command,
      args: parsed.args,
      tools,
      cwd: parsed.cwd,
      env: parsed.env,
      enabled: parsed.enabled,
      toolPrefix: parsed.toolPrefix,
      requiredPermissionProfile: parsed.requiredPermissionProfile,
      trustLevel: normalizeManagedClientExternalMcpTrustLevel(parsed.trustLevel),
      publishedRemotely: parsed.publishedRemotely === true,
    };
  } else {
    config = buildSingleServerConfig(server, options);
  }

  if (!name) {
    throw new Error('Server name is required');
  }

  return [name, config];
}

function buildMcpServerConfig(entries: EditableMcpServer[], options?: { skipToolsValidation?: boolean }): Record<string, ManagedClientFileMcpServerConfig> {
  const config: Record<string, ManagedClientFileMcpServerConfig> = {};

  for (const server of entries) {
    const [name, entryConfig] = buildServerEntry(server, options);
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
  const [mcpPublishing, setMcpPublishing] = useState(false);
  const [savingServerId, setSavingServerId] = useState<string | null>(null);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpMessage, setMcpMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [mcpItemMessages, setMcpItemMessages] = useState<Record<string, { type: 'success' | 'error' | 'info'; text: string }>>({});
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, McpTestResult>>({});
  const [mcpDiscoveryVisibility, setMcpDiscoveryVisibility] = useState<Record<string, boolean>>({});
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

    setMcpItemMessages((current) => {
      if (!(id in current)) {
        return current;
      }

      const next = { ...current };
      delete next[id];
      return next;
    });

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

  const globalPersistenceState = useMemo(() => {
    const states = Object.values(serverPersistenceState);
    let currentConfigMatchesPersisted = false;

    try {
      const currentConfig = buildMcpServerConfig(sortServersByCreatedOrder(mcpServers));
      const persistedNames = Object.keys(persistedMcpServers).sort();
      const currentNames = Object.keys(currentConfig).sort();

      currentConfigMatchesPersisted = persistedNames.length === currentNames.length
        && persistedNames.every((name, index) => {
          const currentName = currentNames[index];
          return currentName === name
            && getServerConfigSignature(currentConfig[name]) === getServerConfigSignature(persistedMcpServers[name]);
        });
    } catch {
      currentConfigMatchesPersisted = false;
    }

    return {
      dirty: !currentConfigMatchesPersisted,
      canSave: states.every((state) => state.canSave),
    };
  }, [mcpServers, persistedMcpServers, serverPersistenceState]);

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
      const publicationDecision = getExternalMcpRemotePublicationDecision(buildDraftSingleServerConfig(server));

      if (decision.allowed) {
        if (!publicationDecision.allowed) {
          return {
            ...summary,
            blocked: summary.blocked + 1,
          };
        }

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

  const getBlockedReasonText = (reason: 'profile-too-low' | 'transport-blocked' | ManagedClientExternalMcpPublicationBlockedReason | undefined) => {
    if (reason === 'transport-blocked') {
      return t('settings.externalMcpStatusBlockedTransport');
    }

    if (reason === 'not-published-remotely') {
      return t('settings.externalMcpStatusBlockedRemoteDisabled');
    }

    if (reason === 'trust-level-blocked') {
      return t('settings.externalMcpStatusBlockedTrustLevel');
    }

    if (reason === 'tool-list-required') {
      return t('settings.externalMcpStatusBlockedToolListRequired');
    }

    if (reason === 'wildcard-tools-blocked') {
      return t('settings.externalMcpStatusBlockedWildcard');
    }

    return t('settings.externalMcpStatusBlockedProfile');
  };

  const getExternalMcpTrustLevelLabel = (trustLevel: ManagedClientExternalMcpTrustLevel) => {
    if (trustLevel === 'trusted') {
      return t('settings.externalMcpTrustLevelTrusted');
    }

    if (trustLevel === 'internal-reviewed') {
      return t('settings.externalMcpTrustLevelInternalReviewed');
    }

    if (trustLevel === 'blocked') {
      return t('settings.externalMcpTrustLevelBlocked');
    }

    return t('settings.externalMcpTrustLevelExperimental');
  };

  const getRemotePublicationWarningContent = (
    blockedReason: ManagedClientExternalMcpPublicationBlockedReason | undefined,
    trustLevel: ManagedClientExternalMcpTrustLevel,
  ) => {
    const trustLevelLabel = getExternalMcpTrustLevelLabel(trustLevel);

    if (blockedReason === 'not-published-remotely') {
      return {
        title: t('settings.externalMcpRemotePublicationDisabledTitle'),
        body: t('settings.externalMcpRemotePublicationDisabledBody', {
          trustLevel: trustLevelLabel,
          eligibleLevels: t('settings.externalMcpRemotePublicationEligibleLevels'),
        }),
      };
    }

    if (blockedReason === 'trust-level-blocked') {
      return {
        title: t('settings.externalMcpRemotePublicationTrustLevelTitle'),
        body: trustLevel === 'blocked'
          ? t('settings.externalMcpRemotePublicationTrustLevelBlockedBody', {
            trustLevel: trustLevelLabel,
            eligibleLevels: t('settings.externalMcpRemotePublicationEligibleLevels'),
          })
          : t('settings.externalMcpRemotePublicationTrustLevelExperimentalBody', {
            trustLevel: trustLevelLabel,
            eligibleLevels: t('settings.externalMcpRemotePublicationEligibleLevels'),
          }),
      };
    }

    if (blockedReason === 'tool-list-required') {
      return {
        title: t('settings.externalMcpRemotePublicationToolListTitle'),
        body: t('settings.externalMcpRemotePublicationToolListBody', {
          trustLevel: trustLevelLabel,
        }),
      };
    }

    if (blockedReason === 'wildcard-tools-blocked') {
      return {
        title: t('settings.externalMcpRemotePublicationWildcardTitle'),
        body: t('settings.externalMcpRemotePublicationWildcardBody', {
          trustLevel: trustLevelLabel,
        }),
      };
    }

    return {
      title: t('settings.externalMcpRemotePublicationBlockedTitle'),
      body: t('settings.externalMcpRemotePublicationBlockedBody', {
        reason: getBlockedReasonText(blockedReason),
      }),
    };
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
    setMcpDiscoveryVisibility((current) => {
      if (!(id in current)) {
        return current;
      }

      const next = { ...current };
      delete next[id];
      return next;
    });
    setMcpItemMessages((current) => {
      if (!(id in current)) {
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

  const expandMcpServer = (id: string) => {
    setMcpServers((current) => current.map((server) => (server.id === id && server.collapsed)
      ? { ...server, collapsed: false }
      : server));
  };

  const handleSaveMcpServer = async (server: EditableMcpServer) => {
    setSavingServerId(server.id);
    setMcpMessage(null);
    setMcpItemMessages((current) => {
      if (!(server.id in current)) {
        return current;
      }

      const next = { ...current };
      delete next[server.id];
      return next;
    });

    try {
      const [name, config] = buildServerEntry(server);
      const nextPersisted = { ...persistedMcpServers };
      if (server.persistedName && server.persistedName !== name) {
        delete nextPersisted[server.persistedName];
      }
      nextPersisted[name] = config;

      const saveResult = await window.electronAPI.saveManagedClientMcpServersConfig({
        mcpServers: nextPersisted,
        apply: true,
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
      setMcpItemMessages((current) => ({
        ...current,
        [server.id]: {
          type: saveResult.applied ? 'success' : 'info',
          text: saveResult.applied
            ? t('settings.externalMcpSaveItemApplied', { toolCount: saveResult.toolCount })
            : saveResult.reason === 'bridge-not-ready'
              ? t('settings.externalMcpSaveItemBridgeNotReady', { toolCount: saveResult.toolCount })
              : t('settings.externalMcpSaveItemInactive'),
        },
      }));
    } catch (err) {
      setMcpItemMessages((current) => ({
        ...current,
        [server.id]: {
          type: 'error',
          text: t('settings.externalMcpSaveFailed', { error: String(err) }),
        },
      }));
    } finally {
      setSavingServerId(null);
    }
  };

  const handleTestMcpServers = async (server?: EditableMcpServer, options?: { revealDiscovery?: boolean }) => {
    if (server) {
      setMcpDiscoveryVisibility((current) => ({
        ...current,
        [server.id]: options?.revealDiscovery === true,
      }));
      setMcpItemMessages((current) => {
        if (!(server.id in current)) {
          return current;
        }

        const next = { ...current };
        delete next[server.id];
        return next;
      });
    } else {
      setMcpItemMessages({});
    }

    setMcpTesting(true);
    setMcpMessage(null);

    try {
      const mcpConfig = server
        ? Object.fromEntries([buildServerEntry(server, { skipToolsValidation: true })])
        : buildMcpServerConfig(mcpServers, { skipToolsValidation: true });
      const result = await window.electronAPI.testManagedClientMcpServersConfig({ mcpServers: mcpConfig });
      const successCount = result.results.filter((entry) => entry.success).length;

      if (server) {
        expandMcpServer(server.id);
        const singleResult = result.results[0];
        if (singleResult) {
          setMcpTestResults((current) => ({ ...current, [server.id]: singleResult }));
        }
        const isDiscoveryFlow = options?.revealDiscovery === true;
        setMcpItemMessages((current) => ({
          ...current,
          [server.id]: {
            type: singleResult?.success
              ? 'success'
              : singleResult?.blockedReason
                ? 'info'
                : 'error',
            text: isDiscoveryFlow
              ? singleResult?.success
                ? (singleResult.toolCount > 0
                  ? t('settings.externalMcpDiscoverSuccess', { toolCount: singleResult.toolCount })
                  : t('settings.externalMcpDiscoverEmpty'))
                : singleResult?.blockedReason
                  ? t('settings.externalMcpDiscoverBlocked', {
                    reason: getBlockedReasonText(singleResult.blockedReason),
                    required: t(`builtInTools.permissionProfile.${singleResult.requiredPermissionProfile}`),
                    current: t(`builtInTools.permissionProfile.${currentPermissionProfile}`),
                  })
                  : t('settings.externalMcpDiscoverFailed', { error: singleResult?.error ?? 'Unknown error' })
              : t('settings.externalMcpTestSummary', {
                success: successCount,
                total: result.results.length,
              }),
          },
        }));
      } else {
        const mappedResults: Record<string, McpTestResult> = {};
        for (const item of mcpServers) {
          const match = result.results.find((entry) => entry.name === item.name.trim());
          if (match) {
            mappedResults[item.id] = match;
          }
        }
        setMcpTestResults(mappedResults);
        setMcpItemMessages({});
      }

      if (!server) {
        setMcpMessage({
          type: successCount === result.results.length ? 'success' : 'info',
          text: t('settings.externalMcpTestSummary', {
            success: successCount,
            total: result.results.length,
          }),
        });
      }

    } catch (err) {
      if (server) {
        expandMcpServer(server.id);
        const isDiscoveryFlow = options?.revealDiscovery === true;
        setMcpItemMessages((current) => ({
          ...current,
          [server.id]: {
            type: 'error',
            text: isDiscoveryFlow
              ? t('settings.externalMcpDiscoverFailed', { error: String(err) })
              : t('settings.externalMcpTestFailed', { error: String(err) }),
          },
        }));
      } else {
        setMcpMessage({ type: 'error', text: t('settings.externalMcpTestFailed', { error: String(err) }) });
      }
    } finally {
      setMcpTesting(false);
    }
  };

  const handlePublishMcpServers = async () => {
    setMcpPublishing(true);
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
          ? t('settings.externalMcpPublishApplied', { toolCount: saveResult.toolCount })
          : saveResult.reason === 'bridge-not-ready'
            ? t('settings.externalMcpPublishBridgeNotReady', { toolCount: saveResult.toolCount })
            : t('settings.externalMcpPublishInactive'),
      });
    } catch (err) {
      setMcpMessage({ type: 'error', text: t('settings.externalMcpPublishFailed', { error: String(err) }) });
    } finally {
      setMcpPublishing(false);
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
        <CardContent>
          <div className="space-y-4">
            <PermissionProfileSummary
              title={t('settings.externalMcpCurrentPermissionProfileTitle')}
              description={t('settings.externalMcpPermissionsDescription')}
              currentLabel={t('settings.externalMcpCurrentPermissionProfile')}
              currentProfile={currentPermissionProfile}
              currentProfileLabel={t(`builtInTools.permissionProfile.${currentPermissionProfile}`)}
              linkLabel={t('settings.externalMcpOpenPermissionsPage')}
              extraLines={[
                allowedTransportSummary,
                t('settings.externalMcpEffectiveSummary', effectiveServersSummary),
              ]}
            />

            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <button
                  onClick={handleAddMcpServer}
                  className="self-start px-3 py-1.5 text-sm border border-dashed border-slate-700 text-slate-300 rounded hover:border-slate-500 hover:text-white transition-colors"
                >
                  {t('settings.externalMcpAdd')}
                </button>

                <div className="flex flex-nowrap items-center gap-2 overflow-x-auto md:justify-end">
                  <button
                    onClick={() => handleTestMcpServers()}
                    disabled={mcpTesting}
                    className="shrink-0 px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {mcpTesting ? t('settings.externalMcpTesting') : t('settings.externalMcpTestAll')}
                  </button>
                  <button
                    onClick={handlePublishMcpServers}
                    disabled={mcpPublishing || !globalPersistenceState.canSave}
                    className="min-w-[72px] shrink-0 px-3 py-1.5 text-center text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {mcpPublishing
                      ? t('settings.externalMcpPublishing')
                      : isManagedMcpWsRunning
                        ? t('settings.externalMcpPublish')
                        : t('settings.externalMcpPublishQueued')}
                  </button>
                </div>
              </div>

              <div className="mt-3 text-xs leading-5 text-slate-500">
                {isManagedMcpWsRunning ? t('settings.externalMcpPublishLiveHint') : t('settings.externalMcpPublishInactiveHint')}
              </div>
            </div>

            {mcpMessage && <div className={`text-xs ${mcpStatusClassName}`}>{mcpMessage.text}</div>}

            <div className="space-y-4">
              {mcpServers.length === 0 && (
                <div className="rounded-md border border-dashed border-slate-700 px-4 py-6 text-sm text-slate-500 text-center">
                  {t('settings.externalMcpEmpty')}
                </div>
              )}

              {mcpServers.map((server) => {
                const testResult = mcpTestResults[server.id];
                const itemMessage = mcpItemMessages[server.id] ?? null;
                const persistenceState = serverPersistenceState[server.id] ?? { dirty: true, canSave: false };
                const discoveredTools = testResult?.success ? testResult.tools : [];
                const showDiscoveryUi = mcpDiscoveryVisibility[server.id] === true;
                const selectedTools = new Set(parseToolsText(server.toolsText).filter((tool) => tool !== '*'));
                const accessDecision = getExternalMcpAccessDecision(
                  currentPermissionProfile,
                  server.transport,
                  server.requiredPermissionProfile,
                );
                const publicationDecision = getExternalMcpRemotePublicationDecision(buildDraftSingleServerConfig(server));
                const isGovernanceAllowed = accessDecision.allowed && publicationDecision.allowed;
                const isTestBlocked = !accessDecision.allowed;
                const showDisabledWarning = !server.enabled;
                const showPublicationBlockedWarning = server.enabled && accessDecision.allowed && !publicationDecision.allowed;
                const hideStatusBadge = publicationDecision.blockedReason === 'not-published-remotely'
                  || publicationDecision.blockedReason === 'trust-level-blocked';
                const publicationWarningContent = getRemotePublicationWarningContent(publicationDecision.blockedReason, server.trustLevel);
                const statusTone = !server.enabled
                  ? 'border-slate-700 bg-slate-900/60 text-slate-400'
                  : isGovernanceAllowed
                    ? 'border-green-900 bg-green-950/30 text-green-300'
                    : 'border-amber-900 bg-amber-950/30 text-amber-200';
                const statusText = !server.enabled
                  ? t('settings.externalMcpStatusDisabled')
                  : isGovernanceAllowed
                    ? t('settings.externalMcpStatusActive')
                    : getBlockedReasonText(accessDecision.allowed ? publicationDecision.blockedReason : accessDecision.blockedReason);

                return (
                  <div key={server.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-4">
                    <div className="flex flex-nowrap items-center gap-3 overflow-x-auto whitespace-nowrap pb-1">
                      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
                        <button
                          onClick={() => handleToggleCollapsed(server.id)}
                          className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                          aria-label={server.collapsed ? t('settings.externalMcpExpand') : t('settings.externalMcpCollapse')}
                          title={server.collapsed ? t('settings.externalMcpExpand') : t('settings.externalMcpCollapse')}
                        >
                          {server.collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        <div className="min-w-0 truncate text-sm font-medium text-slate-100">
                          {getServerDisplayTitle(server, t('settings.externalMcpServerCard', { index: server.createdOrder }))}
                        </div>
                        {!hideStatusBadge && (
                          <div className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${statusTone}`}>
                            {statusText}
                          </div>
                        )}
                        <label className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-300">
                          <input
                            type="checkbox"
                            checked={server.enabled}
                            onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, enabled: event.target.checked }))}
                            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500"
                          />
                          <span>{t('settings.externalMcpEnabled')}</span>
                        </label>
                      </div>

                      <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
                        <div className="inline-flex shrink-0 flex-nowrap rounded-md border border-slate-700 bg-slate-900 p-0.5">
                          <button
                            onClick={() => handleSwitchServerMode(server, 'form')}
                            className={`shrink-0 px-3 py-1.5 text-xs rounded transition-colors ${server.editorMode === 'form'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                              }`}
                          >
                            {t('settings.externalMcpFormMode')}
                          </button>
                          <button
                            onClick={() => handleSwitchServerMode(server, 'json')}
                            className={`shrink-0 px-3 py-1.5 text-xs rounded transition-colors ${server.editorMode === 'json'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                              }`}
                          >
                            {t('settings.externalMcpJsonMode')}
                          </button>
                        </div>
                        <button
                          onClick={() => handleTestMcpServers(server)}
                          disabled={mcpTesting || isTestBlocked}
                          className="shrink-0 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {t('settings.externalMcpTestOne')}
                        </button>
                        <button
                          onClick={() => handleSaveMcpServer(server)}
                          disabled={!persistenceState.canSave || !persistenceState.dirty || savingServerId === server.id}
                          className="min-w-[72px] shrink-0 px-3 py-1.5 text-center text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {savingServerId === server.id
                            ? t('settings.externalMcpSaving')
                            : persistenceState.dirty
                              ? t('settings.externalMcpSave')
                              : t('settings.externalMcpSaved')}
                        </button>
                        <button
                          onClick={() => handleDeleteMcpServer(server.id)}
                          className="shrink-0 px-3 py-1.5 text-xs bg-red-950/50 border border-red-900 text-red-200 rounded hover:bg-red-900/40 transition-colors"
                        >
                          {t('settings.externalMcpDelete')}
                        </button>
                      </div>
                    </div>

                    {server.collapsed ? null : (
                      <>
                        {itemMessage && (
                          <div className={`rounded-lg border px-4 py-3 text-sm shadow-[0_0_0_1px_rgba(15,23,42,0.12)] ${itemMessage.type === 'success'
                            ? 'border-green-900 bg-green-950/30 text-green-200'
                            : itemMessage.type === 'error'
                              ? 'border-red-900 bg-red-950/30 text-red-200'
                              : 'border-slate-700 bg-slate-900/80 text-slate-200'
                            }`}>
                            <div className="leading-5">{itemMessage.text}</div>
                          </div>
                        )}

                        {showDisabledWarning && (
                          <div className="rounded-lg border border-slate-600 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 shadow-[0_0_0_1px_rgba(148,163,184,0.12)]">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                              <div className="space-y-1">
                                <div className="font-medium text-slate-100">
                                  {t('settings.externalMcpDisabledWarningTitle')}
                                </div>
                                <div className="leading-5 text-slate-300">
                                  {t('settings.externalMcpDisabledWarningBody')}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {showPublicationBlockedWarning && (
                          <div className="rounded-lg border border-amber-700 bg-amber-950/60 px-4 py-3 text-sm text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.18)]">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                              <div className="space-y-1">
                                <div className="font-medium text-amber-200">
                                  {publicationWarningContent.title}
                                </div>
                                <div className="leading-5 text-amber-100">
                                  {publicationWarningContent.body}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {isTestBlocked && (
                          <div className="rounded-lg border border-amber-700 bg-amber-950/60 px-4 py-3 text-sm text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.18)]">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                              <div className="space-y-1">
                                <div className="font-medium text-amber-200">
                                  {t('settings.externalMcpTestUnavailableTitle')}
                                </div>
                                <div className="leading-5 text-amber-100">
                                  {t('settings.externalMcpTestBlocked', {
                                    reason: getBlockedReasonText(accessDecision.blockedReason),
                                    required: t(`builtInTools.permissionProfile.${server.requiredPermissionProfile}`),
                                    current: t(`builtInTools.permissionProfile.${currentPermissionProfile}`),
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

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
                          <div className="space-y-1 md:col-span-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="block text-xs text-slate-500">{t('settings.externalMcpTools')}</label>
                              <button
                                type="button"
                                onClick={() => handleTestMcpServers(server, { revealDiscovery: true })}
                                disabled={mcpTesting}
                                className="px-2 py-1 text-xs rounded border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {mcpTesting ? t('settings.externalMcpDiscoveringTools') : t('settings.externalMcpDiscoverTools')}
                              </button>
                            </div>
                            <textarea
                              value={server.toolsText}
                              onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, toolsText: event.target.value }))}
                              rows={3}
                              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
                              placeholder="query&#10;list_tables"
                            />
                            <p className="text-[11px] text-slate-500">{t('settings.externalMcpToolsHint')}</p>
                            <p className="text-[11px] text-amber-300">{t('settings.externalMcpToolsValidationHint')}</p>

                            {showDiscoveryUi && testResult?.success && discoveredTools.length === 0 && (
                              <div className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
                                {t('settings.externalMcpNoDiscoveredTools')}
                              </div>
                            )}

                            {showDiscoveryUi && discoveredTools.length > 0 && (
                              <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950/50 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <div className="text-sm text-slate-200">{t('settings.externalMcpDiscoveredToolsTitle')}</div>
                                    <div className="text-xs text-slate-500">{t('settings.externalMcpDiscoveredToolsHint', { count: discoveredTools.length })}</div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => updateMcpServer(server.id, (current) => ({
                                        ...current,
                                        toolsText: serializeTools(discoveredTools),
                                      }))}
                                      className="px-2 py-1 text-xs rounded border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                                    >
                                      {t('settings.externalMcpUseAllDiscoveredTools')}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => updateMcpServer(server.id, (current) => ({
                                        ...current,
                                        toolsText: '',
                                      }))}
                                      className="px-2 py-1 text-xs rounded border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                                    >
                                      {t('settings.externalMcpClearToolSelection')}
                                    </button>
                                  </div>
                                </div>
                                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                  {discoveredTools.map((toolName) => (
                                    <label key={toolName} className="inline-flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                                      <input
                                        type="checkbox"
                                        checked={selectedTools.has(toolName)}
                                        onChange={(event) => updateMcpServer(server.id, (current) => ({
                                          ...current,
                                          toolsText: toggleToolSelection(current.toolsText, toolName, event.target.checked),
                                        }))}
                                        className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500"
                                      />
                                      <span className="break-all">{toolName}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-slate-500">Remote publication trust level</label>
                            <select
                              value={server.trustLevel}
                              onChange={(event) => updateMcpServer(server.id, (current) => ({
                                ...current,
                                trustLevel: normalizeManagedClientExternalMcpTrustLevel(event.target.value),
                              }))}
                              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-slate-600"
                            >
                              <option value="trusted">trusted</option>
                              <option value="internal-reviewed">internal-reviewed</option>
                              <option value="experimental">experimental</option>
                              <option value="blocked">blocked</option>
                            </select>
                          </div>
                          <div className="space-y-1 flex items-end">
                            <label className="inline-flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 w-full">
                              <input
                                type="checkbox"
                                checked={server.publishedRemotely}
                                onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, publishedRemotely: event.target.checked }))}
                                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500"
                              />
                              <span>Publish tools to remote managed-client session</span>
                            </label>
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
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1 md:col-span-2">
                                  <label className="block text-xs text-slate-500">{t('settings.externalMcpCommand')}</label>
                                  <Input
                                    value={server.command}
                                    onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, command: event.target.value }))}
                                    placeholder="npx"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-xs text-slate-500">{t('settings.externalMcpArgs')}</label>
                                  <textarea
                                    value={server.argsText}
                                    onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, argsText: event.target.value }))}
                                    rows={4}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-xs text-slate-500">{t('settings.externalMcpCwd')}</label>
                                  <Input
                                    value={server.cwd}
                                    onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, cwd: event.target.value }))}
                                    placeholder="C:\\path\\to\\workspace"
                                  />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                  <label className="block text-xs text-slate-500">{t('settings.externalMcpEnv')}</label>
                                  <textarea
                                    value={server.envText}
                                    onChange={(event) => updateMcpServer(server.id, (current) => ({ ...current, envText: event.target.value }))}
                                    rows={4}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
                                    placeholder="API_KEY=value"
                                  />
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {testResult && (
                          <div className={`rounded-md border px-3 py-2 text-xs ${testResult.success
                            ? 'border-green-900 bg-green-950/30 text-green-300'
                            : 'border-amber-900 bg-amber-950/30 text-amber-200'
                            }`}>
                            {testResult.success
                              ? t('settings.externalMcpTestSuccess', { toolCount: testResult.toolCount })
                              : testResult.blockedReason
                                ? t('settings.externalMcpTestBlocked', {
                                  reason: getBlockedReasonText(testResult.blockedReason),
                                  required: t(`builtInTools.permissionProfile.${testResult.requiredPermissionProfile}`),
                                  current: t(`builtInTools.permissionProfile.${currentPermissionProfile}`),
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}