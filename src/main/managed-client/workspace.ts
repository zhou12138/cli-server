import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ManagedClientWorkspacePaths {
  rootDir: string;
  workDir: string;
}

function getDefaultWorkspaceBaseDir(): string {
  const mainModuleFilename = typeof require !== 'undefined' ? require.main?.filename : undefined;
  if (typeof mainModuleFilename === 'string' && mainModuleFilename.trim()) {
    const normalizedMainModuleFilename = path.resolve(mainModuleFilename);
    const asarSegment = `${path.sep}app.asar`;
    const asarIndex = normalizedMainModuleFilename.toLowerCase().indexOf(asarSegment.toLowerCase());
    if (asarIndex >= 0) {
      return path.dirname(normalizedMainModuleFilename.slice(0, asarIndex + asarSegment.length));
    }

    return path.dirname(normalizedMainModuleFilename);
  }

  if (typeof process.execPath === 'string' && process.execPath.trim()) {
    return path.dirname(path.resolve(process.execPath));
  }

  return process.cwd();
}

export function getDefaultManagedClientWorkspaceRoot(baseDir = getDefaultWorkspaceBaseDir()): string {
  return path.resolve(baseDir, 'LandGod Worker');
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