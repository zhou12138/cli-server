import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  DEFAULT_BUILT_IN_TOOLS_SECURITY_CONFIG,
  getBuiltInToolsSecurityConfigForProfile,
  type BuiltInToolsPermissionProfile,
  type BuiltInToolsSecurityConfig,
} from '../../main/builtin-tools/types';

interface BuiltInToolsFormState {
  permissionProfile: BuiltInToolsPermissionProfile;
  shellEnabled: boolean;
  shellBlockedCommands: string;
  shellBlockedWorkingDirectories: string;
  shellBlockedExecutableNames: string;
  shellBlockPipes: boolean;
  shellBlockRedirection: boolean;
  shellBlockNetworkCommands: boolean;
  shellMaxCommandLength: string;
  shellMaxTimeoutSeconds: string;
  fileReadEnabled: boolean;
  fileReadAllowRelativePaths: boolean;
  fileReadAllowedPaths: string;
  fileReadBlockedPaths: string;
  fileReadBlockedExtensions: string;
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
    shellBlockedCommands: listToText(normalized.shellExecute.blockedCommands),
    shellBlockedWorkingDirectories: listToText(normalized.shellExecute.blockedWorkingDirectories),
    shellBlockedExecutableNames: listToText(normalized.shellExecute.blockedExecutableNames),
    shellBlockPipes: normalized.shellExecute.blockPipes,
    shellBlockRedirection: normalized.shellExecute.blockRedirection,
    shellBlockNetworkCommands: normalized.shellExecute.blockNetworkCommands,
    shellMaxCommandLength: String(normalized.shellExecute.maxCommandLength),
    shellMaxTimeoutSeconds: String(normalized.shellExecute.maxTimeoutSeconds),
    fileReadEnabled: normalized.fileRead.enabled,
    fileReadAllowRelativePaths: normalized.fileRead.allowRelativePaths,
    fileReadAllowedPaths: listToText(normalized.fileRead.allowedPaths),
    fileReadBlockedPaths: listToText(normalized.fileRead.blockedPaths),
    fileReadBlockedExtensions: listToText(normalized.fileRead.blockedExtensions),
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
      blockedCommands: textToList(state.shellBlockedCommands),
      blockedWorkingDirectories: textToList(state.shellBlockedWorkingDirectories),
      blockedExecutableNames: textToList(state.shellBlockedExecutableNames),
      blockPipes: state.shellBlockPipes,
      blockRedirection: state.shellBlockRedirection,
      blockNetworkCommands: state.shellBlockNetworkCommands,
      maxCommandLength: Number(state.shellMaxCommandLength),
      maxTimeoutSeconds: Number(state.shellMaxTimeoutSeconds),
    },
    fileRead: {
      enabled: state.fileReadEnabled,
      allowRelativePaths: state.fileReadAllowRelativePaths,
      allowedPaths: textToList(state.fileReadAllowedPaths),
      blockedPaths: textToList(state.fileReadBlockedPaths),
      blockedExtensions: textToList(state.fileReadBlockedExtensions),
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

const PERMISSION_PROFILE_OPTIONS: BuiltInToolsPermissionProfile[] = ['command-only', 'interactive-trusted', 'full-local-admin'];

function getPermissionProfileSummaryKey(profile: BuiltInToolsPermissionProfile): string {
  switch (profile) {
    case 'command-only':
      return 'builtInTools.permissionProfileCommandOnlySummary';
    case 'full-local-admin':
      return 'builtInTools.permissionProfileFullLocalAdminSummary';
    case 'interactive-trusted':
    default:
      return 'builtInTools.permissionProfileInteractiveTrustedSummary';
  }
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

  useEffect(() => {
    window.electronAPI.getBuiltInToolsSecurityConfig()
      .then(({ config }) => {
        const normalized = normalizeConfig(config);
        setSavedConfig(normalized);
        setFormState(configToFormState(normalized));
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
  }, []);

  if (!formState) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-white">{t('builtInTools.title')}</h2>
        <p className="text-sm text-slate-400">{t('builtInTools.loading')}</p>
      </div>
    );
  }

  const isValid = [
    formState.shellMaxCommandLength,
    formState.shellMaxTimeoutSeconds,
    formState.fileReadMaxBytesPerRead,
    formState.fileReadMaxFileSizeBytes,
  ].every(isPositiveInteger);

  const currentConfig = isValid ? formStateToConfig(formState) : null;
  const isDirty = !!savedConfig && !!currentConfig && JSON.stringify(savedConfig) !== JSON.stringify(currentConfig);
  const profileDefaults = getBuiltInToolsSecurityConfigForProfile(formState.permissionProfile);
  const hasProfileOverrides = !!currentConfig && JSON.stringify(profileDefaults) !== JSON.stringify(currentConfig);
  const fileReadControlsDisabled = formState.permissionProfile !== 'full-local-admin';
  const managedMcpAdminControlsDisabled = formState.permissionProfile !== 'full-local-admin';

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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">{t('builtInTools.title')}</h2>
          <p className="mt-1 text-sm text-slate-400">{t('builtInTools.description')}</p>
        </div>
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

      {message && (
        <div className={`text-sm ${message.type === 'error' ? 'text-red-400' : 'text-green-400'}`}>
          {message.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('builtInTools.permissionProfileTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-400">{t('builtInTools.permissionProfileDescription')}</p>
          <div className="grid gap-3 md:grid-cols-3">
            {PERMISSION_PROFILE_OPTIONS.map((profile) => {
              const selected = formState.permissionProfile === profile;
              return (
                <button
                  key={profile}
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setFormState(configToFormState(getBuiltInToolsSecurityConfigForProfile(profile)));
                  }}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${selected
                    ? 'border-blue-500 bg-blue-500/10 text-white'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'
                    }`}
                >
                  <div className="text-sm font-medium">{t(`builtInTools.permissionProfile.${profile}`)}</div>
                  <div className="mt-1 text-xs text-slate-400">{t(getPermissionProfileSummaryKey(profile))}</div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">{hasProfileOverrides ? t('builtInTools.permissionProfileOverridesActive') : t('builtInTools.permissionProfileNoOverrides')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('builtInTools.shellTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <label className="block text-xs text-slate-500">{t('builtInTools.shellBlockedCommands')}</label>
            <textarea
              value={formState.shellBlockedCommands}
              onChange={(event) => setFormState((current) => current ? { ...current, shellBlockedCommands: event.target.value } : current)}
              rows={6}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder="rm -rf\nshutdown\nformat"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('builtInTools.shellBlockedDirectories')}</label>
            <textarea
              value={formState.shellBlockedWorkingDirectories}
              onChange={(event) => setFormState((current) => current ? { ...current, shellBlockedWorkingDirectories: event.target.value } : current)}
              rows={4}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder="C:/Windows\nC:/Users/Admin/Desktop/Secrets"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('builtInTools.shellBlockedExecutables')}</label>
            <textarea
              value={formState.shellBlockedExecutableNames}
              onChange={(event) => setFormState((current) => current ? { ...current, shellBlockedExecutableNames: event.target.value } : current)}
              rows={4}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder="powershell\ncurl\nssh"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.shellBlockPipes}
                onChange={(event) => setFormState((current) => current ? { ...current, shellBlockPipes: event.target.checked } : current)}
              />
              {t('builtInTools.shellBlockPipes')}
            </label>
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.shellBlockRedirection}
                onChange={(event) => setFormState((current) => current ? { ...current, shellBlockRedirection: event.target.checked } : current)}
              />
              {t('builtInTools.shellBlockRedirection')}
            </label>
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={formState.shellBlockNetworkCommands}
                onChange={(event) => setFormState((current) => current ? { ...current, shellBlockNetworkCommands: event.target.checked } : current)}
              />
              {t('builtInTools.shellBlockNetworkCommands')}
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('builtInTools.fileReadTitle')}</CardTitle>
        </CardHeader>
        <CardContent className={`space-y-4 ${fileReadControlsDisabled ? 'opacity-60' : ''}`}>
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
            <label className="block text-xs text-slate-500">{t('builtInTools.fileReadAllowedPaths')}</label>
            <textarea
              value={formState.fileReadAllowedPaths}
              onChange={(event) => setFormState((current) => current ? { ...current, fileReadAllowedPaths: event.target.value } : current)}
              rows={4}
              disabled={fileReadControlsDisabled}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder="C:/workspace\nC:/Users/me/Documents"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('builtInTools.fileReadBlockedPaths')}</label>
            <textarea
              value={formState.fileReadBlockedPaths}
              onChange={(event) => setFormState((current) => current ? { ...current, fileReadBlockedPaths: event.target.value } : current)}
              rows={5}
              disabled={fileReadControlsDisabled}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder="C:/Windows/System32\nC:/Users/Admin/.ssh"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-500">{t('builtInTools.fileReadBlockedExtensions')}</label>
            <textarea
              value={formState.fileReadBlockedExtensions}
              onChange={(event) => setFormState((current) => current ? { ...current, fileReadBlockedExtensions: event.target.value } : current)}
              rows={4}
              disabled={fileReadControlsDisabled}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-slate-600"
              placeholder=".pem\n.key\n.env"
            />
          </div>
        </CardContent>
      </Card>

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

      {!isValid && <div className="text-sm text-red-400">{t('builtInTools.invalidConfig')}</div>}
    </div>
  );
}