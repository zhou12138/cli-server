import { spawn, type ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { ClientMessage, ServerMessage, AuditEntry } from './types';
import { auditLogger } from '../audit/logger';

const MAX_AUDIT_OUTPUT = 10_000; // max chars stored per stream in audit

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function handleWebSocketConnection(ws: WebSocket, clientIp: string): void {
  let childProcess: ChildProcess | null = null;
  let executed = false;

  // Buffers for audit log
  let stdoutBuf = '';
  let stderrBuf = '';
  let startTime = 0;
  let command = '';
  let cwd = '';

  ws.on('message', (raw: Buffer | string) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'execute': {
        if (executed) {
          send(ws, { type: 'error', message: 'Command already executing on this connection' });
          return;
        }
        executed = true;
        command = msg.command;
        cwd = msg.cwd || process.cwd();
        startTime = Date.now();

        try {
          const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
          const shellArgs = process.platform === 'win32'
            ? ['-NoProfile', '-NonInteractive', '-Command', msg.command]
            : ['-c', msg.command];

          childProcess = spawn(shell, shellArgs, {
            cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch (err) {
          send(ws, { type: 'error', message: `Failed to spawn: ${err}` });
          ws.close();
          return;
        }

        send(ws, { type: 'started', pid: childProcess.pid! });

        childProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString('utf-8');
          stdoutBuf += text;
          send(ws, { type: 'stdout', data: text });
        });

        childProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString('utf-8');
          stderrBuf += text;
          send(ws, { type: 'stderr', data: text });
        });

        childProcess.on('error', (err) => {
          send(ws, { type: 'error', message: err.message });
        });

        childProcess.on('close', (code, signal) => {
          const entry: AuditEntry = {
            id: randomUUID(),
            timestamp: new Date(startTime).toISOString(),
            command,
            cwd,
            exitCode: code,
            signal: signal,
            stdout: stdoutBuf.slice(0, MAX_AUDIT_OUTPUT),
            stderr: stderrBuf.slice(0, MAX_AUDIT_OUTPUT),
            durationMs: Date.now() - startTime,
            clientIp,
          };
          auditLogger.appendEntry(entry);

          send(ws, { type: 'exit', code, signal });
          childProcess = null;
          ws.close();
        });

        break;
      }

      case 'stdin': {
        if (childProcess?.stdin?.writable) {
          childProcess.stdin.write(msg.data);
        } else {
          send(ws, { type: 'error', message: 'No process stdin available' });
        }
        break;
      }

      case 'kill': {
        if (childProcess) {
          childProcess.kill(msg.signal || 'SIGTERM');
        } else {
          send(ws, { type: 'error', message: 'No process to kill' });
        }
        break;
      }

      default:
        send(ws, { type: 'error', message: `Unknown message type: ${(msg as { type: string }).type}` });
    }
  });

  ws.on('close', () => {
    // Clean up: kill spawned process if still running
    if (childProcess) {
      childProcess.kill('SIGTERM');
      childProcess = null;
    }
  });
}
