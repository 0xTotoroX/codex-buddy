/*
 * [INPUT]: release 程序、source-audit 共用清单与公开检查、LICENSE 与锁定依赖。
 * [OUTPUT]: macOS arm64 程序包、当前公开源码包及校验和。
 * [POS]: 本地打包入口，校验最低系统版本并携带许可。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { prepareTestBinary } from './verify.mjs';
import { publicSourceFiles } from './source-audit.mjs';
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

独立的 Codex 胶囊：回答大纲、Stepwise 下一步建议与桌面弹出窗口。
此归档适用于 macOS 14.0+ Apple Silicon，包含可直接运行的程序，无需 Node.js 或 Rust。桌面浮窗需要 macOS 15+；macOS 14 仍可使用 Codex 内嵌面板。

## 开始使用

在终端进入解压目录，执行：

\`\`\`sh
./codex-buddy launch --no-open
./codex-buddy popout
\`\`\`

若 ChatGPT 已经普通启动且没有开放调试端口，请保存工作并完整退出，再执行第一条命令；已有可用端口时可以直接连接。
打开配置页：\`./codex-buddy start\`。查看诊断：\`./codex-buddy doctor\`。
停止本工具：\`./codex-buddy stop\`。可用命令见 \`./codex-buddy --help\`。

归档是命令行版本，不包含 .app 双击启动器。
回答大纲在本机解析；Stepwise 需要在配置页选择模型。默认只填入建议，已有草稿经确认后追加。

## 外观与窗口

macOS 15+ 的弹出窗口始终展开，可拖动、调整尺寸和置顶；向内箭头收回 Codex，内嵌时才可收起为胶囊。
强调色跟随 Codex，与内嵌一致；弹出明暗跟随 macOS，标题栏明暗按钮切换系统外观。

- 哑光：不透明网页表面，不启用原生背景。
- 磨砂：内嵌为 CSS 模糊；弹出为原生 HUDWindow，保持激活外观，使用圆角浅阴影。
- 液态：内嵌使用自有 SVG 折射；弹出使用 macOS 26+ Liquid Glass。外观框内星星切换 Regular/Clear，点亮为 Clear；macOS 15–25 的弹出液态回退哑光。弹出液态仍有系统焦点变化。

解压此包不会替换已有安装或配置；源码安装和开发说明见源码包 README。

## 文件

- [codex-buddy](codex-buddy)：可执行程序。
- [LICENSE](LICENSE)：项目 MIT 许可。
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：第三方许可与引用。
- [dependencies.json](dependencies.json)：第三方依赖清单。
- [manifest.json](manifest.json)：版本、平台及构建摘要。
- [SHA256SUMS](SHA256SUMS)：程序校验和，可运行 \`shasum -a 256 -c SHA256SUMS\` 验证。
`,
);
copyFileSync(join(root, 'LICENSE'), join(folder, 'LICENSE'));
generateNotices(folder);
const hash = createHash('sha256').update(readFileSync(destination)).digest('hex');
writeFileSync(join(folder, 'SHA256SUMS'), `${hash}  ${file}\n`);
writeFileSync(
  join(folder, 'manifest.json'),
  JSON.stringify(
    {
      name: 'codex-buddy',
      version,
      license: 'MIT',
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
// Source exports follow the audited working tree, including new files awaiting a commit.
const sourceFiles = publicSourceFiles(root);
const sourceArchive = join(root, 'dist', `codex-buddy-${version}-source.tar.gz`);
const sourcePacked = spawnSync('tar', ['-czf', sourceArchive, '--null', '-T', '-'], {
  cwd: root,
  input: sourceFiles.join('\0') + '\0',
  encoding: 'utf8',
});
if (sourcePacked.error || sourcePacked.status !== 0)
  throw new Error(`源码打包失败：${sourcePacked.stderr || sourcePacked.error}`);
const sourceHash = createHash('sha256').update(readFileSync(sourceArchive)).digest('hex');
const archiveHash = createHash('sha256').update(readFileSync(archive)).digest('hex');
rmSync(`${sourceArchive}.sha256`, { force: true });
writeFileSync(
  join(root, 'dist', 'SHA256SUMS'),
  `${archiveHash}  ${name}.tar.gz\n${sourceHash}  codex-buddy-${version}-source.tar.gz\n`,
);
console.log(
  `产物：${archive}\n源码包：${sourceArchive}（${sourceFiles.length} 个公开文件）\n归档校验：${join(root, 'dist', 'SHA256SUMS')}\n二进制 SHA-256：${hash}`,
);
