import type { ToolBinding } from './mcp-tool-registry';
import type { ManagedClientRuntimeConfig } from './types';

export type ManagedClientDefenseFindingCategory = 'identity' | 'instruction' | 'prompt' | 'tool' | 'response' | 'policy';
export type ManagedClientDefenseSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ManagedClientDefenseFinding {
  category: ManagedClientDefenseFindingCategory;
  severity: ManagedClientDefenseSeverity;
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ManagedClientToolCallDefenseContext {
  requestId: string;
  connectionId: string | null;
  toolName: string;
  argumentsPayload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  binding: ToolBinding;
  runtimeConfig: Pick<ManagedClientRuntimeConfig, 'baseUrl' | 'clientId' | 'clientName' | 'mode'>;
}

export interface ManagedClientToolResponseDefenseContext {
  requestId: string;
  connectionId: string | null;
  toolName: string;
  binding: ToolBinding;
  success: boolean;
  responseText: string;
  responseMode: 'full' | 'handle' | 'status-only' | 'error';
  rawResult?: Record<string, unknown>;
  runtimeConfig: Pick<ManagedClientRuntimeConfig, 'baseUrl' | 'clientId' | 'clientName' | 'mode'>;
}

export interface ManagedClientToolCallDefenseResult {
  allowed: boolean;
  argumentsPayload: Record<string, unknown>;
  findings: ManagedClientDefenseFinding[];
  code?: string;
  message?: string;
}

export interface ManagedClientToolResponseDefenseResult {
  allowed: boolean;
  responseText: string;
  findings: ManagedClientDefenseFinding[];
  code?: string;
  message?: string;
}

export interface ManagedClientDefenseLayer {
  inspectToolCall(context: ManagedClientToolCallDefenseContext): Promise<ManagedClientToolCallDefenseResult>;
  inspectToolResponse(context: ManagedClientToolResponseDefenseContext): Promise<ManagedClientToolResponseDefenseResult>;
}

class NoopManagedClientDefenseLayer implements ManagedClientDefenseLayer {
  async inspectToolCall(context: ManagedClientToolCallDefenseContext): Promise<ManagedClientToolCallDefenseResult> {
    return {
      allowed: true,
      argumentsPayload: context.argumentsPayload,
      findings: [],
    };
  }

  async inspectToolResponse(context: ManagedClientToolResponseDefenseContext): Promise<ManagedClientToolResponseDefenseResult> {
    return {
      allowed: true,
      responseText: context.responseText,
      findings: [],
    };
  }
}

export function createManagedClientDefenseLayer(_config: ManagedClientRuntimeConfig): ManagedClientDefenseLayer {
  return new NoopManagedClientDefenseLayer();
}