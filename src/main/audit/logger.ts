import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { AuditEntry } from '../server/types';

class AuditLogger {
  private entries: AuditEntry[] = [];
  private filePath: string;
  private initialized = false;

  constructor() {
    // Will be set properly once app is ready
    this.filePath = '';
  }

  init(): void {
    if (this.initialized) return;
    this.filePath = path.join(app.getPath('userData'), 'audit.jsonl');
    this.loadExisting();
    this.initialized = true;
  }

  private loadExisting(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      this.entries = lines.map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      // If file is corrupted, start fresh
      this.entries = [];
    }
  }

  appendEntry(entry: AuditEntry): void {
    this.init();
    this.entries.push(entry);
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // Silently fail write — entry is still in memory
    }
  }

  private filterEntries(search?: string): AuditEntry[] {
    this.init();

    if (!search) {
      return this.entries;
    }

    const q = search.toLowerCase();
    return this.entries.filter(
      (e) =>
        e.command.toLowerCase().includes(q)
        || e.stdout.toLowerCase().includes(q)
        || e.stderr.toLowerCase().includes(q),
    );
  }

  getEntries(options?: { offset?: number; limit?: number; search?: string }): {
    entries: AuditEntry[];
    total: number;
  } {
    const filtered = this.filterEntries(options?.search);

    const total = filtered.length;
    // Return in reverse chronological order
    const sorted = [...filtered].reverse();
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const entries = sorted.slice(offset, offset + limit);

    return { entries, total };
  }

  exportEntries(search?: string): { fileName: string; content: string; total: number } {
    const filtered = [...this.filterEntries(search)].reverse();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    return {
      fileName: `audit-log-${timestamp}.jsonl`,
      content: filtered.map((entry) => JSON.stringify(entry)).join('\n'),
      total: filtered.length,
    };
  }

  getEntry(id: string): AuditEntry | undefined {
    this.init();
    return this.entries.find((e) => e.id === id);
  }

  clear(): void {
    this.init();
    this.entries = [];
    try {
      fs.writeFileSync(this.filePath, '', 'utf-8');
    } catch {
      // Silently fail — memory is already cleared
    }
  }
}

export const auditLogger = new AuditLogger();
