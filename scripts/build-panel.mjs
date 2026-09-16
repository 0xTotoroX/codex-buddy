/*
 * [INPUT]: lifecycle 模块入口、显式 ES module 依赖与受限请求桥。
 * [OUTPUT]: 正式/开发存储域独立的单个胶囊脚本，两种构建均包含内嵌 SVG 液态；可选输出到 Cargo OUT_DIR。
 * [POS]: Node/esbuild 构建入口；Rust 与契约测试共用，不依赖私有文档。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
export async function buildPanel(projectRoot = root, development = false) {
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: ['ui/panel/runtime/lifecycle.js'],
    loader: { '.css': 'text' },
    bundle: true,
    define: { CODEX_BUDDY_DEVELOPMENT: String(development) },
    format: 'iife',
    target: 'safari17',
    write: false,
    // Keep host-owned references and behavior readable in release debugging.
    minify: false,
    legalComments: 'inline',
    logLevel: 'silent',
  });
  const glass = await build({
    absWorkingDir: projectRoot,
    entryPoints: ['ui/panel/glass/lab.js'],
    bundle: true,
    format: 'iife',
    target: 'safari17',
    write: false,
    legalComments: 'inline',
    logLevel: 'silent',
  });
  const bridge = readFileSync(resolve(projectRoot, 'ui/bridge/requests.js'), 'utf8');
  return `(() => { const install = () => {\n${bridge}\n${result.outputFiles[0].text}\nif (!window.__companionPopout) {${glass.outputFiles[0].text}}\n}; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true}); else install(); })();`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const script = await buildPanel();
  if (process.argv[2]) writeFileSync(process.argv[2], script);
}
