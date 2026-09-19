/*
 * [INPUT]: 当前源码目录、Node/Rust 工具路径与现有开发进程锁。
 * [OUTPUT]: install:dev 生成独立 App；--open 打开开发终端，--run 复用或启动 dev.mjs。
 * [POS]: 仅为现有开发流程提供 Finder 入口，不更新安装版或重启宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installIcon } from './launcher.mjs';

const root = resolve(import.meta.dirname, '..');
const identifier = 'local.codex-buddy.dev-launcher';
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const appleQuote = (value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
function command(program, args, input) {
  const result = spawnSync(program, args, { encoding: 'utf8', input });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr?.trim() || `${program} 执行失败`);
  return result.stdout.trim();
}

export function hasDevelopmentOwner(directory) {
  let owner;
  try {
    owner = JSON.parse(readFileSync(join(directory, 'target/dev/owner.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new Error('开发进程记录无法读取，请检查 target/dev/owner.json。', { cause: error });
  }
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw new Error('开发进程记录无效，请检查 target/dev/owner.json。');
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export function terminalScript(directory, node, path) {
  return `#!/bin/sh\nexport PATH=${quote(path)}\ncd ${quote(directory)} || exit 1\nexec ${quote(node)} ${quote(join(directory, 'scripts/dev-launcher.mjs'))} --run\n`;
}

function install() {
  const destination = '/Applications/CodexBuddy Dev.app';
  if (
    existsSync(destination) &&
    command('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleIdentifier',
      join(destination, 'Contents/Info.plist'),
    ]) !== identifier
  )
    throw new Error('目标位置已有其他应用，未覆盖。');
  const staging = mkdtempSync(join(dirname(destination), '.codex-buddy-dev-'));
  const staged = join(staging, 'CodexBuddy Dev.app');
  const directory = join(root, 'target/dev');
  const path = [dirname(process.execPath), process.env.PATH, '/usr/bin', '/bin']
    .filter(Boolean)
    .join(':');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'Start CodexBuddy Dev.command'),
    terminalScript(root, process.execPath, path),
    { mode: 0o700 },
  );
  const launch = `/usr/bin/env PATH=${quote(path)} ${quote(process.execPath)} ${quote(join(root, 'scripts/dev-launcher.mjs'))} --open`;
  try {
    command(
      '/usr/bin/osacompile',
      ['-o', staged, '-'],
      `on run
  try
    set outcome to do shell script ${appleQuote(launch)}
    if outcome is "running" then
      display notification "开发模式已在运行，修改源码会自动加载。退出请在原终端按 Ctrl+C。" with title "CodexBuddy Dev"
    end if
  on error messageText
    activate
    display alert "CodexBuddy Dev" message messageText buttons {"好"} default button "好"
  end try
end run`,
    );
    installIcon(staged, staging);
    const plist = join(staged, 'Contents/Info.plist');
    const info = JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]));
    if ('CFBundleIconName' in info)
      command('/usr/bin/plutil', ['-remove', 'CFBundleIconName', plist]);
    for (const [key, type, value] of [
      ['CFBundleIdentifier', '-string', identifier],
      ['CFBundleName', '-string', 'CodexBuddy Dev'],
      ['CFBundleIconFile', '-string', 'codex-buddy.icns'],
      ['LSUIElement', '-bool', 'true'],
      ['LSMinimumSystemVersion', '-string', '14.0'],
    ])
      command('/usr/bin/plutil', ['-replace', key, type, value, plist]);
    command('/usr/bin/codesign', ['--force', '--sign', '-', staged]);
    const previous = join(staging, 'previous.app');
    if (existsSync(destination)) renameSync(destination, previous);
    try {
      renameSync(staged, destination);
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, destination);
      throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(
    `开发入口已安装：${destination}\n源码目录或 Node 路径改变后，重新运行 npm run install:dev。`,
  );
}

function main() {
  if (process.platform !== 'darwin') throw new Error('开发 App 入口仅适用于 macOS。');
  const mode = process.argv[2];
  if (!mode) return install();
  if (!['--open', '--run'].includes(mode)) throw new Error('用法：npm run install:dev');
  if (hasDevelopmentOwner(root)) {
    console.log(mode === '--open' ? 'running' : '开发模式已在运行，请使用原终端；无需重复启动。');
    return;
  }
  if (!existsSync(join(root, 'node_modules/vite/package.json')))
    throw new Error('缺少开发依赖，请在源码目录运行 npm ci。');
  if (mode === '--open') {
    command('/usr/bin/open', [
      '-a',
      'Terminal',
      join(root, 'target/dev/Start CodexBuddy Dev.command'),
    ]);
    return;
  }
  const result = spawnSync(process.execPath, [join(root, 'scripts/dev.mjs'), '--no-open'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
