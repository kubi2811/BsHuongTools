// Công cụ GHI QUY TRÌNH (Phase 0): mở Playwright codegen trên Edge tới HIS.
// Bác sĩ thao tác 1 ca thật -> codegen tự sinh code + selector thật để ta viết workflow.
import { spawn } from 'node:child_process';
import { config } from '../src/config.js';

const url = config.hisUrl;
console.log('🎬 Mở Playwright codegen (Edge) tới:', url);
console.log('   Thao tác trọn vẹn 1 ca, code sinh ra sẽ hiện trong cửa sổ Inspector.');

const child = spawn(
  'npx',
  ['playwright', 'codegen', '--channel', 'msedge', '--target', 'playwright-test', url],
  { stdio: 'inherit', shell: true }
);

child.on('exit', (code) => process.exit(code ?? 0));
