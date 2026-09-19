/*
 * [INPUT]: 已安装 CLI、数据目录、目标 .app 路径与 ui/icon.png；macOS 自带 osacompile/sips/iconutil。
 * [OUTPUT]: installLauncher 生成日常 App；installIcon 为日常与开发启动器生成图标。
 * [POS]: 本地安装器使用的轻量启动入口；复用 CLI，不复制后台或修改宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const identifier = 'local.codex-buddy.launcher';
const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
const appleQuote = (text) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
function run(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8' });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr || `${program} 执行失败`);
  return result.stdout.trim();
}

export function installIcon(app, staging) {
  const source = join(import.meta.dirname, '../ui/icon.png');
  const iconset = join(staging, 'CodexBuddy.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      run('/usr/bin/sips', ['-z', pixels, pixels, source, '--out', join(iconset, name)]);
    }
  }
  run('/usr/bin/iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    join(app, 'Contents/Resources/codex-buddy.icns'),
  ]);
  rmSync(join(app, 'Contents/Resources/applet.icns'), { force: true });
}

export function installLauncher({ binary, dataDir, destination }) {
  const plist = join(destination, 'Contents/Info.plist');
  if (
    existsSync(destination) &&
    run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]) !== identifier
  ) {
    throw new Error('目标位置已有其他应用，未覆盖');
  }
  mkdirSync(dirname(destination), { recursive: true });
  const staging = mkdtempSync(join(dirname(destination), '.codex-buddy-install-'));
  const staged = join(staging, 'CodexBuddy.app');
  const command = `${shellQuote(binary)} --data-dir ${shellQuote(dataDir)}`;
  const popoutRequirement = '桌面浮窗仅支持 macOS 15 及以上的 Apple Silicon 设备';
  try {
    run(
      '/usr/bin/osacompile',
      ['-o', staged, '-'],
      `on run
  try
    do shell script ${appleQuote(`${command} launch --no-open`)}
    try
      do shell script ${appleQuote(`${command} popout`)}
    on error popoutMessage
      if popoutMessage does not contain ${appleQuote(popoutRequirement)} then error popoutMessage
    end try
  on error messageText
    activate
    display alert "CodexBuddy" message messageText buttons {"好"} default button "好"
  end try
end run
`,
    );
    const stagedPlist = join(staged, 'Contents/Info.plist');
    installIcon(staged, staging);
    const info = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', stagedPlist]));
    // A named asset-catalog icon takes precedence over CFBundleIconFile on newer macOS.
    if ('CFBundleIconName' in info)
      run('/usr/bin/plutil', ['-remove', 'CFBundleIconName', stagedPlist]);
    for (const [key, type, value] of [
      ['CFBundleIdentifier', '-string', identifier],
      ['CFBundleIconFile', '-string', 'codex-buddy.icns'],
      ['LSMinimumSystemVersion', '-string', '14.0'],
      ['LSUIElement', '-bool', 'true'],
      ['NSHighResolutionCapable', '-bool', 'true'],
    ])
      run('/usr/bin/plutil', ['-replace', key, type, value, stagedPlist]);
    // osacompile signs the applet; changing its plist requires a fresh local signature.
    run('/usr/bin/codesign', ['--force', '--sign', '-', staged]);
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
}
