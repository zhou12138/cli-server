export interface ShellExecuteSecurityConfig {
  enabled: boolean;
  allowedExecutableNames: string[];
  allowedWorkingDirectories: string[];
  allowPipes: boolean;
  allowRedirection: boolean;
  allowNetworkCommands: boolean;
  allowInlineScripts: boolean;
  allowPathsOutsideWorkspace: boolean;
  sandboxExecution: boolean;
  maxCommandLength: number;
  maxTimeoutSeconds: number;
}

export interface FileReadSecurityConfig {
  enabled: boolean;
  allowRelativePaths: boolean;
  allowedPaths: string[];
  maxBytesPerRead: number;
  maxFileSizeBytes: number;
}

export interface ManagedMcpServerAdminSecurityConfig {
  enabled: boolean;
  allowHttpServers: boolean;
  allowStdioServers: boolean;
  sandboxStdioServers: boolean;
  allowedStdioServerCommands: string[];
}

export type BuiltInToolsPermissionProfile = 'command-only' | 'interactive-trusted' | 'full-local-admin';
export type ExternalMcpAccessBlockedReason = 'profile-too-low' | 'transport-blocked';
export type ManagedClientToolResultMode = 'status-only' | 'handle' | 'full';

export interface BuiltInToolsSecurityConfig {
  permissionProfile: BuiltInToolsPermissionProfile;
  shellExecute: ShellExecuteSecurityConfig;
  fileRead: FileReadSecurityConfig;
  managedMcpServerAdmin: ManagedMcpServerAdminSecurityConfig;
}

export const DEFAULT_BUILT_IN_TOOLS_PERMISSION_PROFILE: BuiltInToolsPermissionProfile = 'command-only';

const PERMISSION_PROFILE_ORDER: BuiltInToolsPermissionProfile[] = ['command-only', 'interactive-trusted', 'full-local-admin'];
const COMMAND_ONLY_DESKTOP_TOOL_NAMES = new Set(['shell_execute']);
const INTERACTIVE_TRUSTED_DESKTOP_TOOL_NAMES = new Set(['shell_execute', 'session_create', 'session_stdin', 'session_wait']);
const FULL_LOCAL_ADMIN_DESKTOP_TOOL_NAMES = new Set([
  'shell_execute',
  'file_read',
  'remote_configure_mcp_server',
  'session_create',
  'session_stdin',
  'session_wait',
  'session_read_output',
]);

export function getBuiltInToolsSecurityConfigForProfile(
  permissionProfile: BuiltInToolsPermissionProfile,
): BuiltInToolsSecurityConfig {
  switch (permissionProfile) {
    case 'command-only':
      return {
        permissionProfile,
        shellExecute: {
          enabled: true,
          allowedExecutableNames: [],
          allowedWorkingDirectories: [],
          allowPipes: false,
          allowRedirection: false,
          allowNetworkCommands: false,
          allowInlineScripts: false,
          allowPathsOutsideWorkspace: false,
          sandboxExecution: true,
          maxCommandLength: 1000,
          maxTimeoutSeconds: 30,
        },
        fileRead: {
          enabled: false,
          allowRelativePaths: false,
          allowedPaths: [],
          maxBytesPerRead: 32 * 1024,
          maxFileSizeBytes: 1 * 1024 * 1024,
        },
        managedMcpServerAdmin: {
          enabled: false,
          allowHttpServers: false,
          allowStdioServers: false,
          sandboxStdioServers: true,
          allowedStdioServerCommands: [],
        },
      };
    case 'interactive-trusted':
      return {
        permissionProfile,
        shellExecute: {
          enabled: true,
          allowedExecutableNames: [],
          allowedWorkingDirectories: [],
          allowPipes: true,
          allowRedirection: true,
          allowNetworkCommands: false,
          allowInlineScripts: false,
          allowPathsOutsideWorkspace: false,
          sandboxExecution: true,
          maxCommandLength: 2000,
          maxTimeoutSeconds: 120,
        },
        fileRead: {
          enabled: false,
          allowRelativePaths: false,
          allowedPaths: [],
          maxBytesPerRead: 32 * 1024,
          maxFileSizeBytes: 1 * 1024 * 1024,
        },
        managedMcpServerAdmin: {
          enabled: false,
          allowHttpServers: false,
          allowStdioServers: false,
          sandboxStdioServers: true,
          allowedStdioServerCommands: [],
        },
      };
    case 'full-local-admin':
      return {
        permissionProfile,
        shellExecute: {
          enabled: true,
          allowedExecutableNames: [],
          allowedWorkingDirectories: [],
          allowPipes: true,
          allowRedirection: true,
          allowNetworkCommands: true,
          allowInlineScripts: true,
          allowPathsOutsideWorkspace: true,
          sandboxExecution: false,
          maxCommandLength: 4000,
          maxTimeoutSeconds: 120,
        },
        fileRead: {
          enabled: true,
          allowRelativePaths: true,
          allowedPaths: [],
          maxBytesPerRead: 64 * 1024,
          maxFileSizeBytes: 2 * 1024 * 1024,
        },
        managedMcpServerAdmin: {
          enabled: true,
          allowHttpServers: true,
          allowStdioServers: true,
          sandboxStdioServers: false,
          allowedStdioServerCommands: [],
        },
      };
    default:
      return getBuiltInToolsSecurityConfigForProfile(DEFAULT_BUILT_IN_TOOLS_PERMISSION_PROFILE);
  }
}

