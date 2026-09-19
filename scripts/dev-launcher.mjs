/*
 * [INPUT]: 当前源码目录、Node/Rust 工具路径与现有开发进程锁。
 * [OUTPUT]: install:dev 生成带 Dock 启动反馈的 App；--open 等待就绪、重连并唤起，--run 启动 dev.mjs。
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
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
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
    if (failure) throw new Error(failure.message || '开发模式启动失败，请查看开发终端。');
    const runtime = readJson(join(directory, 'target/dev/real/runtime.json'));
    if (runtime) {
      try {
        const state = await requestRuntime(runtime, 'state');
        if (state.connection.status === 'disconnected' && !reconnected) {
          // Reuse the pinned development target; never discover a different window or restart it.
          reconnected = true;
          const config = readJson(join(directory, 'target/dev/real/config.json'), {});
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
    `开发工作台尚未就绪，请查看开发终端。${lastError ? ` ${lastError.message}` : ''}`,
  );
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('开发 App 入口仅适用于 macOS。');
  const mode = process.argv[2];
  if (!mode) return install();
  if (!['--open', '--run'].includes(mode)) throw new Error('用法：npm run install:dev');
  if (mode === '--run' && hasDevelopmentOwner(root)) {
    console.log('开发模式已在运行，请使用原终端；无需重复启动。');
    return;
  }
  if (!existsSync(join(root, 'node_modules/vite/package.json')))
    throw new Error('缺少开发依赖，请在源码目录运行 npm ci。');
  if (mode === '--open') {
    const running = hasDevelopmentOwner(root);
    if (!running) {
      rmSync(join(root, 'target/dev/launcher-error.json'), { force: true });
      command('/usr/bin/open', [
        '-a',
        'Terminal',
        join(root, 'target/dev/Start CodexBuddy Dev.command'),
      ]);
    }
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
