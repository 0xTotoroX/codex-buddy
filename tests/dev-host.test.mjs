/*
 * [INPUT]: 临时配置、合成本机 CDP/API 与开发常量构建。
 * [OUTPUT]: 真实目标选择、配置/存储隔离、安装版恢复及无宿主启动的错误/清理契约。
 * [POS]: 开发宿主边界回归；不连接用户应用或读取真实聊天。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, symlinkSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import {
  endpointUrl,
  hostSettingsDirectory,
  realTarget,
  findHost,
  findDevelopmentHost,
  initializeData,
  restoreInstallation,
  requestRuntime,
} from '../scripts/dev-host.mjs';

const temporary = (t) => {
  const path = mkdtempSync(join(tmpdir(), 'buddy-real-dev-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};
async function server(t, handler) {
  const instance = createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        instance.closeAllConnections();
        instance.close(resolve);
      }),
  );
  return { port: instance.address().port, origin: `http://127.0.0.1:${instance.address().port}` };
}
test('real development accepts only local CDP and actual app pages', () => {
  assert.equal(endpointUrl('9229'), 'http://127.0.0.1:9229');
  for (const endpoint of [
    'https://127.0.0.1:9229',
    'http://example.com:9229',
    'http://127.0.0.1:9229/fixture',
    'http://u:p@localhost:9229',
  ])
    assert.throws(() => endpointUrl(endpoint));
  assert.equal(
    realTarget({ type: 'page', url: 'app://-/index.html?initialRoute=/threads/example' }),
    true,
  );
  for (const url of [
    'http://127.0.0.1:1234/fixture',
    'app://-/index.html?initialRoute=/settings',
    'app://-/index.html?initialRoute=/overlay',
  ])
    assert.equal(realTarget({ type: 'page', url }), false);
});

test('Dev startup reads its own force/ask setting and inherits installation only before first configuration', (t) => {
  const source = temporary(t),
    data = join(source, 'dev');
  mkdirSync(data);
  writeFileSync(join(source, 'config.json'), JSON.stringify({ hostRestartPolicy: 'ask' }));
  assert.equal(hostSettingsDirectory(source, data), source);
  writeFileSync(join(data, 'config.json'), JSON.stringify({ hostRestartPolicy: 'force' }));
  assert.equal(
    JSON.parse(readFileSync(join(hostSettingsDirectory(source, data), 'config.json')))
      .hostRestartPolicy,
    'force',
  );
  writeFileSync(join(source, 'config.json'), JSON.stringify({ hostRestartPolicy: 'force' }));
  writeFileSync(join(data, 'config.json'), JSON.stringify({ hostRestartPolicy: 'ask' }));
  assert.equal(
    JSON.parse(readFileSync(join(hostSettingsDirectory(source, data), 'config.json')))
      .hostRestartPolicy,
    'ask',
  );
});

test('API failures retain the backend reason instead of only an HTTP status', async (t) => {
  const api = await server(t, (_, res) =>
    res.writeHead(400).end(JSON.stringify({ message: '所选 Codex 窗口已关闭' })),
  );
  await assert.rejects(
    requestRuntime({ port: api.port, token: 'synthetic' }, 'connect', {}),
    /connect 请求失败 \(400\)：所选 Codex 窗口已关闭/,
  );
});

test('a verified replacement can retire a missing old target without connecting installation elsewhere', async (t) => {
  const root = temporary(t),
    journal = join(root, 'paused.json'),
    requests = [];
  const old = await server(t, (_, res) => res.end('[]'));
  const api = await server(t, (req, res) => {
    requests.push(req.url);
    res.end(JSON.stringify({ connection: { status: 'disconnected' } }));
  });
  const saved = JSON.stringify({
    runtime: { port: api.port, token: 'synthetic' },
    endpoint: old.origin,
    targetId: 'old-window',
    detached: true,
  });
  writeFileSync(journal, saved, { mode: 0o600 });
  await restoreInstallation(journal, { endpoint: old.origin, target: { id: 'new-window' } });
  assert.deepEqual(requests, ['/api/state']);
  assert.equal(existsSync(journal), false);
  const archived = readdirSync(root).find((name) => name.startsWith('paused.json.stale-'));
  assert.equal(readFileSync(join(root, archived), 'utf8'), saved);
  assert.equal(statSync(join(root, archived)).mode & 0o777, 0o600);
});

test('a still available original target is restored even when a different host was found', async (t) => {
  const root = temporary(t),
    journal = join(root, 'paused.json'),
    requests = [];
  const old = await server(t, (_, res) =>
    res.end(JSON.stringify([{ id: 'old', type: 'page', url: 'app://-/index.html' }])),
  );
  const api = await server(t, (req, res) => {
    requests.push(req.url);
    res.end(JSON.stringify({ connection: { status: 'disconnected' } }));
  });
  writeFileSync(
    journal,
    JSON.stringify({
      runtime: { port: api.port, token: 'synthetic' },
      endpoint: old.origin,
      targetId: 'old',
    }),
  );
  await restoreInstallation(journal, { endpoint: old.origin, target: { id: 'new' } });
  assert.deepEqual(requests, ['/api/state', '/api/connect']);
  assert.equal(existsSync(journal), false);
});

test('no-host startup reports one useful error and leaves the old restoration journal untouched', async (t) => {
  const root = temporary(t),
    scripts = join(root, 'scripts'),
    data = join(root, 'target/dev/real');
  mkdirSync(scripts);
  mkdirSync(data, { recursive: true });
  for (const file of [
    'dev.mjs',
    'dev-sources.mjs',
    'dev-host.mjs',
    'dev-panel.mjs',
    'dev-runtime.mjs',
    'build-panel.mjs',
  ])
    copyFileSync(resolve(import.meta.dirname, '../scripts', file), join(scripts, file));
  mkdirSync(join(root, 'ui/settings'), { recursive: true });
  copyFileSync(
    resolve(import.meta.dirname, '../ui/settings/dev-sources.js'),
    join(root, 'ui/settings/dev-sources.js'),
  );
  symlinkSync(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'), 'dir');
  const requests = [];
  const api = await server(t, (req, res) => {
    requests.push(req.url);
    res.end('{}');
  });
  const host = await server(t, (_, res) => res.end('[]'));
  const journal = join(root, 'target/dev/paused-installation.json');
  const saved = JSON.stringify({
    runtime: { port: api.port, token: 'synthetic' },
    endpoint: host.origin,
    targetId: 'old',
  });
  writeFileSync(journal, saved);
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [join(scripts, 'dev.mjs'), '--no-open', '--cdp', host.origin],
      {
        env: { ...process.env, CODEX_BUDDY_HOME: join(root, 'installation') },
        timeout: 10000,
      },
    ),
    (error) => error.code === 1 && error.stderr.split('没有找到可调试的真实 Codex').length === 2,
  );
  assert.deepEqual(requests, []);
  assert.equal(readFileSync(journal, 'utf8'), saved);
  assert.match(
    readJsonForTest(join(root, 'target/dev/launcher-error.json')).message,
    /没有找到可调试/,
  );
  assert.equal(existsSync(join(root, 'target/dev/owner.json')), false);
});

function readJsonForTest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
test('host discovery uses configured real window and never falls back to a fixture', async (t) => {
  const source = temporary(t);
  let targets = [
    { id: 'one', type: 'page', url: 'app://-/index.html' },
    { id: 'two', type: 'page', url: 'app://-/index.html' },
  ];
  const endpoint = await server(t, (_, res) => res.end(JSON.stringify(targets)));
  writeFileSync(join(source, 'config.json'), JSON.stringify({ targetId: 'two' }));
  const host = await findHost(source, { cdp: endpoint.origin });
  assert.equal(host.target.id, 'two');
  await assert.rejects(findHost(source, { cdp: endpoint.origin, target: 'missing' }), /不存在/);
  targets = [{ id: 'fixture', type: 'page', url: endpoint.origin + '/fixture' }];
  await assert.rejects(findHost(source, { cdp: endpoint.origin }), /没有找到可调试的真实 Codex/);
});
test('Dev prepares a missing host once, then discovers its real page without changing installation settings', async (t) => {
  const source = temporary(t);
  const saved = JSON.stringify({ hostRestartPolicy: 'force', cdpEndpoint: 'http://127.0.0.1:1' });
  writeFileSync(join(source, 'config.json'), saved);
  const originalFetch = globalThis.fetch;
  const host = await server(t, (_, res) =>
    res.end(JSON.stringify([{ id: 'reopened', type: 'page', url: 'app://-/index.html' }])),
  );
  t.mock.method(globalThis, 'fetch', (url, options) =>
    String(url).startsWith(host.origin)
      ? originalFetch(url, options)
      : Promise.reject(new Error('fixture: no host')),
  );
  let preparations = 0;
  const found = await findDevelopmentHost(source, { 'restart-running': true }, async () => {
    preparations++;
    return host.origin + '\n';
  });
  assert.equal(preparations, 1);
  assert.equal(found.target.id, 'reopened');
  assert.equal(readFileSync(join(source, 'config.json'), 'utf8'), saved);
});

test('Dev respects cancellation and explicit connection choices without retrying restart', async (t) => {
  const source = temporary(t);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fixture: no host');
  });
  let preparations = 0;
  const prepare = async () => {
    preparations++;
    throw new Error('已取消重开，ChatGPT 保持运行。');
  };
  await assert.rejects(
    findDevelopmentHost(source, { 'restart-running': true }, prepare),
    /已取消重开/,
  );
  assert.equal(preparations, 1);
  for (const options of [
    {},
    { 'restart-running': true, cdp: '12345' },
    { 'restart-running': true, target: 'selected' },
  ])
    await assert.rejects(findDevelopmentHost(source, options, prepare), /没有找到可调试/);
  assert.equal(preparations, 1);
});

test('Dev reuses an available host and never invokes restart policy', async (t) => {
  const source = temporary(t);
  const host = await server(t, (_, res) =>
    res.end(JSON.stringify([{ id: 'same', type: 'page', url: 'app://-/index.html' }])),
  );
  writeFileSync(join(source, 'config.json'), JSON.stringify({ cdpEndpoint: host.origin }));
  const found = await findDevelopmentHost(source, { 'restart-running': true }, () =>
    assert.fail('must reuse'),
  );
  assert.equal(found.target.id, 'same');
});

test('first real session copies settings privately and later sessions preserve development edits', (t) => {
  const root = temporary(t),
    source = join(root, 'installed'),
    data = join(root, 'dev');
  mkdirSync(source);
  mkdirSync(data);
  const original = JSON.stringify({
    model: 'test-model',
    stepwise: { generationMode: 'auto', maxItems: 3 },
  });
  writeFileSync(join(source, 'config.json'), original);
  writeFileSync(join(source, 'secrets.json'), JSON.stringify({ apiKey: 'synthetic-test-value' }));
  const host = { endpoint: 'http://127.0.0.1:9229', target: { id: 'one' } };
  initializeData(source, data, host);
  const config = JSON.parse(readFileSync(join(data, 'config.json')));
  assert.equal(config.stepwise.generationMode, 'manual');
  assert.equal(config.model, 'test-model');
  assert.equal(config.stepwise.maxItems, 3);
  assert.equal(statSync(join(data, 'secrets.json')).mode & 0o777, 0o600);
  config.model = 'dev-only';
  writeFileSync(join(data, 'config.json'), JSON.stringify(config));
  initializeData(source, data, { ...host, target: { id: 'two' } });
  assert.equal(JSON.parse(readFileSync(join(data, 'config.json'))).model, 'dev-only');
  assert.equal(readFileSync(join(source, 'config.json'), 'utf8'), original);
});
test('restoration reconnects the original window and retains recovery on failure', async (t) => {
  const root = temporary(t),
    journal = join(root, 'paused.json'),
    requests = [];
  let unavailable = false;
  const api = await server(t, (req, res) => {
    if (unavailable) {
      res.writeHead(503).end('{}');
      return;
    }
    assert.equal(req.headers.authorization, 'Bearer synthetic');
    requests.push(req.url);
    res.end(
      JSON.stringify(
        req.url === '/api/state' ? { connection: { status: 'disconnected' } } : { ok: true },
      ),
    );
  });
  const saved = {
    runtime: { port: api.port, token: 'synthetic' },
    endpoint: 'http://127.0.0.1:9229',
    targetId: 'one',
    detached: true,
  };
  writeFileSync(journal, JSON.stringify(saved));
  await restoreInstallation(journal);
  assert.deepEqual(requests, ['/api/state', '/api/connect', '/api/panel/open']);
  assert.equal(existsSync(journal), false);
  writeFileSync(journal, JSON.stringify(saved));
  unavailable = true;
  await assert.rejects(restoreInstallation(journal), /恢复记录已保留/);
  assert.equal(existsSync(journal), true);
});
test('development storage never reads or migrates installation preferences', async () => {
  for (const development of [false, true]) {
    const result = await build({
      absWorkingDir: resolve(import.meta.dirname, '..'),
      stdin: {
        contents: "import * as c from './ui/panel/runtime/constants.js'; globalThis.result=c;",
        resolveDir: resolve(import.meta.dirname, '..'),
      },
      bundle: true,
      write: false,
      format: 'iife',
      define: { CODEX_BUDDY_DEVELOPMENT: String(development) },
    });
    const context = { window: {} };
    runInNewContext(result.outputFiles[0].text, context);
    for (const [key, value] of Object.entries(context.result).filter(
      ([key]) => key.endsWith('_KEY') && key !== 'API_KEY',
    )) {
      assert.equal(value.startsWith('codex-buddy-dev:'), development, key);
    }
    assert.equal(context.result.DEVELOPMENT, development);
  }
});

test('an orphan development backend blocks startup before touching installation recovery', async (t) => {
  const root = temporary(t),
    scripts = join(root, 'scripts'),
    data = join(root, 'target/dev/real');
  mkdirSync(scripts);
  mkdirSync(data, { recursive: true });
  for (const file of [
    'dev.mjs',
    'dev-sources.mjs',
    'dev-host.mjs',
    'dev-panel.mjs',
    'dev-runtime.mjs',
    'build-panel.mjs',
  ])
    copyFileSync(resolve(import.meta.dirname, '../scripts', file), join(scripts, file));
  mkdirSync(join(root, 'ui/settings'), { recursive: true });
  copyFileSync(
    resolve(import.meta.dirname, '../ui/settings/dev-sources.js'),
    join(root, 'ui/settings/dev-sources.js'),
  );
  symlinkSync(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'), 'dir');
  writeFileSync(join(data, 'runtime.json'), JSON.stringify({ pid: process.pid }));
  const requests = [];
  const api = await server(t, (req, res) => {
    requests.push(req.url);
    res.end('{}');
  });
  const journal = join(root, 'target/dev/paused-installation.json');
  writeFileSync(journal, JSON.stringify({ runtime: { port: api.port, token: 'synthetic' } }));
  await assert.rejects(
    promisify(execFile)(process.execPath, [join(scripts, 'dev.mjs'), '--no-open'], {
      env: { ...process.env, CODEX_BUDDY_HOME: join(root, 'installation') },
      timeout: 10000,
    }),
    (error) => error.code === 1 && error.stderr.includes('开发数据目录仍有后台运行'),
  );
  assert.deepEqual(requests, []);
  assert.equal(existsSync(journal), true);
  assert.equal(existsSync(join(root, 'target/dev/owner.json')), false);
});
