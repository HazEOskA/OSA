import { spawn } from 'node:child_process';
const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
build.on('exit', (code) => {
  if (code) process.exit(code);
  const app = spawn('npm', ['start'], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => app.kill(signal));
});
