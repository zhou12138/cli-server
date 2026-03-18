const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:19876');

ws.on('open', () => {
  console.log('[OPEN]', new Date().toISOString());
  ws.send(JSON.stringify({
    type: 'execute',
    command: 'workiq ask -q "check my first upcoming meeting"'
  }));
});

ws.on('message', (data) => {
  console.log('[MSG]', new Date().toISOString(), data.toString());
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
  console.log('[TIMEOUT] no response after 200s');
  ws.close();
  process.exit(1);
}, 200000);
