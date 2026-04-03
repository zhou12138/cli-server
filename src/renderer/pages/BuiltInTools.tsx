import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import PermissionProfileSummary from '../components/PermissionProfileSummary';
import type { ManagedClientBootstrapState } from '../../preload';
import {
  DEFAULT_BUILT_IN_TOOLS_SECURITY_CONFIG,
  getBuiltInToolsSecurityConfigForProfile,
  type BuiltInToolsPermissionProfile,
  type BuiltInToolsSecurityConfig,
} from '../../main/builtin-tools/types';

interface BuiltInToolsFormState {
  permissionProfile: BuiltInToolsPermissionProfile;
  shellEnabled: boolean;
  shellAllowedExecutableNames: string;
  shellAllowedWorkingDirectories: string;
  shellAllowPipes: boolean;
  shellAllowRedirection: boolean;
  shellAllowNetworkCommands: boolean;
  shellMaxCommandLength: string;
  shellMaxTimeoutSeconds: string;
  fileReadEnabled: boolean;
  fileReadAllowRelativePaths: boolean;
  fileReadAllowedPaths: string;
  fileReadMaxBytesPerRead: string;
  fileReadMaxFileSizeBytes: string;
  managedMcpServerAdminEnabled: boolean;
  managedMcpServerAdminAllowHttpServers: boolean;
  managedMcpServerAdminAllowStdioServers: boolean;
}

function listToText(values: string[]): string {
  return values.join('\n');
}

