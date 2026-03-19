const { spawn } = require('child_process');

const p = spawn('powershell.exe', [
  '-NoLogo', '-NoProfile', '-Command',
  'workiq ask -q "Who are my direct reports?"'
], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
  cwd: process.cwd(),
});

p.stdout.on('data', (d) => console.log('OUT:', d.toString()));
p.stderr.on('data', (d) => console.log('ERR:', d.toString()));
p.on('close', (code) => console.log('EXIT:', code));

setTimeout(() => {
  console.log('TIMEOUT 45s - killing');
  p.kill();
}, 45000);
