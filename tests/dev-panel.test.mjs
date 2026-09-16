/*
 * [INPUT]: 隔离源码副本、esbuild 开发构建器。
 * [OUTPUT]: CSS/逻辑更新版本分离、坏代码不覆盖上次快照的回归。
 * [POS]: 开发资源发布契约；不修改工作区业务源码或启动宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, cpSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildDevPanel } from '../scripts/dev-panel.mjs';

test('dev snapshots publish CSS independently and preserve the last successful bundle on error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-dev-panel-'));
  const output = join(root, 'panel.json');
  try {
    cpSync(resolve(import.meta.dirname, '../ui'), join(root, 'ui'), { recursive: true });
    const initial = await buildDevPanel(root, output);
    appendFileSync(join(root, 'ui/tokens.css'), '\n:root { --buddy-development-check: 1; }');
    const css = await buildDevPanel(root, output);
    assert.notEqual(css.revision, initial.revision);
    assert.equal(css.page, initial.page);
    assert.match(css.script, /--buddy-development-check/);
    const code = (snapshot) => snapshot.script.match(/"code":"([a-f0-9]+)"/)[1];
    assert.equal(code(css), code(initial));
    appendFileSync(join(root, 'ui/panel/runtime/constants.js'), '\n// Development logic update\n');
    const logic = await buildDevPanel(root, output);
    assert.notEqual(code(logic), code(css));
    const saved = readFileSync(output, 'utf8');
    appendFileSync(join(root, 'ui/panel/runtime/constants.js'), '\nexport const broken = ;\n');
    await assert.rejects(buildDevPanel(root, output));
    assert.equal(readFileSync(output, 'utf8'), saved);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
