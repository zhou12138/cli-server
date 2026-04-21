const http = require('http');
const https = require('https');

class LandGod {
  /**
   * @param {string} serverUrl - Gateway HTTP API URL, e.g. 'http://localhost:8081'
   * @param {object} [options]
   * @param {string} [options.adminToken] - Admin token for token management APIs
   * @param {number} [options.timeout] - Default timeout in ms (default: 30000)
   */
  constructor(serverUrl, options = {}) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.adminToken = options.adminToken || null;
    this.defaultTimeout = options.timeout || 30000;
  }

  // ========================
  // 连接管理
  // ========================

  /** 列出所有在线 Worker */
  async clients() {
    const resp = await this._get('/clients');
    return resp.clients;
  }

  /** Gateway 健康检查 */
  async health() {
    return this._get('/health');
  }

  /** 等待指定设备上线 */
  async waitFor(name, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const clients = await this.clients();
      const found = clients.find(c => c.clientName === name && c.connected);
      if (found) return found;
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(`Timeout waiting for device '${name}' to come online`);
  }

  // ========================
  // 命令执行
  // ========================

  /** 在指定 Worker 执行命令 */
  async execute(command, options = {}) {
    const { target, timeout } = options;
    const body = {
      tool_name: 'shell_execute',
      arguments: { command },
      timeout: timeout || this.defaultTimeout,
    };
    if (target) {
      const conn = await this._resolveTarget(target);
      body.connection_id = conn;
    }
    const resp = await this._post('/tool_call', body);
    return this._parseToolResult(resp);
  }

  /** 读取远程文件 */
  async readFile(path, options = {}) {
    const { target, timeout } = options;
    const body = {
      tool_name: 'file_read',
      arguments: { path },
      timeout: timeout || this.defaultTimeout,
    };
    if (target) body.connection_id = await this._resolveTarget(target);
    return this._post('/tool_call', body);
  }

  /** 调用任意工具 */
  async toolCall(toolName, args = {}, options = {}) {
    const { target, timeout } = options;
    const body = {
      tool_name: toolName,
      arguments: args,
      timeout: timeout || this.defaultTimeout,
    };
    if (target) body.connection_id = await this._resolveTarget(target);
    return this._post('/tool_call', body);
  }

  // ========================
  // 批量操作
  // ========================

  /** 在所有 Worker 上执行同一命令 */
  async broadcast(command, options = {}) {
    const clients = await this.clients();
    const tasks = clients
      .filter(c => c.connected)
      .map(c => this.execute(command, { target: c.clientName, ...options })
        .then(result => ({ device: c.clientName, ...result }))
        .catch(error => ({ device: c.clientName, error: error.message }))
      );
    return Promise.all(tasks);
  }

  /** 并行分发不同命令到不同 Worker */
  async map(taskList) {
    const tasks = taskList.map(task =>
      this.execute(task.command, { target: task.target, timeout: task.timeout })
        .then(result => ({ device: task.target, ...result }))
        .catch(error => ({ device: task.target, error: error.message }))
    );
    return Promise.all(tasks);
  }

  // ========================
  // MCP 管理
  // ========================

  /** 远程安装 MCP Server 到指定 Worker */
  async installMcp(name, config, options = {}) {
    return this.toolCall('remote_configure_mcp_server', {
      name,
      transport: config.transport || 'stdio',
      command: config.command,
      args: config.args || [],
      env: config.env || {},
    }, options);
  }

  /** 列出指定 Worker 的工具 */
  async listTools(target) {
    // Tools are reported during connection, query from server
    const clients = await this.clients();
    const client = clients.find(c => c.clientName === target);
    if (!client) throw new Error(`Device '${target}' not found`);
    return this._get(`/clients/${client.connectionId}/tools`).catch(() => {
      return { message: 'Tool list API not yet implemented on server' };
    });
  }

  // ========================
  // Token 管理
  // ========================

  /** 创建新设备 Token */
  async createToken(deviceName) {
    return this._post('/tokens', { device_name: deviceName });
  }

  /** 列出所有 Token */
  async listTokens() {
    return this._get('/tokens');
  }

  /** 吊销 Token */
  async revokeToken(token) {
    return this._delete(`/tokens/${token}`);
  }

  // ========================
  // 内部方法
  // ========================

  async _resolveTarget(nameOrConnId) {
    if (nameOrConnId.startsWith('conn-')) return nameOrConnId;
    const clients = await this.clients();
    const client = clients.find(c => c.clientName === nameOrConnId && c.connected);
    if (!client) throw new Error(`Device '${nameOrConnId}' not found or offline`);
    return client.connectionId;
  }

  _parseToolResult(resp) {
    if (resp.type === 'event' && resp.event === 'tool_error') {
      const err = resp.payload?.error || {};
      throw new Error(err.message || 'Tool execution failed');
    }
    if (resp.payload?.data?.text) {
      try {
        const inner = JSON.parse(resp.payload.data.text);
        return {
          stdout: inner.stdout || '',
          stderr: inner.stderr || '',
          exitCode: inner.exit_code ?? null,
          cwd: inner.cwd || '',
        };
      } catch {
        return { stdout: resp.payload.data.text, stderr: '', exitCode: null };
      }
    }
    return resp;
  }

  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.serverUrl + path);
      const lib = url.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;

      const req = lib.request(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.adminToken ? { 'Authorization': `Bearer ${this.adminToken}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: this.defaultTimeout,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  _get(path) { return this._request('GET', path); }
  _post(path, body) { return this._request('POST', path, body); }
  _delete(path) { return this._request('DELETE', path); }
}

// 同步包装（方便非 async 环境）
class LandGodSync {
  constructor(serverUrl, options = {}) {
    this._async = new LandGod(serverUrl, options);
  }

  clientsSync() { return this._runSync(this._async.clients()); }
  executeSync(cmd, opts) { return this._runSync(this._async.execute(cmd, opts)); }
  broadcastSync(cmd, opts) { return this._runSync(this._async.broadcast(cmd, opts)); }

  _runSync(promise) {
    const { execSync } = require('child_process');
    // Use a temp file approach for sync execution
    throw new Error('Sync methods require Node.js 22+ with top-level await. Use async API instead.');
  }
}

module.exports = { LandGod, LandGodSync };
