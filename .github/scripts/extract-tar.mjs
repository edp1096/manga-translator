import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Git Bash's GNU tar treats a Windows drive letter as a remote archive host.
export function extractTar(archive, destination, members = []) {
  const tar = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe')
    : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', destination, ...members], { stdio: 'inherit' });
}
