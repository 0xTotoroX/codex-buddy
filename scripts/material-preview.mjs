/*
 * [INPUT]: Swift/AppKit 材质对照源码与本机 Xcode Command Line Tools。
 * [OUTPUT]: target/material-preview 中的开发工具；--check 验证同步控制，--package 生成 App 与可独立重建的源码 ZIP。
 * [POS]: npm run dev:materials 入口；不连接宿主、不修改安装版或产品偏好。
 * [PROTOCOL]: 变更时检查 scripts/AGENTS.md。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

if (process.platform !== 'darwin') throw new Error('材质对照需要 macOS。');
const root = resolve(import.meta.dirname, '..');
const contents = join(root, 'target/material-preview/CodexBuddy Materials.app/Contents');
mkdirSync(join(contents, 'MacOS'), { recursive: true });
const binary = join(contents, 'MacOS/material-preview');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('无效的版本号。');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('xcrun', [
  'swiftc',
  '-target',
  'arm64-apple-macosx14.0',
  join(root, 'scripts/material-preview.swift'),
  '-o',
  binary,
]);
writeFileSync(
  join(contents, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.codexbuddy.material-preview</string>
<key>CFBundleName</key><string>CodexBuddy Materials</string>
<key>CFBundleExecutable</key><string>material-preview</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version.split('-')[0]}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`,
);
mkdirSync(join(contents, 'Resources'), { recursive: true });
copyFileSync(join(root, 'LICENSE'), join(contents, 'Resources/LICENSE'));
if (process.argv.includes('--package')) {
  const output = join(root, 'dist/material-preview');
  const name = 'CodexBuddy Materials.app';
  const app = join(output, name);
  mkdirSync(output, { recursive: true });
  run('ditto', [resolve(contents, '..'), app]);
  run('codesign', ['--force', '--sign', '-', app]);
  run('codesign', ['--verify', '--strict', app]);
  run(join(app, 'Contents/MacOS/material-preview'), ['--check']);
  const source = join(output, 'source');
  mkdirSync(join(source, 'scripts'), { recursive: true });
  for (const file of ['material-preview.swift', 'material-preview.mjs']) {
    copyFileSync(join(root, 'scripts', file), join(source, 'scripts', file));
  }
  copyFileSync(join(root, 'LICENSE'), join(source, 'LICENSE'));
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify(
      {
        name: 'codex-buddy-materials',
        version,
        private: true,
        license: 'MIT',
        type: 'module',
        engines: { node: '>=22.16.0' },
        scripts: {
          dev: 'node scripts/material-preview.mjs',
          check: 'node scripts/material-preview.mjs --check',
          build: 'node scripts/material-preview.mjs --package',
        },
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    join(source, 'README.md'),
    `# CodexBuddy Materials 源码

这里包含 ZIP 内材质预览 App 的全部应用源码和构建脚本，可独立二次开发。它是 Swift/AppKit 原生工具，不包含 CodexBuddy 主程序、聊天连接或网页液态玻璃实现。

## 文件

- scripts/material-preview.swift：14 种材质、对照背景、控制界面和同步验证。
- scripts/material-preview.mjs：Swift 编译、App 组装、本地签名及带源码的 ZIP 打包。
- package.json：版本与运行命令；仅用 Node 内置模块，没有 npm 依赖。
- LICENSE：MIT 许可。

## 修改与运行

构建需要 Apple Silicon Mac、macOS 14+、Node.js 22.16+、Xcode Command Line Tools。首次缺少编译工具时执行 xcode-select --install。无需 npm install，也不需要原 CodexBuddy 仓库。

在本 source 目录打开终端：

\x60\x60\x60sh
npm run dev     # 编译后打开预览
npm run check   # 编译并检查 14 种材质、54 组同步控制
npm run build   # 生成独立 App 和带源码 ZIP
\x60\x60\x60

先修改 scripts/material-preview.swift，再关闭旧预览窗口并重新运行 npm run dev；这里没有文件监听或热更新。材质列表在 materials，界面与同步逻辑在 Preview，对照背景在 Background。

中间文件在 target/material-preview；分发文件在 dist/material-preview，ZIP 在 dist。修改版本时编辑 package.json。构建只使用这里的文件，重新打出的包仍附带当前源码。

App 自带可执行程序，使用者无需开发工具。macOS 14 为构建最低目标，不代表全部旧系统已实测。
`,
  );
  writeFileSync(
    join(output, '使用说明.txt'),
    `CodexBuddy Materials ${version}

双击 CodexBuddy Materials.app 即可打开 14 种原生材质对照。
可将整个 App 拖入“应用程序”，或放在任意长期保存的文件夹。
App 自带可执行程序，不需要 Node.js、Rust、开发工具或 CodexBuddy 项目。
source 文件夹包含完整预览源码、MIT 许可和独立构建入口；二次开发见 source/README.md。

顶部可以统一切换背景、浅色/深色、跟随焦点/保持激活/模拟失焦。
“真实桌面”隐藏对照背景，拖动窗口可观察实际桌面效果。
这些操作只影响预览，不修改系统设置或 CodexBuddy 胶囊偏好。
关闭窗口或按 Command+Q 退出。

平台要求：macOS 14+、Apple Silicon。构建目标不等于所有旧系统均已实测。
从其他电脑或网络下载时，macOS 可能要求额外确认。
许可证随 App 保存在 Contents/Resources/LICENSE。
`,
  );
  const archive = join(root, `dist/codex-buddy-materials-${version}-macos-arm64.zip`);
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', output, archive]);
  console.log(`独立 App：${app}\n保存用 ZIP：${archive}`);
} else if (process.argv.includes('--check')) run(binary, ['--check']);
else run('open', [resolve(contents, '..')]);
