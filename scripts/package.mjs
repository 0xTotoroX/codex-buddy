/*
 * [INPUT]: release 程序、source-audit 公开检查、项目完整许可包与锁定依赖。
 * [OUTPUT]: macOS arm64 程序包，内含完整性校验；Release 正文独立维护。
 * [POS]: 本地打包入口，校验最低系统版本并携带许可。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { prepareTestBinary } from './verify.mjs';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { generateNotices } from './third-party-notices.mjs';
import { PROJECT_LICENSE, copyProjectLicenses } from './project-licenses.mjs';

const root = resolve(import.meta.dirname, '..');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('当前只发布 macOS 14.0+ Apple Silicon 产物；其他平台尚未适配。');
const audit = spawnSync(process.execPath, [join(root, 'scripts/source-audit.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (audit.error || audit.status !== 0) throw new Error('源码与公开内容检查失败，停止打包');
const { version } = JSON.parse(readFileSync(join(root, 'package.json')));
const cargo = readFileSync(join(root, 'Cargo.toml'), 'utf8');
if (!cargo.includes(`version = "${version}"`)) throw new Error('Cargo 与网页版本不一致');
const file = 'codex-buddy';
const artifact = prepareTestBinary('release');
const source = artifact.binary;
const result = spawnSync(source, ['--version'], { encoding: 'utf8' });
if (result.error || result.status !== 0 || result.stdout.trim() !== `codex-buddy ${version}`)
  throw new Error('请先构建与当前版本一致的 release 产物');
const build = spawnSync('xcrun', ['vtool', '-show-build', source], { encoding: 'utf8' });
if (build.error || build.status !== 0 || !/minos\s+14\.0\b/.test(build.stdout))
  throw new Error('产物最低 macOS 版本必须为 14.0，请按项目配置重新构建');
const name = `codex-buddy-${version}-${process.platform}-${process.arch}`;
const folder = join(root, 'dist', name);
// Rebuild this generated directory so retired files cannot remain in the archive.
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
const destination = join(folder, file);
copyFileSync(source, destination);
chmodSync(destination, 0o755);
writeFileSync(
  join(folder, 'README.md'),
  `# CodexBuddy ${version}

Codex 的本地辅助工具：回答大纲、下一步建议、任务看板、模型切换、术语释义与提示词优化。
此归档适用于 macOS 14.0+ Apple Silicon，包含可直接运行的程序，无需 Node.js 或 Rust。桌面浮窗需要 macOS 15+；macOS 14 仍可使用 Codex 内嵌面板。

## 开始使用

在终端进入解压目录，执行：

\`\`\`sh
./codex-buddy launch --no-open --restart-running
./codex-buddy popout
\`\`\`

若 ChatGPT 已打开但没有调试连接，第一条命令按启动设置询问或直接重开；已有可用连接时直接复用。
打开配置页：\`./codex-buddy start\`。查看诊断：\`./codex-buddy doctor\`。
停止本工具：\`./codex-buddy stop\`。可用命令见 \`./codex-buddy --help\`。

归档是命令行版本，不包含 .app 双击启动器。
回答大纲在本机解析；下一步建议和提示词优化使用配置的模型，提示词优化只发送当前草稿且不会自动发送。术语词库保存在本机、不随包分发；启用语义识别时会将当前一问一答发送到配置的模型，联网补充限于公共百科。默认只填入建议，已有草稿经确认后追加。Apple 提醒事项设置入口暂时隐藏，已有数据与绑定保留。

## 外观与窗口

macOS 15+ 的弹出窗口始终展开，可拖动、调整尺寸和置顶，默认置顶并记住选择。左侧眼睛入口可收放聊天内工作台，双击或 Alt+Enter 切换桌面；悬停菜单提供“内／外／设置”。桌面右上角横线按钮收回聊天，另有放大／还原和置顶。工作台顶部不再显示眼睛。
工作台颜色只读跟随 Codex；左侧眼睛入口右键在宿主内置浏览器侧栏打开设置，完整位置、排列和外观选项集中在网页中。

- 哑光：不透明网页表面，不启用原生背景。
- 磨砂：内嵌为 CSS 模糊；弹出为原生 HUDWindow，保持激活外观，使用圆角浅阴影。
- 液态：内嵌使用自有 SVG 折射；弹出使用 macOS 26+ Liquid Glass。外观框内星星切换 Regular/Clear，点亮为 Clear；macOS 15–25 的弹出液态回退哑光。弹出液态仍有系统焦点变化。

解压此包不会替换已有安装或配置。此 GPL 版本的分发须按许可提供与程序精确修订对应的完整源码及必要构建、安装材料；GitHub 标签 Source code 归档只有在该修订实际可用且内容满足要求时才能作为源码入口，旧版归档不能代替新增改动的源码。

## 文件

- [codex-buddy](codex-buddy)：可执行程序。
- [LICENSE](LICENSE)：项目 GPL-3.0-only 完整许可。
- [LICENSING.md](LICENSING.md)：许可范围、免费商用、对应源码义务及旧 MIT 授权说明。
- [licenses/LICENSE-MIT-legacy](licenses/LICENSE-MIT-legacy)：变更前 MIT 历史原文。
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：第三方许可与引用。
- [dependencies.json](dependencies.json)：第三方依赖清单。
- [manifest.json](manifest.json)：版本、平台及构建摘要。
- [SHA256SUMS](SHA256SUMS)：程序校验和，可运行 \`shasum -a 256 -c SHA256SUMS\` 验证。
`,
);
copyProjectLicenses(root, folder);
generateNotices(folder);
const hash = createHash('sha256').update(readFileSync(destination)).digest('hex');
writeFileSync(join(folder, 'SHA256SUMS'), `${hash}  ${file}\n`);
writeFileSync(
  join(folder, 'manifest.json'),
  JSON.stringify(
    {
      name: 'codex-buddy',
      version,
      license: PROJECT_LICENSE,
      platform: process.platform,
      arch: process.arch,
      minimumOSVersion: '14.0',
      file,
      sha256: hash,
      sourceFingerprint: artifact.source,
      bytes: statSync(destination).size,
    },
    null,
    2,
  ) + '\n',
);
const archive = join(root, 'dist', `${name}.tar.gz`);
const packed = spawnSync('tar', ['-czf', archive, '-C', join(root, 'dist'), name], {
  stdio: 'inherit',
});
if (packed.error || packed.status !== 0) throw new Error('tar 打包失败；单文件产物仍在 dist 目录');
// 清理旧版生成的发布正文，避免继续使用自动追加校验段的旧稿。
rmSync(join(root, 'dist', 'release-checksums.md'), { force: true });
rmSync(join(root, 'dist', 'release-notes.md'), { force: true });
console.log(`产物：${archive}`);
