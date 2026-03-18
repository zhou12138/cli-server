const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:19876');

let step = 0;

ws.on('open', () => {
  console.log('[OPEN] Connected');
  ws.send(JSON.stringify({
    type: 'execute',
    command: 'python -i',
    interactive: true,
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log(`[${msg.type.toUpperCase()}]`, msg.data || msg.pid || JSON.stringify(msg));

  if (msg.type === 'stdout' && msg.data.includes('>>>')) {
    step++;
    switch (step) {
      case 1:
        console.log('\n--- Sending: print("hello world") ---');
        ws.send(JSON.stringify({ type: 'stdin', data: 'print("hello world")\n' }));
        break;
      case 2:
        console.log('\n--- Sending: 2 + 3 ---');
        ws.send(JSON.stringify({ type: 'stdin', data: '2 + 3\n' }));
        break;
      case 3:
        console.log('\n--- Sending: kill ---');
        ws.send(JSON.stringify({ type: 'kill' }));
        break;
    }
  }

  if (msg.type === 'exit') {
    console.log('\n[DONE] Process exited. code:', msg.code, 'signal:', msg.signal);
  }
});

ws.on('close', (code) => {
  console.log('[CLOSED]', code);
  clearTimeout(timer);
  process.exit(0);
});

ws.on('error', (err) => {
  console.log('[ERROR]', err.message);
});

const timer = setTimeout(() => {
  console.log('[TIMEOUT] after 30s');
  ws.send(JSON.stringify({ type: 'kill' }));
  setTimeout(() => { ws.close(); process.exit(1); }, 2000);
}, 30000);
