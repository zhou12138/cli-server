import { Router } from 'express';
import * as os from 'node:os';
import type { MachineInfo } from './types';

export function createHttpRoutes(): Router {
  const router = Router();

  router.get('/info', (_req, res) => {
    const info: MachineInfo = {
      os: `${os.type()} ${os.release()}`,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      homedir: os.homedir(),
      shell: process.env.SHELL || process.env.COMSPEC || '',
      sessionShell: os.platform() === 'win32' ? 'powershell' : 'sh',
      path: process.env.PATH || '',
      uptime: os.uptime(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
    };
    res.json(info);
  });

  return router;
}
