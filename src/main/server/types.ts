// ── Client → Server messages ──

export interface ExecuteMessage {
  type: 'execute';
  command: string;
  cwd?: string;
  interactive?: boolean;
}

export interface StdinMessage {
  type: 'stdin';
  data: string;
}

export interface KillMessage {
  type: 'kill';
  signal?: NodeJS.Signals;
}

export type ClientMessage = ExecuteMessage | StdinMessage | KillMessage;

// ── Server → Client messages ──

export interface StartedMessage {
  type: 'started';
  pid: number;
}

export interface StdoutMessage {
  type: 'stdout';
  data: string;
}

export interface StderrMessage {
  type: 'stderr';
  data: string;
}

export interface ExitMessage {
  type: 'exit';
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | StartedMessage
  | StdoutMessage
  | StderrMessage
  | ExitMessage
  | ErrorMessage;

// ── Audit log entry ──

export interface AuditEntry {
  id: string;
  timestamp: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  clientIp: string;
}

// ── Machine info ──

export interface MachineInfo {
  os: string;
  platform: NodeJS.Platform;
  arch: string;
  hostname: string;
  homedir: string;
  shell: string;
  path: string;
  uptime: number;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
}

// ── Server status (for IPC) ──

export interface ServerStatus {
  running: boolean;
  port: number;
  activeConnections: number;
}
