import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

const candidates = [
  isWin ? join(__dirname, '.venv', 'Scripts', 'python.exe') : join(__dirname, '.venv', 'bin', 'python'),
  ...(isWin ? ['py', 'python', 'python3'] : ['python3', 'python']),
];

function resolvePython() {
  for (const candidate of candidates) {
    if (candidate.includes('.venv') && !existsSync(candidate)) continue;
    const args = candidate === 'py' ? ['-3', '--version'] : ['--version'];
    const probe = spawnSync(candidate, args, { stdio: 'ignore' });
    if (probe.status === 0) {
      return candidate === 'py' ? { cmd: 'py', prefix: ['-3'] } : { cmd: candidate, prefix: [] };
    }
  }
  return null;
}

const resolved = resolvePython();
if (!resolved) {
  console.error('[ERROR] Could not locate Python 3. Install Python 3.11+ or run install_dependencies.');
  process.exit(1);
}

const child = spawn(resolved.cmd, [...resolved.prefix, join(__dirname, 'server.py')], {
  cwd: __dirname,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
