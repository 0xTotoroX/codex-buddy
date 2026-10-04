/*
 * [INPUT]: 已安装的 npm 依赖、Chromium、当前 Git 工作树。
 * [OUTPUT]: target/reports/web-pilot 下的逐项日志与非原生验证报告。
 * [POS]: 可在 Linux 运行的前端试点；不替代 verify、原生验收或发布门禁。
 * [PROTOCOL]: 变更时核对 scripts/AGENTS.md 与根地图。
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'target/reports/web-pilot');
mkdirSync(output, { recursive: true });
const readCommand = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
};
const readLimit = (name) => {
  const path = `/sys/fs/cgroup/${name}`;
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
};
const browser =
  process.env.CHROME_PATH ||
  process.env.CODEX_BUDDY_CHROME_BIN ||
  (process.platform === 'linux' && existsSync('/usr/bin/chromium')
    ? '/usr/bin/chromium'
    : undefined);
const env = { ...process.env };
if (browser) {
  env.CHROME_PATH = browser;
  env.CODEX_BUDDY_CHROME_BIN = browser;
}
const report = {
  scope: 'Frontend and synthetic browser pilot; not full product verification',
  startedAt: new Date().toISOString(),
  branch: readCommand('git', ['branch', '--show-current']),
  commit: readCommand('git', ['rev-parse', 'HEAD']),
  workingTree: readCommand('git', ['status', '--porcelain']),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  visibleCpuCount: cpus().length,
  visibleMemoryBytes: totalmem(),
  cgroupCpuMax: readLimit('cpu.max'),
  cgroupMemoryMax: readLimit('memory.max'),
  browser: browser || 'Playwright/default test selection',
  browserVersion: browser ? readCommand(browser, ['--version']) : null,
  cargoAvailable: readCommand('cargo', ['--version']) !== null,
  excluded: [
    'Rust build/test/clippy and full build/verify',
    'Rust-backed HTTP/CDP, lifecycle and feature-views acceptance',
    'AppKit/EventKit/native window acceptance and macOS arm64 packaging',
  ],
  steps: [],
};
const steps = [
  ['build-web', 'npm', ['run', 'build:web']],
  ['format-check', 'npm', ['run', 'format:check']],
  ['audit-source', 'npm', ['run', 'audit:source']],
  [
    'node-tests',
    process.execPath,
    [
      '--test',
      ...readdirSync(resolve(root, 'tests'))
        .filter((name) => name.endsWith('.test.mjs'))
        .sort()
        .map((name) => `tests/${name}`),
    ],
  ],
  ['workbench', process.execPath, ['tests/workbench.mjs']],
  ['glass', process.execPath, ['tests/embedded-glass.mjs']],
  ['model-control-host', process.execPath, ['tests/model-control-host.mjs']],
];
const save = () =>
  writeFileSync(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
save();
for (const [name, command, args] of steps) {
  console.log(`Running ${name}; log: target/reports/web-pilot/${name}.log`);
  const descriptor = openSync(resolve(output, `${name}.log`), 'w');
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: ['ignore', descriptor, descriptor],
  });
  closeSync(descriptor);
  report.steps.push({
    name,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message,
    durationMs: Date.now() - start,
    log: `${name}.log`,
  });
  save();
  console.log(`${name}: ${report.steps.at(-1).status}`);
}
report.finishedAt = new Date().toISOString();
report.passed = report.steps.every((step) => step.status === 'passed');
save();
console.log('Native checks excluded; Node test logs record their own skips. See results.json.');
if (!report.passed) process.exitCode = 1;
