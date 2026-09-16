/*
 * [INPUT]: Git 或解压源码目录的公开文件、包元数据与 LICENSE。
 * [OUTPUT]: publicSourceFiles 共用文件清单及公开源码的包名/许可元数据、私有路径和凭据检查结果。
 * [POS]: 开发与打包共用的公开文件检查，不读取维护者资料。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
export function publicSourceFiles(root) {
  let files;
  if (existsSync(join(root, '.git'))) {
    files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
    })
      .toString()
      .split('\0')
      .filter((path) => path && existsSync(join(root, path)));
  } else {
    // Archives have no Git index. Skip generated output, but retain unknown and
    // private files so the same audit can reject them rather than silently publish them.
    files = [];
    function visit(directory = '') {
      for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
        if (entry.name === '.DS_Store') continue;
        if (!directory && ['node_modules', 'target', 'dist'].includes(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else files.push(path);
      }
    }
    visit();
  }
  return [...new Set(files)].sort().map((path) => {
    assert.ok(lstatSync(join(root, path)).isFile(), `Non-regular public source file: ${path}`);
    return path;
  });
}

export function auditSource(root) {
  assert.match(readFileSync(join(root, 'LICENSE'), 'utf8'), /^MIT License\n/);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).license, 'MIT');
  assert.equal(
    JSON.parse(readFileSync(join(root, 'package-lock.json'))).packages[''].license,
    'MIT',
  );
  assert.match(readFileSync(join(root, 'Cargo.toml'), 'utf8'), /^license = "MIT"$/m);
  const metadata = JSON.parse(readFileSync(join(root, 'package.json')));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  assert.equal(metadata.name, 'codex-buddy', 'Product name mismatch');
  assert.equal(lock.name, metadata.name, 'Lockfile name mismatch');
  assert.equal(lock.packages[''].name, metadata.name, 'Lockfile root name mismatch');
  assert.match(readFileSync(join(root, 'Cargo.toml'), 'utf8'), /^name = "codex-buddy"$/m);

  const files = publicSourceFiles(root);
  for (const path of files) {
    assert.ok(
      !/(^|\/)(docs|private|\.obsidian|node_modules|target|output|outputs|work|dist|desktop-profile)(\/|$)/.test(
        path,
      ),
      `Private/generated directory: ${path}`,
    );
    assert.ok(
      !/(^|\/)(secrets|runtime|panel|config)\.json$|(^|\/)\.env(?:\.|$)|\.(?:pem|key)$/.test(path),
      `Private configuration: ${path}`,
    );
    const bytes = readFileSync(join(root, path));
    if (bytes.includes(0)) continue;
    const text = bytes.toString();
    assert.ok(
      !/\b(?:gh[pousr]_|github_pat_|sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}/.test(text),
      `Possible credential in ${path}`,
    );
    assert.ok(!/\/(?:Users|Volumes)\/[^\s/"'`]+\//.test(text), `Personal absolute path in ${path}`);
  }
  console.log(
    `Public source checks passed: ${files.length} files; license metadata, private paths and credential patterns checked.`,
  );

  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  auditSource(root);
