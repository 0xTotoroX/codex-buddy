/*
 * [INPUT]: Caller-built CODEX_BUDDY_TEST_BINARY (default target/debug/codex-buddy), synthetic Chrome.
 * [OUTPUT]: Authenticated HTTP -> Rust -> real CDP -> embedded host.js -> official fixture readback.
 * [POS]: Bounded standalone integration test; no live-host discovery, build, native window or model calls.
 * [PROTOCOL]: Parent prepares the binary and integrates verify/maps. Only fixture setup uses page.evaluate;
 * adapter installation and every snapshot/apply under test must pass through the real backend.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { records, installModelControlFixture } from './model-control-fixture.mjs';

const root = resolve(import.meta.dirname, '..');
const binary = resolve(
  process.env.CODEX_BUDDY_TEST_BINARY || join(root, 'target/debug/codex-buddy'),
);
assert.ok(existsSync(binary), 'Build the test binary first, or set CODEX_BUDDY_TEST_BINARY');
const output = join(root, 'target/reports/model-control-e2e');
mkdirSync(output, { recursive: true });
const report = {
  binary,
  sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
  passed: false,
  checks: [],
  errors: [],
};
const directory = mkdtempSync(join(tmpdir(), 'buddy-model-control-e2e-'));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const record = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
let service,
  chromeServer,
  browser,
  runtime,
  serviceError = '',
  serviceLog = '',
  expired = false;
const unexpectedRequests = [],
  pageErrors = [];
const fixture = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path === '/fixture' && request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end(
      `<!doctype html><title>Model control synthetic host</title><body><script>(${installModelControlFixture.toString()})(${JSON.stringify({ records, options: { modern: new URL(request.url, 'http://127.0.0.1').searchParams.has('modern'), openPlaceholder: true, speedFlyout: true } })});</script></body>`,
    );
  } else if (path === '/favicon.ico') {
    response.writeHead(204);
    response.end();
  } else {
    unexpectedRequests.push({ method: request.method, path });
    response.writeHead(503);
    response.end('No model service exists in this fixture');
  }
});
const budget = setTimeout(() => {
  expired = true;
  report.passed = false;
  report.errors.push('Integration test exceeded its 60s budget');
  process.exitCode = 1;
  service?.kill('SIGKILL');
  chromeServer?.process().kill('SIGKILL');
}, 60000);
async function waitFor(read, message, timeout = 10000) {
  const end = Date.now() + timeout;
  do {
    if (expired) throw new Error('Integration test exceeded its 60s budget');
    if (serviceError) throw new Error(serviceError);
    if (service && service.exitCode !== null)
      throw new Error(`Backend exited (${service.exitCode})`);
    const value = await read();
    if (value) return value;
    await delay(50);
  } while (Date.now() < end);
  throw new Error(message);
}
async function stopService() {
  if (!service || service.exitCode !== null || service.signalCode !== null) return;
  const exited = new Promise((done) => service.once('exit', done));
  service.kill('SIGTERM');
  await Promise.race([exited, delay(2500)]);
  if (service.exitCode === null && service.signalCode === null) {
    service.kill('SIGKILL');
    await Promise.race([exited, delay(1000)]);
  }
}
try {
  await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
  const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
  const reserve = createServer();
  await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
  const debugPort = reserve.address().port;
  await new Promise((done) => reserve.close(done));
  const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  chromeServer = await chromium.launchServer({
    executablePath:
      process.env.CODEX_BUDDY_CHROME_BIN ||
      (existsSync(installedChrome) ? installedChrome : undefined),
    headless: true,
    timeout: 10000,
    args: [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'],
  });
  browser = await chromium.connect(chromeServer.wsEndpoint(), { timeout: 10000 });
  const context = await browser.newContext();
  context.setDefaultTimeout(8000);
  context.setDefaultNavigationTimeout(8000);
  // A second eligible page makes selecting the configured target observable, rather than incidental.
  const page = await context.newPage();
  const decoy = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  decoy.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${fixtureOrigin}/fixture?selected=1`);
  await decoy.goto(`${fixtureOrigin}/fixture?decoy=1`);
  assert.equal(await page.evaluate(() => typeof window.__codexBuddyModelControl), 'undefined');
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.detach();
  const targetId = targetInfo.targetId;
  writeFileSync(
    join(directory, 'config.json'),
    JSON.stringify({
      cdpEndpoint: `http://127.0.0.1:${debugPort}`,
      targetId,
      provider: 'api',
      model: 'unused-synthetic',
      baseUrl: `${fixtureOrigin}/forbidden-model`,
      stepwise: { enabled: false, answerOutlineEnabled: false, generationMode: 'manual' },
    }),
    { mode: 0o600 },
  );
  const env = { ...process.env, CODEX_BUDDY_PANEL_TEST: '1' };
  // Do not inherit development asset overrides, real credentials or model routing from the caller.
  for (const key of Object.keys(env)) if (/^(CODEX_BUDDY_|COMPANION_)/.test(key)) delete env[key];
  env.CODEX_BUDDY_PANEL_TEST = '1';
  service = spawn(binary, ['--data-dir', directory, 'serve', '--port', '0', '--allow-fixture'], {
    cwd: tmpdir(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  service.on('error', (error) => {
    serviceError = error.message;
  });
  for (const stream of [service.stdout, service.stderr])
    stream.on('data', (bytes) => {
      serviceLog = (serviceLog + bytes).slice(-5000);
    });
  runtime = await waitFor(() => {
    try {
      return JSON.parse(readFileSync(join(directory, 'runtime.json'), 'utf8'));
    } catch {
      return null;
    }
  }, 'Backend runtime was not created');
  assert.equal(runtime.pid, service.pid);
  const base = `http://127.0.0.1:${runtime.port}`;
  async function request(path, body, auth = true) {
    const response = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(auth ? { Authorization: `Bearer ${runtime.token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(23000),
    });
    return { status: response.status, body: await response.json() };
  }
  async function api(action, body) {
    const response = await request(`model-control/${action}`, body);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }
  const command = (snapshot, selection) => ({
    target: snapshot.target,
    expectedRevision: snapshot.revision,
    selection,
  });
  const initial = { model: 'alpha', reasoning: 'low', speed: 'standard' };
  const fast = { model: 'alpha', reasoning: 'high', speed: 'fast' };
  const beta = { model: 'beta', reasoning: 'high', speed: 'standard' };
  await page.waitForFunction(() => typeof window.__codexBuddyModelControl?.snapshot === 'function');
  await waitFor(
    async () => (await request('state')).body.connection?.targetId === targetId,
    'Backend did not use the configured target',
  );
  for (const [path, body] of [
    ['state', undefined],
    ['refresh', {}],
    ['apply', command({ target: { id: 'chat-a' }, revision: 'fake' }, fast)],
  ]) {
    assert.equal((await request(`model-control/${path}`, body, false)).status, 401);
  }
  assert.equal(await page.evaluate(() => host.triggerEvents), 0);
  record(
    'real backend installs adapter into the configured CDP target; API requires authentication',
  );

  const missing = await api('state');
  assert.equal(missing.snapshot.status, 'waiting');
  assert.deepEqual(missing.snapshot.models, []);
  await page.evaluate(() => capability('backend-observed'));
  const passive = await api('state');
  assert.equal(passive.snapshot.target.id, 'chat-a');
  assert.equal(passive.snapshot.status, 'waiting');
  assert.equal(passive.snapshot.current, null);
  assert.deepEqual(
    passive.snapshot.models.map((model) => model.id),
    ['alpha', 'beta'],
  );
  assert.equal(await page.evaluate(() => host.triggerEvents), 0);
  record('authenticated passive state observes correlated capabilities without opening menus');

  const refreshed = await api('refresh', {});
  assert.equal(refreshed.snapshot.status, 'ready');
  assert.deepEqual(refreshed.snapshot.current, initial);
  assert.ok(await page.evaluate(() => host.triggerEvents > 0));
  assert.equal(await page.locator('[role="menu"]').count(), 0);
  record('authenticated refresh opens official fixture menus and returns complete readback');

  const applied = await api('apply', command(refreshed.snapshot, fast));
  assert.equal(applied.result.status, 'success');
  assert.deepEqual(applied.result.previous, initial);
  assert.deepEqual(applied.snapshot.current, fast);
  assert.deepEqual(await page.evaluate(() => host.configs['chat-a']), fast);
  assert.deepEqual((await api('state')).snapshot.current, fast);
  assert.notEqual(applied.snapshot.revision, refreshed.snapshot.revision);
  record(
    'authenticated apply changes reasoning and speed via official menus and returns actual state',
  );
  const diagnosticPath = join(directory, 'model-control-diagnostic.json');
  const diagnosticText = readFileSync(diagnosticPath, 'utf8');
  const diagnostic = JSON.parse(diagnosticText);
  assert.equal(diagnostic.kind, 'apply');
  assert.equal(diagnostic.status, 'success');
  assert.equal(diagnostic.diagnostic.failure, null);
  assert.ok(diagnostic.diagnostic.steps.includes('读取当前配置'));
  assert.equal(statSync(diagnosticPath).mode & 0o777, 0o600);
  assert.ok(!diagnosticText.includes('chat-a') && !diagnosticText.includes('Draft'));
  await api('state');
  assert.equal(readFileSync(diagnosticPath, 'utf8'), diagnosticText);
  record('private bounded operation diagnostic excludes chat data and survives passive polling');

  let clicks = await page.evaluate(() => host.triggerEvents);
  const staleRevision = await api('apply', command(refreshed.snapshot, beta));
  assert.equal(staleRevision.result.status, 'failed');
  const invalid = await api('apply', command(applied.snapshot, { ...beta, speed: 'fast' }));
  assert.equal(invalid.result.status, 'failed');
  assert.equal(await page.evaluate(() => host.triggerEvents), clicks);
  record('stale revision and invalid complete preset reject through real API before menu mutation');

  await page.evaluate(() => {
    host.delay = 200;
  });
  const pending = api('apply', command(applied.snapshot, beta));
  await page.waitForFunction(() =>
    host.clicks.some((entry) => entry.action === 'select:model:beta'),
  );
  assert.equal((await api('state')).snapshot.status, 'busy');
  assert.equal(
    (await request('model-control/apply', command(applied.snapshot, initial))).status,
    400,
  );
  const delayed = await pending;
  assert.equal(delayed.result.status, 'success');
  assert.deepEqual(delayed.snapshot.current, beta);
  assert.deepEqual(await page.evaluate(() => host.configs['chat-a']), beta);
  record(
    'backend serializes operations and awaits delayed model default reset plus reasoning readback',
  );

  await page.evaluate(() => {
    host.delay = 0;
    addChat('chat-b').querySelector('.ProseMirror').focus();
  });
  clicks = await page.evaluate(() => host.triggerEvents);
  const targetStale = await api('apply', command(delayed.snapshot, fast));
  assert.equal(targetStale.result.status, 'failed');
  assert.equal(targetStale.snapshot.target.id, 'chat-b');
  assert.equal(await page.evaluate(() => host.triggerEvents), clicks);
  assert.deepEqual(await page.evaluate(() => host.configs['chat-b']), initial);
  assert.deepEqual((await api('refresh', {})).snapshot.current, initial);
  record('old chat target fails through backend/CDP without changing the newly focused composer');

  assert.deepEqual(await page.evaluate(() => host.unexpected), []);
  await page.reload();
  // No test-side injection: this must come from backend Page.addScriptToEvaluateOnNewDocument.
  await page.waitForFunction(() => typeof window.__codexBuddyModelControl?.snapshot === 'function');
  await page.evaluate(() => capability('after-navigation'));
  const navigated = await api('refresh', {});
  assert.equal(navigated.snapshot.status, 'ready');
  assert.deepEqual(navigated.snapshot.current, initial);
  assert.notEqual(
    navigated.snapshot.revision.split(':')[0],
    refreshed.snapshot.revision.split(':')[0],
  );
  clicks = await page.evaluate(() => host.triggerEvents);
  assert.equal((await api('apply', command(refreshed.snapshot, fast))).result.status, 'failed');
  assert.equal(await page.evaluate(() => host.triggerEvents), clicks);
  record('navigation reinstalls embedded adapter and rejects the prior document revision');

  await page.goto(`${fixtureOrigin}/fixture?modern=1`);
  await page.waitForFunction(() => typeof window.__codexBuddyModelControl?.snapshot === 'function');
  await page.evaluate(() => capability('modern-view'));
  const modern = await api('refresh', {});
  assert.equal(modern.snapshot.status, 'ready');
  const modernFast = await api('apply', command(modern.snapshot, fast));
  assert.equal(modernFast.result.status, 'success', modernFast.result.message);
  const opens = await page.evaluate(() => host.triggerEvents);
  await page.evaluate(() => {
    const stop = document.createElement('button');
    stop.textContent = 'Stop';
    document.querySelector('form').append(stop);
  });
  const live = await api('state');
  const preserved = await api('apply', {
    ...command(live.snapshot, { ...initial, reasoning: 'low' }),
    preserveSpeed: true,
  });
  assert.equal(preserved.result.status, 'success', preserved.result.message);
  assert.equal(preserved.snapshot.current.speed, 'fast');
  assert.equal(await page.evaluate(() => host.triggerEvents), opens + 1);
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  record('single transaction preserves actual Fast and changes configuration during generation');
  const modernBeta = await api('apply', command(preserved.snapshot, beta));
  assert.equal(modernBeta.result.status, 'success', modernBeta.result.message);
  assert.deepEqual(modernBeta.snapshot.current, beta);
  assert.equal(await page.locator('[role="menu"]').count(), 0);
  record('embedded adapter switches modern same-root model view, slider and Fast through Rust/CDP');

  assert.equal(await decoy.evaluate(() => typeof window.__codexBuddyModelControl), 'undefined');
  assert.equal(await decoy.evaluate(() => host.triggerEvents), 0);
  assert.deepEqual(await page.evaluate(() => host.unexpected), []);
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(pageErrors, []);
  record('decoy target untouched; no model requests or page errors');
  const settingsPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  settingsPage.on('pageerror', (error) => pageErrors.push(error.message));
  await settingsPage.goto(`${base}/#token=${runtime.token}`);
  const section = settingsPage.getByRole('region', { name: '模型快切设置' });
  await settingsPage.getByLabel('模型快切主题', { exact: true }).waitFor();
  await settingsPage.waitForFunction(
    () => !document.querySelector('[aria-label="模型快切主题"]').disabled,
  );
  assert.equal(
    await settingsPage.getByLabel('模型快切主题', { exact: true }).inputValue(),
    'black',
  );
  const change = async (name, value, key) => {
    await settingsPage.waitForFunction(
      (name) => !document.querySelector(`[aria-label="${name}"]`).disabled,
      name,
    );
    await settingsPage.getByLabel(name, { exact: true }).selectOption(value);
    await waitFor(async () => (await api('state')).preferences[key] === value, `saved ${key}`);
  };
  const beforeAppearance = (await request('state')).body.panelPreferences;
  await change('模型快切主题', 'matte', 'theme');
  await change('模型快切主题', 'frosted', 'theme');
  await change('模型快切边缘', 'left', 'edge');
  const screens = await api('displays');
  assert.equal((await request('model-control/displays', undefined, false)).status, 401);
  if (screens.screens.length) await change('模型快切屏幕', screens.screens[0].id, 'screen');
  const position = settingsPage.getByLabel('模型快切位置', { exact: true });
  await position.focus();
  await position.press('Home');
  await waitFor(
    async () => (await api('state')).preferences.position === 0,
    'keyboard position saves',
  );
  await change('模型快切主题', 'native-glass', 'theme');
  await change('模型快切液态变体', 'clear', 'liquidVariant');
  await settingsPage.reload();
  await settingsPage.waitForFunction(
    () => document.querySelector('[aria-label="模型快切主题"]')?.value === 'native-glass',
  );
  assert.equal(
    await settingsPage.getByLabel('模型快切液态变体', { exact: true }).inputValue(),
    'clear',
  );
  assert.deepEqual((await request('state')).body.panelPreferences, beforeAppearance);
  await section.screenshot({ path: join(output, 'settings-placement-themes.png') });
  await settingsPage.close();
  record('settings page persists screen, edge, keyboard position and four independent themes');
  assert.deepEqual(pageErrors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(String(error.stack || error));
  if (serviceLog)
    report.serviceLog = serviceLog.replaceAll(runtime?.token || 'never-match-token', '[redacted]');
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopService();
  if (browser) await Promise.race([browser.close().catch(() => {}), delay(2500)]);
  if (chromeServer) {
    await Promise.race([chromeServer.close().catch(() => {}), delay(2500)]);
    if (chromeServer.process().exitCode === null && chromeServer.process().signalCode === null)
      chromeServer.process().kill('SIGKILL');
  }
  fixture.closeAllConnections();
  await new Promise((done) => fixture.close(done));
  clearTimeout(budget);
  rmSync(directory, { recursive: true, force: true });
  report.expired = expired;
  report.pageErrors = pageErrors;
  report.unexpectedRequests = unexpectedRequests;
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(
  `${report.checks.length} integration checks ${report.passed ? 'passed' : 'completed before failure'}`,
);
