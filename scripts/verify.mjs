/*
 * [INPUT]: 当前源码、锁定依赖、Cargo 与隔离验收脚本。
 * [OUTPUT]: 统一验证流程及带源码/程序摘要的可复用构建证据。
 * [POS]: 验证编排入口；测试开始前检查产物与源码一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败 (${result.status})`);
}
function sourceFingerprint() {
  const inputs = [
    'Cargo.toml',
    'Cargo.lock',
    'package.json',
    'package-lock.json',
    'build.rs',
    'scripts/build-panel.mjs',
    'scripts/verify.mjs',
  ];
  for (const dir of ['src', 'ui', '.cargo']) {
    for (const file of readdirSync(join(root, dir), { recursive: true, withFileTypes: true })) {
      if (file.isFile() && !file.name.endsWith('.md') && file.name !== '.DS_Store')
        inputs.push(join(file.parentPath, file.name).slice(root.length + 1));
    }
  }
  const digest = createHash('sha256')
    .update(process.version)
    .update(execFileSync('rustc', ['-Vv']));
  for (const key of [
    'RUSTFLAGS',
    'CARGO_ENCODED_RUSTFLAGS',
    'CARGO_BUILD_TARGET',
    'MACOSX_DEPLOYMENT_TARGET',
  ])
    digest.update(key).update(process.env[key] || '');
  for (const path of inputs.sort()) digest.update(path).update(readFileSync(join(root, path)));
  return digest.digest('hex');
}
export function prepareTestBinary(profile) {
  const explicit = process.env.CODEX_BUDDY_TEST_BINARY;
  if (!profile && explicit) {
    const match = ['debug', 'release'].find(
      (p) => resolve(explicit) === join(root, 'target', p, 'codex-buddy'),
    );
    if (!match)
      throw new Error(
        'CODEX_BUDDY_TEST_BINARY 请指向本仓库 target/debug 或 target/release 的程序，以核验源码一致性。',
      );
    profile = match;
  }
  profile ||= 'debug';
  const binary = join(root, 'target', profile, 'codex-buddy');
  const manifestPath = join(root, 'target', `verified-${profile}.json`);
  const source = sourceFingerprint();
  let previous;
  try {
    previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {}
  if (
    !existsSync(binary) ||
    previous?.source !== source ||
    previous?.sha256 !== hash(readFileSync(binary))
  ) {
    run('npm', ['run', 'build:web']);
    run('cargo', ['build', '--locked', ...(profile === 'release' ? ['--release'] : [])]);
    if (sourceFingerprint() !== source) throw new Error('构建期间源码发生变化，请重新运行验证。');
    previous = {
      binary,
      source,
      sha256: hash(readFileSync(binary)),
      version: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
    };
    writeFileSync(manifestPath, JSON.stringify(previous, null, 2) + '\n');
  }
  return previous;
}
async function verify() {
  rmSync(join(root, 'target/reports/verify.json'), { force: true });
  run('npm', ['run', 'check']);
  run('cargo', ['fmt', '--check']);
  const artifact = prepareTestBinary();
  run('cargo', ['test', '--locked']);
  run('cargo', ['clippy', '--locked', '--', '-D', 'warnings']);
  const env = { ...process.env, CODEX_BUDDY_TEST_BINARY: artifact.binary };
  run(process.execPath, ['tests/e2e.mjs'], env);
  run(process.execPath, ['tests/lifecycle-test.mjs'], env);
  if (process.argv.includes('--native')) run(process.execPath, ['tests/native-check.mjs'], env);
  else if (process.argv.includes('--native-appearance'))
    run(process.execPath, ['tests/native-check.mjs', '--appearance-only'], env);
  mkdirSync(join(root, 'target/reports'), { recursive: true });
  writeFileSync(
    join(root, 'target/reports/verify.json'),
    JSON.stringify(
      {
        passed: true,
        artifact,
        native: process.argv.includes('--native')
          ? 'full'
          : process.argv.includes('--native-appearance')
            ? 'appearance'
            : 'not-run',
      },
      null,
      2,
    ) + '\n',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await verify();
