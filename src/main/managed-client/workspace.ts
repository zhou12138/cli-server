import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ManagedClientWorkspacePaths {
  rootDir: string;
  currentDir: string;
  archiveDir: string;
  archivedRunDir: string | null;
  archiveWarning: string | null;
}

export function getDefaultManagedClientWorkspaceRoot(baseDir = process.cwd()): string {
  return path.resolve(baseDir, 'managed-client-workspace');
}

export function getManagedClientWorkspacePaths(rootDir: string): ManagedClientWorkspacePaths {
  const resolvedRootDir = path.resolve(rootDir);
  return {
    rootDir: resolvedRootDir,
    currentDir: path.join(resolvedRootDir, 'current'),
    archiveDir: path.join(resolvedRootDir, 'archive'),
    archivedRunDir: null,
    archiveWarning: null,
  };
}

function getArchiveFolderName(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `run-${timestamp}`;
}

function canSkipWorkspaceArchive(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

export function prepareManagedClientWorkspace(rootDir: string): ManagedClientWorkspacePaths {
  const { rootDir: resolvedRootDir, currentDir, archiveDir } = getManagedClientWorkspacePaths(rootDir);

  fs.mkdirSync(resolvedRootDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  let archivedRunDir: string | null = null;
  let archiveWarning: string | null = null;

  if (fs.existsSync(currentDir)) {
    const existingEntries = fs.readdirSync(currentDir);
    if (existingEntries.length > 0) {
      archivedRunDir = path.join(archiveDir, getArchiveFolderName());
      try {
        fs.renameSync(currentDir, archivedRunDir);
      } catch (error) {
        if (!canSkipWorkspaceArchive(error)) {
          throw error;
        }

        archivedRunDir = null;
        archiveWarning = `Skipping managed workspace archive because current directory is locked: ${error.message}`;
      }
    }
  }

  fs.mkdirSync(currentDir, { recursive: true });

  return {
    rootDir: resolvedRootDir,
    currentDir,
    archiveDir,
    archivedRunDir,
    archiveWarning,
  };
}