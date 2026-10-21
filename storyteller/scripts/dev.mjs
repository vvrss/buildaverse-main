// Runs the API server (restarting on changes) and Vite together for development.
// Vite proxies /api, /media and the share pages to the server on :8787.
import { spawn } from 'node:child_process';

const children = [
  spawn('npx', ['tsx', 'watch', 'server/main.ts'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '8787', HOST: '127.0.0.1', DATA_DIR: process.env.DATA_DIR ?? '.dev-data' },
  }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => code && stop());