function textToList(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

const SHELL_ALLOWED_EXECUTABLE_TEMPLATE = [
  'git',
  'node',
  'npm',
  'npx',
  'python',
  'python3',
];

function getRecommendedReadRoots(workspaceRoot: string, workspaceCurrentDir: string): string[] {
  const roots = [workspaceCurrentDir, workspaceRoot]
    .map((entry) => entry.trim())
    .filter(Boolean);

  return Array.from(new Set(roots));
}

function normalizeConfig(config: Partial<BuiltInToolsSecurityConfig> | null | undefined): BuiltInToolsSecurityConfig {
  const permissionProfile = config?.permissionProfile ?? DEFAULT_BUILT_IN_TOOLS_SECURITY_CONFIG.permissionProfile;
  const defaults = getBuiltInToolsSecurityConfigForProfile(permissionProfile);

  return {
    permissionProfile,
    shellExecute: {
      ...defaults.shellExecute,
      ...(config?.shellExecute ?? {}),
    },
    fileRead: {
      ...defaults.fileRead,
      ...(config?.fileRead ?? {}),
    },
    managedMcpServerAdmin: {
      ...defaults.managedMcpServerAdmin,
      ...(config?.managedMcpServerAdmin ?? {}),
    },
  };
}

function configToFormState(config: BuiltInToolsSecurityConfig): BuiltInToolsFormState {
  const normalized = normalizeConfig(config);

  return {
    permissionProfile: normalized.permissionProfile,
    shellEnabled: normalized.shellExecute.enabled,
    shellAllowedExecutableNames: listToText(normalized.shellExecute.allowedExecutableNames),
    shellAllowedWorkingDirectories: listToText(normalized.shellExecute.allowedWorkingDirectories),
    shellAllowPipes: normalized.shellExecute.allowPipes,
    shellAllowRedirection: normalized.shellExecute.allowRedirection,
    shellAllowNetworkCommands: normalized.shellExecute.allowNetworkCommands,
    shellMaxCommandLength: String(normalized.shellExecute.maxCommandLength),
    shellMaxTimeoutSeconds: String(normalized.shellExecute.maxTimeoutSeconds),
    fileReadEnabled: normalized.fileRead.enabled,
    fileReadAllowRelativePaths: normalized.fileRead.allowRelativePaths,
    fileReadAllowedPaths: listToText(normalized.fileRead.allowedPaths),
    fileReadMaxBytesPerRead: String(normalized.fileRead.maxBytesPerRead),
    fileReadMaxFileSizeBytes: String(normalized.fileRead.maxFileSizeBytes),
    managedMcpServerAdminEnabled: normalized.managedMcpServerAdmin.enabled,
    managedMcpServerAdminAllowHttpServers: normalized.managedMcpServerAdmin.allowHttpServers,
    managedMcpServerAdminAllowStdioServers: normalized.managedMcpServerAdmin.allowStdioServers,
  };
}

function formStateToConfig(state: BuiltInToolsFormState): BuiltInToolsSecurityConfig {
  return {
    permissionProfile: state.permissionProfile,
    shellExecute: {
      enabled: state.shellEnabled,
      allowedExecutableNames: textToList(state.shellAllowedExecutableNames),
      allowedWorkingDirectories: textToList(state.shellAllowedWorkingDirectories),
      allowPipes: state.shellAllowPipes,
      allowRedirection: state.shellAllowRedirection,
      allowNetworkCommands: state.shellAllowNetworkCommands,
      maxCommandLength: Number(state.shellMaxCommandLength),
      maxTimeoutSeconds: Number(state.shellMaxTimeoutSeconds),
    },
    fileRead: {
      enabled: state.fileReadEnabled,
      allowRelativePaths: state.fileReadAllowRelativePaths,
      allowedPaths: textToList(state.fileReadAllowedPaths),
      maxBytesPerRead: Number(state.fileReadMaxBytesPerRead),
      maxFileSizeBytes: Number(state.fileReadMaxFileSizeBytes),
    },
    managedMcpServerAdmin: {
      enabled: state.managedMcpServerAdminEnabled,
      allowHttpServers: state.managedMcpServerAdminAllowHttpServers,
      allowStdioServers: state.managedMcpServerAdminAllowStdioServers,
    },
  };
}

function isPositiveInteger(value: string): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

export default function BuiltInTools() {
  const { t } = useI18n();
  const [formState, setFormState] = useState<BuiltInToolsFormState | null>(null);
  const [savedConfig, setSavedConfig] = useState<BuiltInToolsSecurityConfig | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [managedClientMode, setManagedClientMode] = useState<ManagedClientBootstrapState['mode']>('cli-server');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [workspaceCurrentDir, setWorkspaceCurrentDir] = useState('');

  useEffect(() => {
    Promise.all([
      window.electronAPI.getBuiltInToolsSecurityConfig(),
      window.electronAPI.getManagedClientBootstrapState(),
    ])
      .then(([{ config }, bootstrapState]) => {
        const normalized = normalizeConfig(config);
        setSavedConfig(normalized);
        setFormState(configToFormState(normalized));
        setManagedClientMode(bootstrapState.mode);
        setWorkspaceRoot(bootstrapState.workspaceRoot);
        setWorkspaceCurrentDir(bootstrapState.workspaceCurrentDir);
      })
      .catch((error) => {
        const fallback = normalizeConfig(DEFAULT_BUILT_IN_TOOLS_SECURITY_CONFIG);
        setSavedConfig(fallback);
        setFormState(configToFormState(fallback));
        setMessage({
          type: 'error',
          text: t('builtInTools.loadFailed', { error: String(error) }),
        });
      });

    const unsub = window.electronAPI.onServerEvent(async () => {
      const bootstrapState = await window.electronAPI.getManagedClientBootstrapState();
      setManagedClientMode(bootstrapState.mode);
      setWorkspaceRoot(bootstrapState.workspaceRoot);
      setWorkspaceCurrentDir(bootstrapState.workspaceCurrentDir);
    });

    return unsub;
  }, []);

  if (!formState) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-white">{t('builtInTools.title')}</h2>
        <p className="text-sm text-slate-400">{t('builtInTools.loading')}</p>
      </div>
    );
  }

  const hasValidNumericLimits = [
    formState.shellMaxCommandLength,
    formState.shellMaxTimeoutSeconds,
    formState.fileReadMaxBytesPerRead,
    formState.fileReadMaxFileSizeBytes,
  ].every(isPositiveInteger);

  const validationErrors: string[] = [];
  if (!hasValidNumericLimits) {
    validationErrors.push(t('builtInTools.invalidNumericConfig'));
  }
  if (managedClientMode === 'managed-client-mcp-ws' && formState.shellEnabled && textToList(formState.shellAllowedExecutableNames).length === 0) {
    validationErrors.push(t('builtInTools.shellAllowlistRequiredManagedMcpWs'));
  }
  if (formState.permissionProfile === 'full-local-admin' && formState.fileReadEnabled && textToList(formState.fileReadAllowedPaths).length === 0) {
    validationErrors.push(t('builtInTools.fileReadAllowlistRequiredFullLocalAdmin'));
  }

  const isValid = validationErrors.length === 0;
  const isManagedMcpWsMode = managedClientMode === 'managed-client-mcp-ws';

  const currentConfig = isValid ? formStateToConfig(formState) : null;
  const isDirty = !!savedConfig && !!currentConfig && JSON.stringify(savedConfig) !== JSON.stringify(currentConfig);
  const profileDefaults = getBuiltInToolsSecurityConfigForProfile(formState.permissionProfile);
  const fileReadControlsDisabled = isManagedMcpWsMode && formState.permissionProfile !== 'full-local-admin';
  const managedMcpAdminControlsDisabled = formState.permissionProfile !== 'full-local-admin';

  const applyRecommendedExecutables = () => {
    setFormState((current) => current ? {
      ...current,
      shellAllowedExecutableNames: listToText(SHELL_ALLOWED_EXECUTABLE_TEMPLATE),
    } : current);
  };

  const applyRecommendedReadRoots = () => {
    const recommendedRoots = getRecommendedReadRoots(workspaceRoot, workspaceCurrentDir);
    setFormState((current) => current ? {
      ...current,
      fileReadAllowedPaths: listToText(recommendedRoots),
    } : current);
  };

  const handleSave = async () => {
    if (!currentConfig) {
      setMessage({ type: 'error', text: t('builtInTools.invalidConfig') });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await window.electronAPI.saveBuiltInToolsSecurityConfig({ config: currentConfig });
      setSavedConfig(result.config);
      setFormState(configToFormState(result.config));
      window.dispatchEvent(new Event('managed-client:built-in-tools-config-changed'));
      setMessage({
        type: result.applied || result.reason === 'runtime-inactive' || result.reason === 'bridge-not-ready' || result.reason === 'republish-pending'
          ? 'success'
          : 'error',
        text: result.applied
          ? t('builtInTools.saveApplied', { toolCount: result.toolCount })
          : result.reason === 'runtime-inactive'
            ? t('builtInTools.savePendingPublishRuntimeInactive')
            : result.reason === 'republish-pending'
              ? t('builtInTools.savePendingPublishRepublishPending')
            : t('builtInTools.savePendingPublishBridgeNotReady'),
      });
    } catch (error) {
      setMessage({ type: 'error', text: t('builtInTools.saveFailed', { error: String(error) }) });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setMessage(null);
    setFormState(configToFormState(getBuiltInToolsSecurityConfigForProfile(formState.permissionProfile)));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">{t('builtInTools.title')}</h2>
          <p className="mt-1 text-sm text-slate-400">{t('builtInTools.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={handleSave}
            disabled={!isDirty || !isValid || saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t('builtInTools.saving') : t('builtInTools.save')}
          </button>
          <button
            onClick={handleReset}
            disabled={saving}
            className="px-4 py-2 text-sm bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('builtInTools.resetDefaults')}
          </button>
        </div>
      </div>

      {message && (
        <div className={`text-sm ${message.type === 'error' ? 'text-red-400' : 'text-green-400'}`}>
          {message.text}
        </div>
      )}

      {isManagedMcpWsMode && (
        <Card>
          <CardHeader>
            <CardTitle>{t('builtInTools.currentPermissionProfileTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PermissionProfileSummary
              title={t('builtInTools.currentPermissionProfileTitle')}
              description={t('builtInTools.currentPermissionProfileDescription')}
              currentLabel={t('builtInTools.currentPermissionProfileLabel')}
              currentProfile={formState.permissionProfile}
              currentProfileLabel={t(`builtInTools.permissionProfile.${formState.permissionProfile}`)}
              linkLabel={t('builtInTools.openPermissionsPage')}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('builtInTools.shellTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500">{t('builtInTools.shellAllowlistHint')}</p>
          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={formState.shellEnabled}
              onChange={(event) => setFormState((current) => current ? { ...current, shellEnabled: event.target.checked } : current)}
            />
            {t('builtInTools.enabled')}
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs text-slate-500">{t('builtInTools.shellMaxCommandLength')}</label>
              <Input
                value={formState.shellMaxCommandLength}
                onChange={(event) => setFormState((current) => current ? { ...current, shellMaxCommandLength: event.target.value } : current)}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-slate-500">{t('builtInTools.shellMaxTimeoutSeconds')}</label>
              <Input
                value={formState.shellMaxTimeoutSeconds}
                onChange={(event) => setFormState((current) => current ? { ...current, shellMaxTimeoutSeconds: event.target.value } : current)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500" title={t('builtInTools.allowlistTooltip')}>
              {t('builtInTools.shellAllowedExecutables')}
            </label>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={applyRecommendedExecutables}
                className="px-2.5 py-1 text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 transition-colors"
              >
                {t('builtInTools.useRecommendedTemplate')}
              </button>
            </div>
            <textarea
              value={formState.shellAllowedExecutableNames}
              onChange={(event) => setFormState((current) => current ? { ...current, shellAllowedExecutableNames: event.target.value } : current)}
              rows={4}
              title={t('builtInTools.allowlistTooltip')}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder="git\nnode\npython"
            />
            <p className="text-xs text-slate-500">{t('builtInTools.shellRecommendedTemplateHint')}</p>
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500" title={t('builtInTools.allowlistTooltip')}>
              {t('builtInTools.shellAllowedDirectories')}
            </label>
            <textarea
              value={formState.shellAllowedWorkingDirectories}
              onChange={(event) => setFormState((current) => current ? { ...current, shellAllowedWorkingDirectories: event.target.value } : current)}
              rows={4}
              title={t('builtInTools.allowlistTooltip')}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder="C:/workspace\nC:/repo"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.shellAllowPipes}
                onChange={(event) => setFormState((current) => current ? { ...current, shellAllowPipes: event.target.checked } : current)}
              />
              {t('builtInTools.shellAllowPipes')}
            </label>
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.shellAllowRedirection}
                onChange={(event) => setFormState((current) => current ? { ...current, shellAllowRedirection: event.target.checked } : current)}
              />
              {t('builtInTools.shellAllowRedirection')}
            </label>
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.shellAllowNetworkCommands}
                onChange={(event) => setFormState((current) => current ? { ...current, shellAllowNetworkCommands: event.target.checked } : current)}
              />
              {t('builtInTools.shellAllowNetworkCommands')}
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('builtInTools.fileReadTitle')}</CardTitle>
        </CardHeader>
        <CardContent className={`space-y-4 ${fileReadControlsDisabled ? 'opacity-60' : ''}`}>
          <p className="text-xs text-slate-500">{t('builtInTools.fileReadAllowlistHint')}</p>
          {fileReadControlsDisabled && (
            <p className="text-xs text-slate-500">{t('builtInTools.fileReadProfileRestricted')}</p>
          )}
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.fileReadEnabled}
                onChange={(event) => setFormState((current) => current ? { ...current, fileReadEnabled: event.target.checked } : current)}
                disabled={fileReadControlsDisabled}
              />
              {t('builtInTools.enabled')}
            </label>
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.fileReadAllowRelativePaths}
                onChange={(event) => setFormState((current) => current ? { ...current, fileReadAllowRelativePaths: event.target.checked } : current)}
                disabled={fileReadControlsDisabled}
              />
              {t('builtInTools.allowRelativePaths')}
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs text-slate-500">{t('builtInTools.fileReadMaxBytesPerRead')}</label>
              <Input
                value={formState.fileReadMaxBytesPerRead}
                onChange={(event) => setFormState((current) => current ? { ...current, fileReadMaxBytesPerRead: event.target.value } : current)}
                disabled={fileReadControlsDisabled}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-slate-500">{t('builtInTools.fileReadMaxFileSizeBytes')}</label>
              <Input
                value={formState.fileReadMaxFileSizeBytes}
                onChange={(event) => setFormState((current) => current ? { ...current, fileReadMaxFileSizeBytes: event.target.value } : current)}
                disabled={fileReadControlsDisabled}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500" title={t('builtInTools.allowlistTooltip')}>
              {t('builtInTools.fileReadAllowedPaths')}
            </label>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={applyRecommendedReadRoots}
                disabled={fileReadControlsDisabled}
                className="px-2.5 py-1 text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('builtInTools.useRecommendedTemplate')}
              </button>
            </div>
            <textarea
              value={formState.fileReadAllowedPaths}
              onChange={(event) => setFormState((current) => current ? { ...current, fileReadAllowedPaths: event.target.value } : current)}
              rows={4}
              disabled={fileReadControlsDisabled}
              title={t('builtInTools.allowlistTooltip')}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder="C:/workspace\nC:/Users/me/Documents"
            />
            <p className="text-xs text-slate-500">{t('builtInTools.fileReadRecommendedTemplateHint')}</p>
          </div>
        </CardContent>
      </Card>

      {isManagedMcpWsMode && (
        <Card>
          <CardHeader>
            <CardTitle>{t('builtInTools.managedMcpServerAdminTitle')}</CardTitle>
          </CardHeader>
          <CardContent className={`space-y-4 ${managedMcpAdminControlsDisabled ? 'opacity-60' : ''}`}>
            <p className="text-sm text-slate-400">{t('builtInTools.managedMcpServerAdminDescription')}</p>
            {managedMcpAdminControlsDisabled && (
              <p className="text-xs text-slate-500">{t('builtInTools.managedMcpServerAdminProfileRestricted')}</p>
            )}
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.managedMcpServerAdminEnabled}
                onChange={(event) => setFormState((current) => current ? { ...current, managedMcpServerAdminEnabled: event.target.checked } : current)}
                disabled={managedMcpAdminControlsDisabled}
              />
              {t('builtInTools.enabled')}
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-3 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={formState.managedMcpServerAdminAllowHttpServers}
                  onChange={(event) => setFormState((current) => current ? { ...current, managedMcpServerAdminAllowHttpServers: event.target.checked } : current)}
                  disabled={managedMcpAdminControlsDisabled || !formState.managedMcpServerAdminEnabled}
                />
                {t('builtInTools.managedMcpServerAdminAllowHttpServers')}
              </label>
              <label className="flex items-center gap-3 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={formState.managedMcpServerAdminAllowStdioServers}
                  onChange={(event) => setFormState((current) => current ? { ...current, managedMcpServerAdminAllowStdioServers: event.target.checked } : current)}
                  disabled={managedMcpAdminControlsDisabled || !formState.managedMcpServerAdminEnabled}
                />
                {t('builtInTools.managedMcpServerAdminAllowStdioServers')}
              </label>
            </div>
            <p className="text-xs text-slate-500">{t('builtInTools.managedMcpServerAdminNote')}</p>
          </CardContent>
        </Card>
      )}

      {!isValid && (
        <div className="space-y-1 text-sm text-red-400">
          {validationErrors.map((entry) => (
            <div key={entry}>{entry}</div>
          ))}
        </div>
      )}
    </div>
  );
}