import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';

export interface ActivityEntry {
  id: string;
  timestamp: string;
  area: string;
  action: string;
  summary: string;
  status: 'success' | 'info' | 'error';
  details?: Record<string, unknown>;
}

class ActivityLogger {
  private entries: ActivityEntry[] = [];
  private filePath = '';
  private initialized = false;

  init(): void {
    if (this.initialized) {
      return;
    }

    this.filePath = path.join(app.getPath('userData'), 'activities.jsonl');
    this.loadExisting();
    this.initialized = true;
  }

  private loadExisting(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }

      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      this.entries = lines.map((line) => JSON.parse(line) as ActivityEntry);
    } catch {
      this.entries = [];
    }
  }

  appendEntry(entry: ActivityEntry): void {
    this.init();
    this.entries.push(entry);

    try {
      fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
    } catch {
      // Preserve the in-memory record even if persistence fails.
    }
  }

  private filterEntries(search?: string): ActivityEntry[] {
    this.init();

    if (!search) {
      return this.entries;
    }

    const query = search.toLowerCase();
    return this.entries.filter((entry) => {
      const detailsText = entry.details ? JSON.stringify(entry.details).toLowerCase() : '';
      return entry.area.toLowerCase().includes(query)
        || entry.action.toLowerCase().includes(query)
        || entry.summary.toLowerCase().includes(query)
        || detailsText.includes(query);
    });
  }

  getEntries(options?: { offset?: number; limit?: number; search?: string }): {
    entries: ActivityEntry[];
    total: number;
  } {
    const filtered = this.filterEntries(options?.search);
    const total = filtered.length;
    const sorted = [...filtered].reverse();
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;

    return {
      entries: sorted.slice(offset, offset + limit),
      total,
    };
  }
}

export const activityLogger = new ActivityLogger();