import { randomUUID } from 'node:crypto';
import type { SessionManager } from '../session/manager';
import { auditLogger } from '../audit/logger';
import { emitServerEvent } from '../server';
import { executeManagedClientTask } from './command-runner';
import type {
  ManagedClientCompletionRequest,
  ManagedClientRecord,
  ManagedClientRegisterRequest,
  ManagedClientRuntimeConfig,
  ManagedClientTask,
} from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stringifyForAudit(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > 10_000 ? `${text.slice(0, 10_000)}...` : text;
  } catch {
    return String(value);
  }
}

export class ManagedClientRuntime {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private client: ManagedClientRecord | null = null;

  constructor(
    private readonly config: ManagedClientRuntimeConfig,
    private readonly sessionManager: SessionManager,
  ) {}

  start(): void {
    if (!this.config.enabled || this.running) {
      return;
    }

    if (!this.config.baseUrl) {
      throw new Error('Managed client runtime requires MANAGED_CLIENT_BASE_URL');
    }

    this.running = true;
    this.abortController = new AbortController();
    this.loopPromise = this.runLoop(this.abortController.signal);
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

  async stopAndWait(): Promise<void> {
    this.stop();
    await this.loopPromise?.catch(() => undefined);
  }

  getStatus(): { enabled: boolean; running: boolean; clientId: string | null; baseUrl: string | null } {
    return {
      enabled: this.config.enabled,
      running: this.running,
      clientId: this.client?.client_id ?? null,
      baseUrl: this.config.baseUrl,
    };
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    this.appendAuditEntry(
      '[managed-client] runtime start',
      {
        baseUrl: this.config.baseUrl,
        clientName: this.config.clientName,
        headless: this.config.headless,
        supportedCommands: this.config.supportedCommands,
      },
      0,
    );

    emitServerEvent('managed-client:starting', {
      baseUrl: this.config.baseUrl,
      clientName: this.config.clientName,
      headless: this.config.headless,
    });

    while (!signal.aborted) {
      try {
        if (!this.client) {
          this.client = await this.register(signal);
          this.appendAuditEntry(
            '[managed-client] register success',
            {
              clientId: this.client.client_id,
              clientName: this.client.client_name,
              userId: this.client.user_id,
              status: this.client.status,
              baseUrl: this.config.baseUrl,
            },
            0,
          );
          emitServerEvent('managed-client:registered', {
            clientId: this.client.client_id,
            clientName: this.client.client_name,
          });
        }

        const task = await this.pollNextTask(this.client.client_id, signal);
        if (!task) {
          await this.heartbeat(this.client.client_id, signal);
          continue;
        }

        this.appendAuditEntry(
          `[managed-client] task received: ${task.command_name}`,
          {
            taskId: task.task_id,
            clientId: task.client_id,
            taskType: task.task_type,
            commandName: task.command_name,
            payload: task.payload,
            timeoutSeconds: task.timeout_seconds,
            startedAt: task.started_at,
          },
          0,
        );

        emitServerEvent('managed-client:task:started', {
          clientId: task.client_id,
          taskId: task.task_id,
          commandName: task.command_name,
        });

        const execution = await executeManagedClientTask(task, this.sessionManager);
        const completion: ManagedClientCompletionRequest = {
          client_id: task.client_id,
          success: execution.success,
          result: execution.result,
          error: execution.error,
        };

        await this.completeTask(task.task_id, completion, signal);
        this.appendAuditEntry(
          `[managed-client] task completed: ${task.command_name}`,
          {
            taskId: task.task_id,
            clientId: task.client_id,
            success: execution.success,
            result: execution.result,
            error: execution.error,
          },
          execution.success ? 0 : 1,
          execution.success ? '' : execution.error ?? 'Task execution failed',
        );
        emitServerEvent('managed-client:task:completed', {
          clientId: task.client_id,
          taskId: task.task_id,
          success: execution.success,
        });
      } catch (error) {
        if (signal.aborted) {
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.appendAuditEntry('[managed-client] error', '', 1, message);
        emitServerEvent('managed-client:error', { message });
        this.client = null;
        await sleep(this.config.retryDelayMs);
      }
    }

    this.running = false;
    this.appendAuditEntry('[managed-client] runtime stopped', '', 0);
    emitServerEvent('managed-client:stopped');
  }

  private appendAuditEntry(command: string, stdout: unknown, exitCode: number | null, stderr = ''): void {
    const now = new Date().toISOString();
    auditLogger.appendEntry({
      id: randomUUID(),
      timestamp: now,
      command,
      cwd: this.config.baseUrl ?? '',
      exitCode,
      signal: null,
      stdout: stringifyForAudit(stdout),
      stderr,
      durationMs: 0,
      clientIp: 'managed-client',
    });
  }

  private async register(signal: AbortSignal): Promise<ManagedClientRecord> {
    const body: ManagedClientRegisterRequest = {
      client_name: this.config.clientName,
      capabilities: {
        commands: this.config.supportedCommands,
      },
      metadata: {
        platform: process.platform,
        version: this.config.version,
      },
    };

    return this.requestJson<ManagedClientRecord>('/client-runtime/register', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    });
  }

  private async heartbeat(clientId: string, signal: AbortSignal): Promise<void> {
    await this.request('/client-runtime/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId }),
      signal,
    });

    emitServerEvent('managed-client:heartbeat', { clientId });
  }

  private async pollNextTask(clientId: string, signal: AbortSignal): Promise<ManagedClientTask | null> {
    const search = new URLSearchParams({
      client_id: clientId,
      wait_seconds: String(this.config.pollWaitSeconds),
    });
    const response = await this.request(`/client-runtime/tasks/next?${search.toString()}`, {
      method: 'GET',
      signal,
    });

    if (response.status === 204) {
      this.appendAuditEntry(
        '[managed-client] poll next task: no task',
        {
          clientId,
          waitSeconds: this.config.pollWaitSeconds,
          status: 204,
        },
        0,
      );
      return null;
    }

    const task = await response.json() as ManagedClientTask;
    this.appendAuditEntry(
      '[managed-client] poll next task: task assigned',
      {
        clientId,
        waitSeconds: this.config.pollWaitSeconds,
        status: response.status,
        taskId: task.task_id,
        commandName: task.command_name,
      },
      0,
    );

    return task;
  }

  private async completeTask(taskId: string, completion: ManagedClientCompletionRequest, signal: AbortSignal): Promise<void> {
    await this.request(`/client-runtime/tasks/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify(completion),
      signal,
    });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return response.json() as Promise<T>;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (response.status === 401 || response.status === 404) {
      this.client = null;
    }

    if (!response.ok && response.status !== 204) {
      const text = await response.text();
      throw new Error(`Managed client request failed (${response.status}): ${text || response.statusText}`);
    }

    return response;
  }
}