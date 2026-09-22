/*
 * [INPUT]: 当前源码目录、Node/Rust 工具路径与现有开发进程锁。
 * [OUTPUT]: --settings 打开当前稳定开发设置地址，唤起跟随已选来源；install:dev 生成带 Dock 启动反馈的 App；--open 后台启动并唤起，--stop 正常退出后台会话，--run 保留前台兼容入口；日志写入 launcher.log。
 * [POS]: 仅为现有开发流程提供 Finder 入口，不更新安装版；冷启动按共享策略准备宿主。
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
  openSync,
  closeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installIcon } from './launcher.mjs';
import { readJson, requestRuntime } from './dev-host.mjs';
import { setTimeout as delay } from 'node:timers/promises';

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

export async function startBackgroundDevelopment(directory) {
  if (hasDevelopmentOwner(directory)) return;
  const data = join(directory, 'target/dev');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  rmSync(join(data, 'launcher-error.json'), { force: true });
  const log = openSync(join(data, 'launcher.log'), 'w', 0o600);
  let child;
  try {
    child = spawn(
      process.execPath,
      [join(directory, 'scripts/dev.mjs'), '--no-open', '--restart-running'],
      {
        cwd: directory,
        detached: true,
        stdio: ['ignore', log, log],
      },
    );
  } finally {
    closeSync(log);
  }
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
  child.once('exit', (code, signal) => {
    if ((code !== 0 || signal) && !existsSync(join(data, 'launcher-error.json')))
      writeFileSync(
        join(data, 'launcher-error.json'),
        JSON.stringify({ message: '开发进程启动失败，请查看 target/dev/launcher.log。' }),
        { mode: 0o600 },
      );
  });
  child.unref();
  return child.pid;
}

export async function stopBackgroundDevelopment(directory) {
  if (!hasDevelopmentOwner(directory)) return;
  const owner = readJson(join(directory, 'target/dev/owner.json'));
  const expected = [
    process.execPath,
    join(directory, 'scripts/dev.mjs'),
    '--no-open',
    '--restart-running',
  ].join(' ');
  const actual = command('/bin/ps', ['-p', String(owner.pid), '-o', 'command=']);
  if (actual !== expected) throw new Error('进程不是此入口启动的后台开发会话；未结束其他进程。');
  process.kill(owner.pid, 'SIGTERM');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const current = readJson(join(directory, 'target/dev/owner.json'));
    if (current?.pid !== owner.pid) return;
    await delay(100);
  }
  throw new Error('开发会话仍在退出，请查看 target/dev/launcher.log；未强制结束进程。');
}

export function terminalScript(directory, node, path) {
  return `#!/bin/sh\nexport PATH=${quote(path)}\ncd ${quote(directory)} || exit 1\nexec ${quote(node)} ${quote(join(directory, 'scripts/dev-launcher.mjs'))} --run\n`;
}

export function launcherSource(launch) {
  return `use framework "AppKit"
use scripting additions
on run
  my openWorkbench()
end run
on reopen
  my openWorkbench()
end reopen
on openWorkbench()
  try
    activate
    set outcome to do shell script ${appleQuote(launch)}
    if outcome is "host" then
      set targets to current application's NSRunningApplication's runningApplicationsWithBundleIdentifier:"com.openai.codex"
      if (targets's |count|()) is not 1 then error "找不到唯一的 Codex 应用，未切换到其他程序。"
      set targetApp to targets's firstObject()
    else
      set targetApp to current application's NSRunningApplication's runningApplicationWithProcessIdentifier:(outcome as integer)
    end if
    if targetApp is missing value then error "工作台已退出，请重新打开。"
    set launcherApp to current application's NSRunningApplication's currentApplication()
    set nativeApp to current application's NSApplication's sharedApplication()
    targetApp's unhide()
    nativeApp's yieldActivationToApplication:targetApp
    set accepted to targetApp's activateFromApplication:launcherApp options:1
    if not accepted then error "系统未允许切换到工作台，请再试一次。"
    repeat 40 times
      if (targetApp's isActive()) as boolean then return
      delay 0.05
    end repeat
    error "工作台已连接，但未能切到前台，请再试一次。"
  on error messageText
    activate
    display alert "CodexBuddy Dev" message messageText buttons {"好"} default button "好"
  end try
end openWorkbench`;
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
    command('/usr/bin/osacompile', ['-o', staged, '-'], launcherSource(launch));
    installIcon(staged, staging);
    const plist = join(staged, 'Contents/Info.plist');
    const info = JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]));
    if ('CFBundleIconName' in info)
      command('/usr/bin/plutil', ['-remove', 'CFBundleIconName', plist]);
    for (const [key, type, value] of [
      ['CFBundleIdentifier', '-string', identifier],
      ['CFBundleName', '-string', 'CodexBuddy Dev'],
      ['CFBundleIconFile', '-string', 'codex-buddy.icns'],
      ['LSUIElement', '-bool', 'false'],
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

export async function revealDevelopment(
  directory,
  { timeout = 120000, interval = 350, checkStartupError = false } = {},
) {
  const deadline = Date.now() + timeout;
  let reconnected = false;
  let lastError;
  while (Date.now() < deadline) {
    const failure =
      checkStartupError && readJson(join(directory, 'target/dev/launcher-error.json'));
    if (failure)
      throw new Error(failure.message || '开发模式启动失败，请查看 target/dev/launcher.log。');
    const session = readJson(join(directory, 'target/dev/session.json'));
    const data = session?.runtime || join(directory, 'target/dev/real');
    const runtime = readJson(join(data, 'runtime.json'));
    if (runtime) {
      try {
        const state = await requestRuntime(runtime, 'state');
        if (state.connection.status === 'disconnected' && !reconnected) {
          // Reuse the pinned development target; never discover a different window or restart it.
          reconnected = true;
          const config = readJson(join(data, 'config.json'), {});
          await requestRuntime(runtime, 'connect', {
            endpoint: config.cdpEndpoint,
            targetId: config.targetId,
          });
        } else if (state.connection.status === 'connected') {
          return await requestRuntime(runtime, 'development/reveal', {});
        }
      } catch (error) {
        lastError = error;
      }
    }
    await delay(interval);
  }
  throw new Error(
    `开发工作台尚未就绪，请查看 target/dev/launcher.log。${lastError ? ` ${lastError.message}` : ''}`,
  );
}

export function developmentSettingsUrl(directory) {
  const session = readJson(join(directory, 'target/dev/session.json'));
  if (!session?.url || !session.token || !hasDevelopmentOwner(directory))
    throw new Error('开发会话尚未运行，请先打开 CodexBuddy Dev.app。');
  const url = new URL(session.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password
  )
    throw new Error('开发设置地址无效。');
  url.hash = new URLSearchParams({ token: session.token }).toString();
  return url.href;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('开发 App 入口仅适用于 macOS。');
  const mode = process.argv[2];
  if (!mode) return install();
  if (!['--open', '--run', '--stop', '--settings'].includes(mode))
    throw new Error('用法：npm run install:dev');
  if (mode === '--settings') {
    command('open', [developmentSettingsUrl(root)]);
    return;
  }
  if (mode === '--stop') {
    await stopBackgroundDevelopment(root);
    console.log('后台开发会话已退出。');
    return;
  }
  if (mode === '--run' && hasDevelopmentOwner(root)) {
    console.log('开发模式已在运行，无需重复启动。');
    return;
  }
  if (!existsSync(join(root, 'node_modules/vite/package.json')))
    throw new Error('缺少开发依赖，请在源码目录运行 npm ci。');
  if (mode === '--open') {
    const running = hasDevelopmentOwner(root);
    if (!running) await startBackgroundDevelopment(root);
    const result = await revealDevelopment(root, {
      timeout: running ? 20000 : 120000,
      checkStartupError: !running,
    });
    console.log(result.pid || 'host');
    return;
  }
  rmSync(join(root, 'target/dev/launcher-error.json'), { force: true });
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/dev.mjs'), '--no-open', '--restart-running'],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (
    (result.error || result.status !== 0) &&
    !existsSync(join(root, 'target/dev/launcher-error.json'))
  )
    writeFileSync(join(root, 'target/dev/launcher-error.json'), JSON.stringify({ failed: true }), {
      mode: 0o600,
    });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
