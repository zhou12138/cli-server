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

  getEntries(options?: { offset?: number; limit?: number; search?: string }): {
    entries: AuditEntry[];
    total: number;
  } {
    this.init();
    let filtered = this.entries;

    if (options?.search) {
      const q = options.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.command.toLowerCase().includes(q) ||
          e.stdout.toLowerCase().includes(q) ||
          e.stderr.toLowerCase().includes(q),
      );
    }

    const total = filtered.length;
    // Return in reverse chronological order
    const sorted = [...filtered].reverse();
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const entries = sorted.slice(offset, offset + limit);

    return { entries, total };
  }

  getEntry(id: string): AuditEntry | undefined {
    this.init();
    return this.entries.find((e) => e.id === id);
  }
}

export const auditLogger = new AuditLogger();
