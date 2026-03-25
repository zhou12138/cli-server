import { readFile } from 'node:fs/promises';
import type { SessionManager } from '../session/manager';
import type { ManagedClientTask, ManagedClientTaskResult } from './types';

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${field}`);
  }

  return value;
}

async function runCommandTask(task: ManagedClientTask, sessionManager: SessionManager): Promise<ManagedClientTaskResult> {
  const command = asString(task.payload.command, 'payload.command');
  const cwd = typeof task.payload.cwd === 'string' ? task.payload.cwd : undefined;
  const session = sessionManager.create(command, cwd, 'managed-client', false);
  const timeoutMs = Math.max(1, task.timeout_seconds || 120) * 1000;

  const waitResult = await sessionManager.wait(session.sessionId, {
    exited: true,
    timeout: timeoutMs,
  });

  if (waitResult.triggered === 'timeout' && waitResult.state === 'running') {
    sessionManager.kill(session.sessionId);
    await sessionManager.wait(session.sessionId, {
      exited: true,
      timeout: 5000,
    });
    return {
      success: false,
      error: `Command timed out after ${task.timeout_seconds || 120} seconds`,
    };
  }

  const info = sessionManager.getInfo(session.sessionId);
  const stdout = sessionManager.readOutput(session.sessionId, 'stdout', 0, Math.max(info.stdoutLength, 1)).data;
  const stderr = sessionManager.readOutput(session.sessionId, 'stderr', 0, Math.max(info.stderrLength, 1)).data;

  return {
    success: true,
    result: {
      stdout,
      stderr,
      exit_code: info.exitCode,
      signal: info.signal,
      cwd: info.cwd,
    },
  };
}

async function readFileTask(task: ManagedClientTask): Promise<ManagedClientTaskResult> {
  const filePath = asString(task.payload.path, 'payload.path');
  const encoding = typeof task.payload.encoding === 'string' ? task.payload.encoding : 'utf-8';
  const maxBytes = typeof task.payload.max_bytes === 'number' && task.payload.max_bytes > 0
    ? Math.floor(task.payload.max_bytes)
    : 64 * 1024;
  const buffer = await readFile(filePath);
  const limited = buffer.subarray(0, maxBytes);

  return {
    success: true,
    result: {
      path: filePath,
      encoding,
      content: limited.toString(encoding as BufferEncoding),
      bytes: limited.byteLength,
      truncated: buffer.byteLength > limited.byteLength,
    },
  };
}

export async function executeManagedClientTask(
  task: ManagedClientTask,
  sessionManager: SessionManager,
): Promise<ManagedClientTaskResult> {
  switch (task.command_name) {
    case 'run_command':
      return runCommandTask(task, sessionManager);
    case 'read_file':
      return readFileTask(task);
    default:
      return {
        success: false,
        error: `Unsupported command_name: ${task.command_name}`,
      };
  }
}