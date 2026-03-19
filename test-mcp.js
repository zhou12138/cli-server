// Quick MCP integration test
const http = require('http');

const PORT = 19876;
let messagesUrl = '';
let sseReq;

function sseConnect() {
  return new Promise((resolve, reject) => {
    sseReq = http.request(
      { hostname: 'localhost', port: PORT, path: '/mcp/sse', method: 'GET', headers: { Accept: 'text/event-stream' } },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const m = buf.match(/event: endpoint\ndata: (.+)\n/);
          if (m) {
            messagesUrl = m[1];
            resolve(messagesUrl);
          }
        });
      },
    );
    sseReq.on('error', reject);
    sseReq.end();
    setTimeout(() => reject(new Error('SSE connect timeout')), 5000);
  });
}

function postMessage(msg) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(msg);
    const req = http.request(
      { hostname: 'localhost', port: PORT, path: messagesUrl, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, data }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('1. Connecting to SSE...');
  await sseConnect();
  console.log('   Messages URL:', messagesUrl);

  console.log('2. Sending initialize...');
  const initResult = await postMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  console.log('   Init response:', initResult.status, initResult.data.slice(0, 200));

  console.log('3. Sending initialized notification...');
  await postMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });

  console.log('4. Listing tools...');
  const toolsResult = await postMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  console.log('   Tools response:', toolsResult.status);

  // Wait for SSE to deliver responses
  await new Promise((r) => setTimeout(r, 1000));

  console.log('5. Creating session (echo hello)...');
  const createResult = await postMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'session_create',
      arguments: { command: 'echo hello from mcp' },
    },
  });
  console.log('   Create response:', createResult.status);

  await new Promise((r) => setTimeout(r, 2000));

  console.log('6. Listing sessions...');
  const listResult = await postMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'session_list',
      arguments: {},
    },
  });
  console.log('   List response:', listResult.status);

  await new Promise((r) => setTimeout(r, 1000));

  console.log('\nDone! All MCP calls returned successfully.');
  sseReq.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
