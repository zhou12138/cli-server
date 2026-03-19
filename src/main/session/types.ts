// ── Session state ──

export type SessionState = 'running' | 'exited';

// ── Session info (public view) ──

export interface SessionInfo {
  sessionId: string;
  command: string;
  cwd: string;
  pid: number;
  state: SessionState;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  stdoutLength: number;
  stderrLength: number;
  clientIp: string;
}

// ── Wait conditions (OR semantics — at least one required) ──

export interface WaitConditions {
  exited?: boolean;
  timeout?: number; // ms
  idle?: number; // ms — no output for this long
}

export type WaitTrigger = 'exited' | 'timeout' | 'idle';

// ── Wait result ──

export interface WaitResult {
  triggered: WaitTrigger;
  state: SessionState;
  exitCode: number | null;
  stdoutLength: number;
  stderrLength: number;
  stdoutTail?: string;
  stderrTail?: string;
}

// ── Unified pagination ──

export interface Paged<T> {
  offset: number;
  limit: number;
  total: number;
  nextOffset: number | null;
  data: T;
}
