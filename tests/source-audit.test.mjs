/*
 * [INPUT]: 公开文件副本、临时 Git 仓库、已安装的 Cargo/npm 依赖与第三方许可生成器。
 * [OUTPUT]: 公开内容边界、递归许可、署名补充和生成引用的行为测试。
 * [POS]: 发布文件检查与许可回归，不依赖维护者的私人资料。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import test from 'node:test';
import { publicSourceFiles } from '../scripts/source-audit.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { collectLicenseFiles, generateNotices } from '../scripts/third-party-notices.mjs';

const root = resolve(import.meta.dirname, '..');
const files = publicSourceFiles(root);
function fixture(t, git = true) {
  const directory = mkdtempSync(join(tmpdir(), 'companion-source-audit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    copyFileSync(join(root, file), join(directory, file));
  }
  if (git) {
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    execFileSync('git', ['add', '.'], { cwd: directory });
  }
  return directory;
}
const audit = (cwd) =>
  spawnSync(process.execPath, ['scripts/source-audit.mjs'], { cwd, encoding: 'utf8' });

test('public source passes without private documentation and rejects inconsistent licensing', (t) => {
  const directory = fixture(t);
  assert.equal(audit(directory).status, 0);
  const file = join(directory, 'package.json');
  const metadata = JSON.parse(readFileSync(file));
  metadata.license = 'UNLICENSED';
  writeFileSync(file, JSON.stringify(metadata));
  assert.notEqual(audit(directory).status, 0);
});

test('private documentation cannot be published even when force staged', (t) => {
  const directory = fixture(t);
  mkdirSync(join(directory, 'docs'));
  writeFileSync(join(directory, 'docs', 'notes.md'), 'Private planning fixture.');
  execFileSync('git', ['add', '--force', 'docs'], { cwd: directory });
  const result = audit(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Private\/generated directory/);
});

test('stale product identity in the lockfile fails the public check', (t) => {
  const directory = fixture(t);
  const file = join(directory, 'package-lock.json');
  const lock = JSON.parse(readFileSync(file));
  lock.packages[''].name = 'old-product-name';
  writeFileSync(file, JSON.stringify(lock));
  const result = audit(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Lockfile root name mismatch/);
});

test('force-staged runtime credentials are rejected despite gitignore', (t) => {
  const directory = fixture(t);
  writeFileSync(join(directory, 'secrets.json'), '{"fixture":true}\n');
  execFileSync('git', ['add', '--force', 'secrets.json'], { cwd: directory });
  const result = audit(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Private configuration/);
});

test('credential-shaped content in a public document is rejected', (t) => {
  const directory = fixture(t);
  // Synthetic token shape, never an actual credential.
  writeFileSync(join(directory, 'PUBLIC-EXAMPLE.md'), 'sk-' + 'z'.repeat(32));
  const result = audit(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Possible credential/);
});

test('personal filesystem paths in a public document are rejected', (t) => {
  const directory = fixture(t);
  writeFileSync(
    join(directory, 'PUBLIC-EXAMPLE.md'),
    ['/', 'Users', '/', 'fixture', '/', 'notes'].join(''),
  );
  const result = audit(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Personal absolute path/);
});

test('license collection retains nested licenses and attribution without collecting source or nested packages', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'buddy-license-files-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const expected = [
    'LICENSE',
    'src/spin/LICENSE',
    'src/unicode_tables/LICENSE-UNICODE',
    'third_party/fiat/AUTHORS',
    'third_party/fiat/LICENSE',
    'licenses/Apache-2.0.txt',
  ];
  const excluded = [
    'src/copying.rs',
    'src/license.js',
    'node_modules/other/LICENSE',
    '.git/NOTICE',
  ];
  for (const file of [...expected, ...excluded]) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), `Fixture attribution for ${file}\n`);
  }
  symlinkSync(directory, join(directory, 'cycle'), 'dir');
  assert.deepEqual(
    collectLicenseFiles(directory)
      .map((file) => relative(directory, file))
      .sort(),
    expected.sort(),
  );
});

test('declared license files resolve relative to the package and missing declarations fail', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'buddy-declared-license-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'legal'));
  const file = join(directory, 'legal/terms.txt');
  writeFileSync(file, 'Fixture license text\n');
  assert.deepEqual(collectLicenseFiles(directory, 'legal/terms.txt'), [file]);
  assert.deepEqual(collectLicenseFiles(directory, file), [file]);
  assert.throws(
    () => collectLicenseFiles(directory, 'legal/missing.txt'),
    /Declared license file not found/,
  );
});

test('generated notices preserve nested licenses and pinned authors alongside package root licenses', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'buddy-generated-notices-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  generateNotices(directory);
  const { components } = JSON.parse(readFileSync(join(directory, 'dependencies.json'), 'utf8'));
  const text = readFileSync(join(directory, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const component = (name) => components.find((item) => item.name === name);
  assert.ok(component('tracing-core').files.includes('src/spin/LICENSE'));
  assert.ok(component('regex-syntax').files.includes('src/unicode_tables/LICENSE-UNICODE'));
  assert.ok(component('ring').files.includes('third_party/fiat/LICENSE'));
  assert.ok(
    component('ring').upstreamFiles.some((url) => url.endsWith('/third_party/fiat/AUTHORS')),
  );
  assert.ok(text.includes('Copyright (c) 2014 Mathijs van de Nes'));
  assert.ok(text.includes('Massachusetts Institute of Technology'));
  const anchors = new Set(
    [...text.matchAll(/^### (license-[a-f0-9]+)$/gm)].map((match) => match[1]),
  );
  for (const [, id] of text.matchAll(/\]\(#(license-[a-f0-9]+)\)/g))
    assert.ok(anchors.has(id), `Missing license text: ${id}`);
});

test('source archives audit and export the same files without Git, excluding generated output', (t) => {
  const directory = fixture(t, false);
  for (const name of ['target', 'dist', 'node_modules']) {
    mkdirSync(join(directory, name));
    writeFileSync(join(directory, name, 'generated.txt'), 'Not source');
  }
  assert.equal(audit(directory).status, 0);
  assert.deepEqual(publicSourceFiles(directory), files);
  mkdirSync(join(directory, 'private'));
  writeFileSync(join(directory, 'private/notes.md'), 'private fixture');
  assert.match(audit(directory).stderr, /Private\/generated directory/);
});

test('source archives reject private configuration and symlinks', (t) => {
  const directory = fixture(t, false);
  writeFileSync(join(directory, 'secrets.json'), '{}');
  assert.match(audit(directory).stderr, /Private configuration/);
  rmSync(join(directory, 'secrets.json'));
  symlinkSync(join(directory, 'README.md'), join(directory, 'linked.md'));
  assert.match(audit(directory).stderr, /Non-regular public source file/);
});