export function normalizeBuiltInToolsPermissionProfile(value: unknown): BuiltInToolsPermissionProfile {
  if (value === 'command-only' || value === 'interactive-trusted' || value === 'full-local-admin') {
    return value;
  }

  if (value === 'safe') {
    return 'command-only';
  }

  if (value === 'trusted') {
    return 'interactive-trusted';
  }

  return DEFAULT_BUILT_IN_TOOLS_PERMISSION_PROFILE;
}

export function getDefaultExternalMcpPermissionProfile(
  transport: 'http' | 'stdio',
): BuiltInToolsPermissionProfile {
  return 'full-local-admin';
}

export function normalizeExternalMcpPermissionProfile(
  value: unknown,
  transport: 'http' | 'stdio',
): BuiltInToolsPermissionProfile {
  if (value === 'command-only' || value === 'interactive-trusted' || value === 'full-local-admin') {
    return value;
  }

  if (value === 'safe') {
    return 'command-only';
  }

  if (value === 'trusted') {
    return 'interactive-trusted';
  }

  return getDefaultExternalMcpPermissionProfile(transport);
}

export function isPermissionProfileAtLeast(
  currentProfile: BuiltInToolsPermissionProfile,
  requiredProfile: BuiltInToolsPermissionProfile,
): boolean {
  return PERMISSION_PROFILE_ORDER.indexOf(currentProfile) >= PERMISSION_PROFILE_ORDER.indexOf(requiredProfile);
}

export function isShellAllowedForPermissionProfile(permissionProfile: BuiltInToolsPermissionProfile): boolean {
  return permissionProfile === 'command-only'
    || permissionProfile === 'interactive-trusted'
    || permissionProfile === 'full-local-admin';
}

export function isWorkspaceScopedPermissionProfile(permissionProfile: BuiltInToolsPermissionProfile): boolean {
  return permissionProfile !== 'full-local-admin';
}

export function isManagedMcpServerAdminAllowedForPermissionProfile(
  permissionProfile: BuiltInToolsPermissionProfile,
): boolean {
  return permissionProfile === 'full-local-admin';
}

export function isDesktopToolPublishedForPermissionProfile(
  permissionProfile: BuiltInToolsPermissionProfile,
  toolName: string,
): boolean {
  if (permissionProfile === 'command-only') {
    return COMMAND_ONLY_DESKTOP_TOOL_NAMES.has(toolName);
  }

  if (permissionProfile === 'interactive-trusted') {
    return INTERACTIVE_TRUSTED_DESKTOP_TOOL_NAMES.has(toolName);
  }

  return FULL_LOCAL_ADMIN_DESKTOP_TOOL_NAMES.has(toolName);
}

