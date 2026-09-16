/*
 * [INPUT]: 胶囊模块、共享契约和标准 fixture。
 * [OUTPUT]: 完整 checkJs 检查及无循环依赖约束。
 * [POS]: 模块边界回归门；不以错误码白名单隐藏诊断。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../ui/panel');
const files = readdirSync(root, { recursive: true })
  .filter((f) => f.endsWith('.js') && f !== 'popout/boot.js')
  .map((f) => resolve(root, f));

test('panel boundaries and fixtures pass every checkJs diagnostic', () => {
  const program = ts.createProgram([...files, resolve(import.meta.dirname, 'fixtures.mjs')], {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ['vite/client', 'node'],
    skipLibCheck: true,
  });
  const failures = ts.getPreEmitDiagnostics(program);
  assert.equal(
    failures.length,
    0,
    ts.formatDiagnostics(failures, {
      getCanonicalFileName: (x) => x,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
});

test('panel imports form a DAG and features do not depend on one another', () => {
  const graph = new Map(
    files.map((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const deps = source.statements
        .filter(ts.isImportDeclaration)
        .map((node) => resolve(dirname(file), node.moduleSpecifier.text))
        .filter((file) => file.endsWith('.js'));
      return [file, deps];
    }),
  );
  const visited = new Set();
  const active = [];
  function visit(file) {
    assert.ok(
      !active.includes(file),
      `Import cycle: ${[...active, file].map((f) => relative(root, f)).join(' → ')}`,
    );
    if (visited.has(file)) return;
    active.push(file);
    for (const dependency of graph.get(file) || []) visit(dependency);
    active.pop();
    visited.add(file);
  }
  files.forEach(visit);
  function reachable(from, target, seen = new Set()) {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (graph.get(from) || []).some((dependency) => reachable(dependency, target, seen));
  }
  for (const [from, to] of [
    ['stepwise.js', 'outline.js'],
    ['outline.js', 'stepwise.js'],
  ]) {
    assert.equal(
      reachable(resolve(root, from), resolve(root, to)),
      false,
      `${from} must not depend on ${to}`,
    );
  }
  for (const file of files.filter((f) => relative(root, f).startsWith('host/'))) {
    assert.equal(reachable(file, resolve(root, 'stepwise.js')), false);
    assert.equal(reachable(file, resolve(root, 'outline.js')), false);
  }
});
