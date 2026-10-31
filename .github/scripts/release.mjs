import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const [mode, ...args] = process.argv.slice(2);
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const run = (cmd, a, options = {}) => execFileSync(cmd, a, { stdio: 'inherit', ...options });
function assert(ok, message) { if (!ok) throw new Error(message); }
function version(source, tag) {
  assert(/^v\d+\.\d+\.\d+$/.test(tag), 'Expected an existing vX.Y.Z tag');
  const expected = tag.slice(1);
  const go = fs.readFileSync(path.join(source, 'control/internal/control/catalog.go'), 'utf8');
  assert(go.match(/\bVersion\s*=\s*"([^"]+)"/)?.[1] === expected, 'Controller version mismatch');
  for (const p of ['extension/manifest.json', 'control/web/package.json', 'control/web/package-lock.json']) {
    const value = read(path.join(source, p));
    assert(value.version === expected, `${p}: version mismatch`);
    if (value.packages) assert(value.packages[''].version === expected, 'Lockfile root mismatch');
  }
  return expected;
}
async function dependency(work, name, url, sha) {
  const archive = path.join(work, name);
  run('curl', ['--fail', '--location', '--retry', '5', '--connect-timeout', '30', '--max-time', '600', '--output', archive, url]);
  assert(hash(archive) === sha, `${name}: SHA256 mismatch`);
  if (name.endsWith('.zip')) run('unzip', ['-q', archive, '-d', work]);
  else run('tar', ['-xzf', archive, '-C', work]);
}
if (mode === 'version') {
  console.log(version(path.resolve(args[0]), args[1]));
} else if (mode === 'native') {
  const [sourceArg, platform, workArg] = args;
  const source = path.resolve(sourceArg), work = path.resolve(workArg);
  fs.mkdirSync(work, { recursive: true });
  const ort = read(path.join(source, 'control/internal/assets/bundle/catalog.json')).artifacts.find(a => a.id === `ort-${platform}`);
  assert(ort, `Missing ORT ${platform}`);
  const archive = new URL(ort.url).pathname.split('/').pop();
  await dependency(work, archive, ort.url, ort.sha256);
  await dependency(work, 'libwebp-1.6.0.tar.gz', 'https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz', 'e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564');
  await dependency(work, 'litert.tar.gz', 'https://codeload.github.com/google-ai-edge/LiteRT/tar.gz/refs/tags/v2.3.1', 'ce1656ee13c887ad7fa0954a0b1f04ee1a354560420ba64cf3d1cd84ee022bb0');
  const ortRoot = path.join(work, archive.replace(/\.(tgz|zip)$/, ''));
  const config = ['-S', path.join(source, 'native'), '-B', path.join(work, 'build'), '-DCMAKE_BUILD_TYPE=Release', `-DORT_ROOT=${ortRoot}`, `-DLITERT_SDK=${work}/LiteRT-2.3.1`, `-DWEBP_SOURCE_DIR=${work}/libwebp-1.6.0`];
  if (platform === 'windows-amd64') config.push('-DCMAKE_SYSTEM_NAME=Windows', '-DCMAKE_SYSTEM_PROCESSOR=x86_64', '-DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc-posix', '-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++-posix', '-DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres');
  run('cmake', config);
  run('cmake', ['--build', path.join(work, 'build'), '--parallel', '2']);
  const name = `manga-translator-server${platform.startsWith('windows') ? '.exe' : ''}`;
  fs.mkdirSync(path.join(work, 'out'), { recursive: true });
  fs.copyFileSync(path.join(work, 'build', name), path.join(work, 'out', name));
  if (!platform.startsWith('windows')) {
    fs.chmodSync(path.join(work, 'out', name), 0o755);
    const r = spawnSync(path.join(work, 'out', name), [], { encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: path.join(ortRoot, 'lib') }, timeout: 30000 });
    assert(r.status === 1 && `${r.stdout}${r.stderr}`.includes('Usage:'), `Native startup failed: ${r.error || r.stderr}`);
  }
} else if (mode === 'verify') {
  const [distArg, tag] = args, dist = path.resolve(distArg), v = tag.slice(1);
  const expected = ['linux-arm64', 'linux-x64', 'windows-x64'].map(p => `manga-translator-${p}-${v}.zip`);
  expected.push(`manga-translator-control-source-${v}.tar.gz`);
  const lines = fs.readFileSync(path.join(dist, `manga-translator-${v}-SHA256SUMS.txt`), 'utf8').trim().split(/\r?\n/);
  assert(lines.length === expected.length, 'Unexpected checksum count');
  const seen = new Set();
  for (const line of lines) {
    const m = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert(m && expected.includes(m[2]) && !seen.has(m[2]), 'Unexpected checksum entry');
    seen.add(m[2]); assert(hash(path.join(dist, m[2])) === m[1], `${m[2]}: checksum mismatch`);
  }
  console.log(`Verified ${expected.length} release archives`);
} else if (mode === 'smoke') {
  const [app, tag, native] = args;
  const r = spawnSync(path.resolve(app), ['--version'], { encoding: 'utf8', timeout: 30000 });
  assert(r.status === 0 && r.stdout.trim() === tag.slice(1), `Controller startup failed: ${r.stdout} ${r.stderr} ${r.error || ''}`);
  if (native) {
    const n = spawnSync(path.resolve(native), [], { encoding: 'utf8', timeout: 30000 });
    assert(n.status === 1 && `${n.stdout}${n.stderr}`.includes('Usage:'), `Windows native startup failed: ${n.status} ${n.stderr}`);
  }
} else throw new Error(`Unknown mode: ${mode}`);