export function getManagedClientToolResultMode(
  permissionProfile: BuiltInToolsPermissionProfile,
  toolName: string,
  source: 'local' | 'external',
): ManagedClientToolResultMode {
  if (permissionProfile === 'full-local-admin') {
    return 'full';
  }

  if (source === 'external') {
    return 'status-only';
  }

  if (permissionProfile === 'interactive-trusted' && (toolName === 'session_create' || toolName === 'session_wait')) {
    return 'handle';
  }

  return 'status-only';
}

export function isExternalMcpTransportAllowedForPermissionProfile(
  permissionProfile: BuiltInToolsPermissionProfile,
  transport: 'http' | 'stdio',
): boolean {
  return permissionProfile === 'full-local-admin' && (transport === 'http' || transport === 'stdio');
}

export function getExternalMcpAccessDecision(
  permissionProfile: BuiltInToolsPermissionProfile,
  transport: 'http' | 'stdio',
  requiredPermissionProfile?: BuiltInToolsPermissionProfile,
): {
  allowed: boolean;
  requiredPermissionProfile: BuiltInToolsPermissionProfile;
  blockedReason?: ExternalMcpAccessBlockedReason;
} {
  const normalizedRequiredProfile = normalizeExternalMcpPermissionProfile(requiredPermissionProfile, transport);

  if (!isPermissionProfileAtLeast(permissionProfile, normalizedRequiredProfile)) {
    return {
      allowed: false,
      requiredPermissionProfile: normalizedRequiredProfile,
      blockedReason: 'profile-too-low',
    };
  }

  if (!isExternalMcpTransportAllowedForPermissionProfile(permissionProfile, transport)) {
    return {
      allowed: false,
      requiredPermissionProfile: normalizedRequiredProfile,
      blockedReason: 'transport-blocked',
    };
  }

  return {
    allowed: true,
    requiredPermissionProfile: normalizedRequiredProfile,
  };
}

export function applyPermissionProfileGuards(config: BuiltInToolsSecurityConfig): BuiltInToolsSecurityConfig {
  if (config.permissionProfile === 'command-only') {
    return {
      ...config,
      shellExecute: {
        ...config.shellExecute,
        allowPipes: false,
        allowRedirection: false,
        allowNetworkCommands: false,
        allowInlineScripts: false,
        allowPathsOutsideWorkspace: false,
        sandboxExecution: true,
      },
      fileRead: {
        ...config.fileRead,
        enabled: false,
        allowRelativePaths: false,
      },
      managedMcpServerAdmin: {
        enabled: false,
        allowHttpServers: false,
        allowStdioServers: false,
        sandboxStdioServers: true,
        allowedStdioServerCommands: config.managedMcpServerAdmin.allowedStdioServerCommands,
      },
    };
  }

  if (config.permissionProfile === 'interactive-trusted') {
    return {
      ...config,
      fileRead: {
        ...config.fileRead,
        enabled: false,
        allowRelativePaths: false,
      },
      shellExecute: {
        ...config.shellExecute,
        allowNetworkCommands: false,
        allowInlineScripts: false,
        allowPathsOutsideWorkspace: false,
        sandboxExecution: true,
      },
      managedMcpServerAdmin: {
        enabled: false,
        allowHttpServers: false,
        allowStdioServers: false,
        sandboxStdioServers: true,
        allowedStdioServerCommands: config.managedMcpServerAdmin.allowedStdioServerCommands,
      },
    };
  }

  return config;
}

export const DEFAULT_BUILT_IN_TOOLS_SECURITY_CONFIG = getBuiltInToolsSecurityConfigForProfile(
  DEFAULT_BUILT_IN_TOOLS_PERMISSION_PROFILE,
);