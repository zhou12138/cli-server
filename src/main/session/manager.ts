import { EventEmitter } from 'node:events';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  SessionState,
  SessionInfo,
  IOEvent,
  WaitConditions,
  WaitResult,
  WaitTrigger,
  Paged,
} from './types';
import { auditLogger } from '../audit/logger';
import type { AuditEntry } from '../server/types';

const MAX_AUDIT_OUTPUT = 10_000;

interface InternalSession {
  sessionId: string;
  command: string;
  cwd: string;
  pid: number;
  state: SessionState;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  endedAt: string | null;
  stdout: string;
  stderr: string;
  ioEvents: IOEvent[];
  clientIp: string;
  process: ChildProcess | null;
  emitter: EventEmitter;
  lastOutputTime: number;
}

export class SessionManager {
  private sessions = new Map<string, InternalSession>();

  // ── Public API ──

  create(command: string, cwd?: string, clientIp = 'unknown', enableStdin = false, envOverride?: NodeJS.ProcessEnv): SessionInfo {
    const sessionId = randomUUID();
    const resolvedCwd = cwd || process.cwd();
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs =
      process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile', '-Command', command]
        : ['-c', command];

    const childProcess = spawn(shell, shellArgs, {
      cwd: resolvedCwd,
      env: envOverride ?? process.env,
      stdio: [enableStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    const emitter = new EventEmitter();
    const now = Date.now();

    const session: InternalSession = {
      sessionId,
      command,
      cwd: resolvedCwd,
      pid: childProcess.pid!,
      state: 'running',
      exitCode: null,
      signal: null,
      startedAt: new Date(now).toISOString(),
      endedAt: null,
      stdout: '',
      stderr: '',
      ioEvents: [],
      clientIp,
      process: childProcess,
      emitter,
      lastOutputTime: now,
    };

    childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      session.stdout += text;
      session.lastOutputTime = Date.now();
      session.ioEvents.push({ stream: 'stdout', time: session.lastOutputTime, data: text });
      emitter.emit('output', 'stdout', text);
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      session.stderr += text;
      session.lastOutputTime = Date.now();
      session.ioEvents.push({ stream: 'stderr', time: session.lastOutputTime, data: text });
      emitter.emit('output', 'stderr', text);
    });

    childProcess.on('close', (code, signal) => {
      session.state = 'exited';
      session.exitCode = code;
      session.signal = signal;
      session.endedAt = new Date().toISOString();
      session.process = null;
      emitter.emit('exit', code, signal);

      const entry: AuditEntry = {
        id: sessionId,
        timestamp: session.startedAt,
        command: session.command,
        cwd: session.cwd,
        exitCode: code,
        signal,
        stdout: session.stdout.slice(0, MAX_AUDIT_OUTPUT),
        stderr: session.stderr.slice(0, MAX_AUDIT_OUTPUT),
        ioEvents: session.ioEvents,
        durationMs: Date.now() - now,
        clientIp: session.clientIp,
      };
      auditLogger.appendEntry(entry);
    });

    childProcess.on('error', (err) => {
      emitter.emit('error', err);
    });

    this.sessions.set(sessionId, session);
    return this.toInfo(session);
  }

  writeStdin(sessionId: string, data: string, close = false): void {
    const session = this.getSession(sessionId);
    if (session.state !== 'running' || !session.process?.stdin?.writable) {
      throw new Error('Session stdin not available');
    }
    if (data) {
      session.process.stdin.write(data);
      session.ioEvents.push({ stream: 'stdin', time: Date.now(), data });
    }
    if (close) {
      session.process.stdin.end();
    }
  }

  kill(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (session.state !== 'running' || !session.process) {
      throw new Error('Session is not running');
    }
    const pid = session.process.pid;
    if (process.platform === 'win32' && pid) {
      // Kill entire process tree on Windows
      try {
        execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
      } catch {
        // taskkill may fail if process already exited
        session.process.kill('SIGKILL');
      }
    } else {
      session.process.kill('SIGTERM');
    }
  }

  readOutput(
    sessionId: string,
    stream: 'stdout' | 'stderr',
    offset = 0,
    limit = 4096,
  ): Paged<string> {
    const session = this.getSession(sessionId);
    const buffer = stream === 'stdout' ? session.stdout : session.stderr;
    const total = buffer.length;
    const clampedOffset = Math.min(offset, total);
    const slice = buffer.slice(clampedOffset, clampedOffset + limit);
    const end = clampedOffset + slice.length;

    return {
      offset: clampedOffset,
      limit,
      total,
      nextOffset: end < total ? end : null,
      data: slice,
    };
  }

  async wait(
    sessionId: string,
    conditions: WaitConditions,
    tailLength = 0,
  ): Promise<WaitResult> {
    const session = this.getSession(sessionId);

    // Already exited — resolve immediately
    if (session.state === 'exited') {
      if (conditions.exited) {
        return this.buildWaitResult('exited', session, tailLength);
      }
      if (conditions.idle) {
        return this.buildWaitResult('idle', session, tailLength);
      }
    }

    return new Promise<WaitResult>((resolve) => {
      let resolved = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      const done = (trigger: WaitTrigger) => {
        if (resolved) return;
        resolved = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (idleTimer) clearTimeout(idleTimer);
        session.emitter.removeListener('exit', onExit);
        session.emitter.removeListener('output', onOutput);
        resolve(this.buildWaitResult(trigger, session, tailLength));
      };

      const onExit = () => {
        if (conditions.exited) {
          done('exited');
        } else if (conditions.idle) {
          // Process exited — no more output will come; resolve idle immediately
          done('idle');
        }
      };

      const onOutput = () => {
        if (conditions.idle && !resolved) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => done('idle'), conditions.idle!);
        }
      };

      // Always listen for exit when exited or idle is requested —
      // an exited process will never produce more output.
      if (conditions.exited || conditions.idle) {
        session.emitter.on('exit', onExit);
      }

      if (conditions.idle) {
        session.emitter.on('output', onOutput);
        // Account for time already idle
        const elapsed = Date.now() - session.lastOutputTime;
        const remaining = Math.max(0, conditions.idle - elapsed);
        idleTimer = setTimeout(() => done('idle'), remaining);
      }

      if (conditions.timeout) {
        timeoutTimer = setTimeout(() => done('timeout'), conditions.timeout);
      }
    });
  }

  list(
    state: 'running' | 'exited' | 'all' = 'all',
    offset = 0,
    limit = 20,
  ): Paged<SessionInfo[]> {
    let sessions = Array.from(this.sessions.values());
    if (state !== 'all') {
      sessions = sessions.filter((s) => s.state === state);
    }
    sessions.reverse(); // reverse chronological
    const total = sessions.length;
    const slice = sessions.slice(offset, offset + limit);
    const end = offset + slice.length;

    return {
      offset,
      limit,
      total,
      nextOffset: end < total ? end : null,
      data: slice.map((s) => this.toInfo(s)),
    };
  }

  getInfo(sessionId: string): SessionInfo {
    return this.toInfo(this.getSession(sessionId));
  }

  readIOLog(sessionId: string): IOEvent[] {
    const session = this.getSession(sessionId);
    return session.ioEvents;
  }

  clearExited(): void {
    for (const [id, session] of this.sessions) {
      if (session.state === 'exited') {
        this.sessions.delete(id);
      }
    }
  }

  // ── Private helpers ──

  private getSession(sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  private toInfo(s: InternalSession): SessionInfo {
    return {
      sessionId: s.sessionId,
      command: s.command,
      cwd: s.cwd,
      pid: s.pid,
      state: s.state,
      exitCode: s.exitCode,
      signal: s.signal,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationMs: s.endedAt
        ? new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()
        : Date.now() - new Date(s.startedAt).getTime(),
      stdoutLength: s.stdout.length,
      stderrLength: s.stderr.length,
      clientIp: s.clientIp,
    };
  }

  private buildWaitResult(
    triggered: WaitTrigger,
    session: InternalSession,
    tailLength: number,
  ): WaitResult {
    const result: WaitResult = {
      triggered,
      state: session.state,
      exitCode: session.exitCode,
      stdoutLength: session.stdout.length,
      stderrLength: session.stderr.length,
    };
    if (tailLength > 0) {
      result.stdoutTail = session.stdout.slice(-tailLength);
      result.stderrTail = session.stderr.slice(-tailLength);
    }
    return result;
  }
}
