import pathModule from 'node:path';

/**
 * Environment variable name patterns that are stripped in sandbox mode.
 * These match tokens, keys, secrets, credentials, and other sensitive values
 * that a sandboxed process should not inherit.
 */
const SENSITIVE_ENV_PATTERNS = [
  /^AWS_/i,
  /^AZURE_/i,
  /^GH_/i,
  /^GITHUB_/i,
  /^GITLAB_/i,
  /^NPM_TOKEN$/i,
  /^NODE_AUTH_TOKEN$/i,
  /^NUGET_/i,
  /^DOCKER_/i,
  /^KUBECONFIG$/i,
  /^KUBE_/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /PRIVATE_KEY/i,
  /API_KEY/i,
  /^SSH_AUTH_SOCK$/i,
  /^GPG_/i,
];

/**
 * Environment variable names that are always preserved in sandbox mode,
 * even if they match a sensitive pattern above.
 * These are needed for basic shell/runtime functionality.
 */
const SAFE_ENV_ALLOWLIST = new Set([
  // Essential for executables
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'COMSPEC',
  'WINDIR',
  // Shell functionality
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  // Runtime essentials
  'NODE_ENV',
  'PYTHONDONTWRITEBYTECODE',
  'PYTHONUNBUFFERED',
  // Process identity (non-sensitive)
  'USER',
  'USERNAME',
  'LOGNAME',
  'HOSTNAME',
  // Display (needed for some tools)
  'DISPLAY',
  'WAYLAND_DISPLAY',
]);

/**
 * Build a restricted environment for sandboxed process execution.
 *
 * - Strips env vars matching sensitive patterns (tokens, keys, secrets, passwords)
 * - Preserves essential vars needed for shell/runtime functionality
 * - Overrides HOME/USERPROFILE and TMPDIR/TEMP/TMP to point inside the workspace
 */
export function buildSandboxEnv(workspaceDirectory: string): NodeJS.ProcessEnv {
  const baseEnv = process.env;
  const filtered: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;

    // Always keep safe-listed vars
    if (SAFE_ENV_ALLOWLIST.has(key.toUpperCase())) {
      filtered[key] = value;
      continue;
    }

    // Strip vars matching sensitive patterns
    const isSensitive = SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      continue;
    }

    filtered[key] = value;
  }

  // Override home directory to workspace
  const sandboxHome = workspaceDirectory;
  filtered['HOME'] = sandboxHome;
  filtered['USERPROFILE'] = sandboxHome;

  // Override temp directories to workspace-local path
  const sandboxTmp = pathModule.join(workspaceDirectory, '.sandbox-tmp');
  filtered['TMPDIR'] = sandboxTmp;
  filtered['TEMP'] = sandboxTmp;
  filtered['TMP'] = sandboxTmp;

  return filtered;
}
