import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ManagedClientWorkspacePaths {
  rootDir: string;
  workDir: string;
}

function getDefaultWorkspaceBaseDir(): string {
  const mainModuleFilename = typeof require !== 'undefined' ? require.main?.filename : undefined;
  if (typeof mainModuleFilename === 'string' && mainModuleFilename.trim()) {
    return path.dirname(mainModuleFilename);
  }

  return process.cwd();
}

export function getDefaultManagedClientWorkspaceRoot(baseDir = getDefaultWorkspaceBaseDir()): string {
  return path.resolve(baseDir, 'managed-client-workspace');
}

export function getManagedClientWorkspacePaths(rootDir: string): ManagedClientWorkspacePaths {
  const resolvedRootDir = path.resolve(rootDir);
  return {
    rootDir: resolvedRootDir,
    workDir: resolvedRootDir,
  };
}

export function prepareManagedClientWorkspace(rootDir: string): ManagedClientWorkspacePaths {
  const { rootDir: resolvedRootDir, workDir } = getManagedClientWorkspacePaths(rootDir);

  fs.mkdirSync(resolvedRootDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  return {
    rootDir: resolvedRootDir,
    workDir,
  };
}