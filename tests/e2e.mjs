/*
 * [INPUT]: 独立 Chromium、合成 fixture、release/debug 程序与模型 stub。
 * [OUTPUT]: target/reports/e2e 下的 CDP、设置、建议、大纲及弹出交互验收报告。
 * [POS]: 端到端测试入口，委托 popout-checks 验证窗口协议。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import assert from 'node:assert/strict';
import { prepareTestBinary } from '../scripts/verify.mjs';
import { createServer, request as httpRequest } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { checkPopout } from './popout-checks.mjs';

const root = resolve(import.meta.dirname, '..');
const artifact = prepareTestBinary();
const binary = artifact.binary;
const popoutOnly = process.argv.includes('--popout-only');
const output = join(root, 'target/reports', popoutOnly ? 'popout' : 'e2e');
mkdirSync(output, { recursive: true });
rmSync(join(output, 'e2e-report.json'), { force: true });
const dataDir = mkdtempSync(join(tmpdir(), 'companion-desktop-e2e-'));
const reports = [];
const record = (name) => {
  reports.push(name);
  console.log(`PASS ${name}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, message, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await delay(80);
  }
  throw new Error(message);
}
const suggestions = [
  {
    title: '拆解开发步骤',
    detail: '将桌面显示、配置和模型请求排成可验证的工作顺序。',
    prompt: '请把这个方案拆成按依赖顺序排列的开发任务，并为每项任务给出可观察的验收标准。',
  },
  {
    title: '核对边界与数据',
    detail: '检查任务切换与模型响应之间的上下文一致性。',
    prompt: '请设计一组会话隔离测试，覆盖切换任务、断线重连和过期结果，说明每个测试如何判断通过。',
  },
  {
    title: '完善草稿保护',
    detail: '保留已有文字，让每次输入变化都可以检查。',
    prompt:
      '请具体设计建议填入 Codex 草稿的交互，确保保留已有内容，并覆盖追加前草稿再次变化的情况。',
  },
  {
    title: '检查浮窗交互',
    detail: '逐项验证材质、收放、拖拽、缩放和面板切换。',
    prompt: '请列出浮窗交互的验收步骤，覆盖三种材质、明暗模式、收放动画、拖拽缩放和面板排序。',
  },
];
let apiMode = 'ok';
let modelDelay = 80;
let lastBody;
const calls = [];
const fixture = createServer(async (req, res) => {
  if (req.url === '/fixture') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(root, 'tests/host-fixture.html')));
    return;
  }
  if (req.url === '/v1/models') {
    assert.ok(
      req.headers.authorization === 'Bearer fixture-key' ||
        req.headers['x-api-key'] === 'fixture-key',
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'fixture-model' }, { id: 'second-model' }] }));
    return;
  }
  const protocol = {
    '/v1/responses': 'responses',
    '/v1/chat/completions': 'chat_completions',
    '/v1/messages': 'anthropic_messages',
  }[req.url];
  if (protocol && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    lastBody = body;
    assert.equal(
      protocol === 'anthropic_messages' ? req.headers['x-api-key'] : req.headers.authorization,
      protocol === 'anthropic_messages' ? 'fixture-key' : 'Bearer fixture-key',
    );
    if (protocol === 'responses') {
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, 'json_schema');
    }
    if (protocol === 'chat_completions') assert.equal(body.response_format.type, 'json_schema');
    if (protocol === 'anthropic_messages') {
      assert.equal(req.headers['anthropic-version'], '2023-06-01');
      assert.equal(body.output_config.format.type, 'json_schema');
    }
    const mode = apiMode;
    calls.push({ protocol, mode });
    await delay(modelDelay);
    if (mode === 'http') {
      res.writeHead(503);
      res.end('upstream problem');
      return;
    }
    if (mode === 'auth') {
      res.writeHead(401);
      res.end('credentials rejected');
      return;
    }
    if (mode === 'fallback' && protocol === 'responses') {
      res.writeHead(404);
      res.end();
      return;
    }
    const max =
      protocol === 'responses'
        ? body.text.format.schema.properties.suggestions.maxItems
        : protocol === 'chat_completions'
          ? body.response_format.json_schema.schema.properties.suggestions.maxItems
          : body.output_config.format.schema.properties.suggestions.maxItems;
    const text =
      mode === 'bad' ? 'not JSON' : JSON.stringify({ suggestions: suggestions.slice(0, max) });
    const payload =
      protocol === 'responses'
        ? {
            status: mode === 'truncated' ? 'incomplete' : 'completed',
            output: [{ content: [{ type: 'output_text', text }] }],
          }
        : protocol === 'chat_completions'
          ? {
              choices: [
                {
                  finish_reason: mode === 'truncated' ? 'length' : 'stop',
                  message: { content: text },
                },
              ],
            }
          : {
              stop_reason: mode === 'truncated' ? 'max_tokens' : 'end_turn',
              content: [{ type: 'text', text }],
            };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixturePort = fixture.address().port;
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const debugPort = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath =
  process.env.CODEX_BUDDY_CHROME_BIN ||
  (process.platform === 'darwin' && existsSync(localChrome) ? localChrome : undefined);
let browser;
let service;
let serviceLog = '';
let runtime;
let desktop;
let page;
const errors = [];
try {
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [`--remote-debugging-port=${debugPort}`],
  });
  const context = await browser.newContext({
    viewport: { width: 1320, height: 1000 },
    colorScheme: 'light',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  desktop = await context.newPage();
  desktop.on('pageerror', (error) => errors.push(`desktop: ${error.message}`));
  await desktop.goto(`http://127.0.0.1:${fixturePort}/fixture`);
  writeFileSync(
    join(dataDir, 'config.json'),
    JSON.stringify({
      provider: 'api',
      model: 'fixture-model',
      baseUrl: `http://127.0.0.1:${fixturePort}/v1`,
      unrelatedOption: { keep: true },
    }),
  );
  writeFileSync(join(dataDir, 'secrets.json'), JSON.stringify({ apiKey: 'fixture-key' }), {
    mode: 0o600,
  });
  const env = { ...process.env, CODEX_BUDDY_PANEL_TEST: '1' };
  for (const key of [
    'CODEX_BUDDY_PROVIDER',
    'CODEX_BUDDY_MODEL',
    'CODEX_BUDDY_BASE_URL',
    'CODEX_BUDDY_API_KEY',
  ])
    delete env[key];
  service = spawn(
    binary,
    ['--data-dir', dataDir, 'serve', '--port', '0', '--cdp', String(debugPort), '--allow-fixture'],
    { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  for (const stream of [service.stdout, service.stderr])
    stream.on('data', (chunk) => {
      serviceLog = (serviceLog + chunk).slice(-8000);
    });
  await waitFor(
    () => existsSync(join(dataDir, 'runtime.json')),
    'Service did not create runtime file',
  );
  runtime = JSON.parse(readFileSync(join(dataDir, 'runtime.json')));
  const base = `http://127.0.0.1:${runtime.port}`;
  const api = async (path, body) => {
    const response = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const settings = async () => (await api('settings')).body;
  const patch = async (body) => {
    const result = await api('settings', body);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const panelState = () =>
    desktop.evaluate(() => {
      const p = window.__companionFloatingPanel;
      return p
        ? {
            active: p.state.runtimeActive,
            open: p.state.open,
            transitioning:
              !!p.state.morphAnimation || !!p.state.viewTransitioning || !!p.state.faceClickTimer,
            tab: p.state.activeTab,
            outline: p.state.outlineItems.map((item) => ({ text: item.text, id: item.id })),
            count: p.state.prompts.length,
            status: p.state.bridgeStatus,
            error: p.state.bridgeError,
            mode: p.state.settings?.generationMode,
            material: p.state.material,
            theme: p.state.theme,
            order: p.state.viewOrder,
            clickMode: p.state.promptClickMode,
          }
        : null;
    });
  const settle = () =>
    waitFor(async () => {
      const p = await panelState();
      return p && !p.transitioning;
    }, 'Floating panel transition did not settle');
  const switchView = async (tab) => {
    await desktop.locator('.csw-head').hover();
    await desktop.locator(`[data-companion-stepwise-root] button[data-view="${tab}"]`).click();
    await waitFor(async () => (await panelState())?.tab === tab, `View ${tab} did not activate`);
    await settle();
  };
  const generate = async () => {
    if ((await panelState()).tab !== 'next') await switchView('next');
    await desktop.locator('.csw-head').hover();
    await desktop.locator('[data-companion-stepwise-root] [data-action="refresh"]').click();
    await waitFor(
      async () => (await panelState()).status === 'ok',
      'Desktop generation did not complete',
    );
    await settle();
  };

  await waitFor(async () => (await panelState())?.active, 'Desktop floating runtime did not start');
  if (popoutOnly) {
    await desktop.evaluate(() => window.__companionFloatingPanel.setOpen(true));
    await settle();
    await checkPopout({
      browser,
      desktop,
      api,
      base,
      runtime,
      dataDir,
      output,
      errors,
      record,
      waitFor,
      delay,
      generate,
      suggestions,
    });
    assert.deepEqual(errors, []);
    writeFileSync(
      join(output, 'e2e-report.json'),
      JSON.stringify(
        { artifact, scope: 'popout', passed: reports.length, reports, pageErrors: errors },
        null,
        2,
      ),
    );
    console.log(`All ${reports.length} popout checks passed`);
  } else {
    await waitFor(
      async () => (await panelState())?.outline.length > 2,
      'Desktop outline did not populate',
    );
    assert.equal(await desktop.locator('[data-companion-stepwise-root]').count(), 1);
    assert.equal(await desktop.evaluate(() => typeof window.__codexStepwisePanel), 'undefined');
    assert.equal(calls.length, 0);
    await waitFor(
      async () =>
        (await api('state')).body.desktop.headings === (await panelState()).outline.length,
      'Backend summary did not follow capsule outline',
    );
    const publicState = (await api('state')).body;
    assert.equal(publicState.connection.status, 'connected');
    assert.equal(publicState.snapshot, undefined);
    assert.equal(publicState.desktop.hasAnswer, true);
    assert.equal(publicState.desktop.headings, (await panelState()).outline.length);
    assert.ok(!JSON.stringify(publicState).includes('把想法变成'));
    record('独立桌面注入、无重复实例、配置网页不接收聊天正文');

    const systemMajor = Number(
      spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim().split('.')[0],
    );
    assert.equal((await settings()).popoutSupported, systemMajor >= 15);
    const gated = await desktop.evaluate(() => {
      const panel = window.__companionFloatingPanel;
      const settings = panel.state.settings;
      const results = [];
      for (const supported of [false, undefined, true]) {
        settings.popoutSupported = supported;
        panel.renderFloat();
        const button = document.querySelector('[data-action="detach"]');
        results.push({ disabled: button.disabled, title: button.title });
        if (!supported) {
          // Even a synthetic click cannot bypass the capability check.
          button.dispatchEvent(new MouseEvent('click'));
          const face = document.querySelector('.csw-head-face');
          face.dispatchEvent(new MouseEvent('click', { detail: 1 }));
          face.dispatchEvent(new MouseEvent('click', { detail: 2 }));
          if (panel.state.detachPending) throw new Error('Unsupported detach was dispatched');
        }
      }
      return results;
    });
    assert.deepEqual(
      gated.map((item) => item.disabled),
      [true, true, false],
    );
    assert.match(gated[0].title, /macOS 15/);
    record('内嵌弹出入口按后台能力禁用，缺失能力默认禁用且点击不能绕过');

    // Replacing the bundle must invalidate the old instance, pending callbacks and DOM together.
    const priorInstance = await desktop.evaluate(() => {
      window.__testPriorPanel = window.__companionFloatingPanel;
      return window.__testPriorPanel.instanceId;
    });
    const reinjectedScript = await (await fetch(`${base}/panel.js`)).text();
    await desktop.evaluate((script) => (0, eval)(script), reinjectedScript);
    await waitFor(async () => (await panelState())?.active, 'Reinjected runtime did not start');
    assert.notEqual(
      await desktop.evaluate(() => window.__companionFloatingPanel.instanceId),
      priorInstance,
    );
    assert.equal(await desktop.evaluate(() => window.__testPriorPanel.state.destroyed), true);
    assert.equal(await desktop.locator('[data-companion-stepwise-root]').count(), 1);
    assert.equal(await desktop.evaluate(() => typeof window.__codexCompanion_v1), 'undefined');
    const answerMarkup = await desktop.locator('#answer').innerHTML();
    await desktop.locator('#answer').evaluate((node) => {
      node.textContent = '';
    });
    await waitFor(
      async () => !(await api('state')).body.desktop.hasAnswer,
      'Empty answer left stale backend status',
    );
    await desktop.locator('#answer').evaluate((node, html) => {
      node.innerHTML = html;
    }, answerMarkup);
    await waitFor(
      async () => (await api('state')).body.desktop.hasAnswer,
      'Restored answer status did not recover',
    );
    record('模块重新注入销毁旧实例，后台只复用胶囊的回答识别与计数');

    const clickTiming = await desktop.evaluate(async () => {
      const p = window.__companionFloatingPanel;
      document.querySelector('.csw-fab').dispatchEvent(new MouseEvent('click', { detail: 1 }));
      const immediate = p.state.open;
      await new Promise((resolve) => setTimeout(resolve, 60));
      const beforeDelay = p.state.open;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        immediate,
        beforeDelay,
        afterDelay: p.state.open,
        supported: p.state.settings.popoutSupported,
      };
    });
    assert.deepEqual(
      clickTiming,
      clickTiming.supported
        ? { immediate: false, beforeDelay: false, afterDelay: true, supported: true }
        : { immediate: true, beforeDelay: true, afterDelay: true, supported: false },
    );
    await settle();
    assert.equal((await panelState()).open, true);
    assert.equal(await desktop.locator('.csw-panel').getAttribute('aria-hidden'), 'false');
    await generate();
    assert.equal((await panelState()).count, 4);
    assert.equal(calls.length, 1);
    const requestTrace = await desktop.evaluate(
      () =>
        window.__companionFloatingPanel
          .diagnostics()
          .find((item) => item.event === 'request:started')?.details,
    );
    assert.deepEqual(Object.keys(requestTrace).sort(), ['epoch', 'id', 'runtime', 'trigger']);
    for (const key of ['id', 'epoch', 'runtime'])
      assert.ok(Number.isInteger(requestTrace[key]) && requestTrace[key] >= 0);
    assert.equal(requestTrace.trigger, 'user');
    assert.ok(
      !(await desktop.evaluate(() =>
        JSON.stringify(window.__companionFloatingPanel.state.settings).includes('fixture-key'),
      )),
    );
    record('桌面按钮经 CDP binding 调用独立模型，密钥不进入 renderer');

    await desktop.locator('.csw-row[data-index="1"]').hover();
    await waitFor(
      async () =>
        (await desktop.locator('.csw-prompt-preview').getAttribute('data-preview-index')) === '1',
      'Hovered suggestion preview did not update',
    );
    await desktop.locator('.csw-row[data-index="0"]').click();
    const composer = desktop.getByRole('textbox', { name: '测试草稿' });
    await waitFor(
      async () => (await composer.textContent()) === suggestions[0].prompt,
      'Suggestion did not fill editor',
    );
    assert.equal(await desktop.evaluate(() => window.submitCount), 0);
    record('建议完整预览与默认仅填入');

    // Both feature switches preserve the other controller's state and pending work.
    const stableSuggestions = await desktop.evaluate(() => {
      const p = window.__companionFloatingPanel;
      return {
        prompts: p.state.prompts,
        epoch: p.state.stepwiseEpoch,
        token: p.exportPanelState().promptToken,
      };
    });
    const initialGenerationRevision = (await settings()).generationRevision;
    await patch({ answerOutlineEnabled: false });
    await waitFor(
      async () =>
        !(await desktop.evaluate(
          () => window.__companionFloatingPanel.state.settings.answerOutlineEnabled,
        )),
      'Outline setting did not reach host',
    );
    assert.deepEqual(
      await desktop.evaluate(() => {
        const p = window.__companionFloatingPanel;
        return {
          prompts: p.state.prompts,
          epoch: p.state.stepwiseEpoch,
          token: p.exportPanelState().promptToken,
        };
      }),
      stableSuggestions,
    );
    assert.equal((await settings()).generationRevision, initialGenerationRevision);
    await patch({ answerOutlineEnabled: true });
    await waitFor(
      async () => (await panelState()).outline.length > 2,
      'Outline did not recover independently',
    );
    const outlineBeforeDisable = (await panelState()).outline;
    await patch({ enabled: false });
    await waitFor(
      async () =>
        !(await desktop.evaluate(() => window.__companionFloatingPanel.state.settings.enabled)),
      'Stepwise setting did not reach host',
    );
    assert.deepEqual((await panelState()).outline, outlineBeforeDisable);
    await patch({ enabled: true });
    await switchView('next');
    modelDelay = 1600;
    const independentRequest = calls.length;
    await desktop.locator('[data-action="refresh"]').click();
    await waitFor(
      () => calls.length > independentRequest,
      'Independent delayed request did not start',
    );
    await patch({ answerOutlineEnabled: false });
    await waitFor(
      async () => (await panelState()).status === 'ok',
      'Outline toggle cancelled Stepwise generation',
    );
    assert.equal((await panelState()).count, 4);
    assert.equal(calls.length, independentRequest + 1);
    modelDelay = 80;
    await patch({ answerOutlineEnabled: true });
    await waitFor(async () => (await panelState()).outline.length > 2, 'Outline did not restore');
    const changedToken = await desktop.evaluate(
      () => window.__companionFloatingPanel.exportPanelState().promptToken,
    );
    await patch({ maxItems: 3 });
    await waitFor(
      async () =>
        (await desktop.evaluate(
          () => window.__companionFloatingPanel.exportPanelState().promptToken,
        )) !== changedToken,
      'Projection generation token stayed stale',
    );
    await patch({ maxItems: 4 });
    await generate();
    record('大纲开关保留建议和生成中请求；Stepwise 开关保留大纲；生成参数更新投影身份');
    const idleScans = await desktop.evaluate(() => {
      const p = window.__companionFloatingPanel;
      const before = p.state.scans;
      for (let i = 0; i < 30; i++) {
        p.exportPanelState();
        p.desktopStatus();
      }
      return p.state.scans - before;
    });
    assert.equal(idleScans, 0, 'Reading projections must not rescan the host');
    record('连续读取 30 次投影和状态没有触发正文重扫');

    await composer.fill('保留现有草稿');
    const dismissed = new Promise((resolve, reject) =>
      desktop.once('dialog', (dialog) => dialog.dismiss().then(resolve, reject)),
    );
    await desktop.locator('.csw-row[data-index="1"]').click();
    await dismissed;
    assert.equal(await composer.textContent(), '保留现有草稿');
    await desktop.evaluate(() => {
      const e = document.querySelector('[data-codex-composer]');
      e.innerHTML = '<p>第一行</p><p>第二行</p>';
      e.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    const existingParagraphs = await composer.innerText();
    const accepted = new Promise((resolve, reject) =>
      desktop.once('dialog', (dialog) => dialog.accept().then(resolve, reject)),
    );
    await desktop.locator('.csw-row[data-index="1"]').click();
    await accepted;
    await waitFor(
      async () => (await composer.innerText()).includes(suggestions[1].prompt),
      'Append did not complete',
    );
    assert.ok((await composer.innerText()).startsWith(existingParagraphs));
    assert.equal(await composer.locator('p').first().textContent(), '第一行');
    assert.equal(await desktop.evaluate(() => window.submitCount), 0);
    record('已有草稿取消／确认追加及多段文本保留');
    await composer.fill('');

    await switchView('outline');
    const outlineButtons = desktop.locator('.csw-outline-row');
    if ((await outlineButtons.count()) === 0) throw new Error('Outline buttons missing');
    await outlineButtons.nth(1).click();
    await delay(800);
    assert.ok(
      await desktop.evaluate(() =>
        document.querySelector('.companion-stepwise-outline-target-flash'),
      ),
    );
    assert.ok(!(await panelState()).outline.some((item) => item.text.includes('代码中的')));
    record('原有大纲解析、去重、定位与原文高亮');

    await switchView('settings');
    const fontBefore = await desktop.evaluate(
      () => window.__companionFloatingPanel.state.fontOffset,
    );
    await desktop.getByRole('button', { name: '增大字体', exact: true }).click();
    assert.notEqual(
      await desktop.evaluate(() => window.__companionFloatingPanel.state.fontOffset),
      fontBefore,
    );
    await desktop.locator('[data-action="label-only"]').click();
    assert.equal(
      await desktop.evaluate(() => window.__companionFloatingPanel.state.labelOnly),
      true,
    );
    await desktop.getByRole('button', { name: '减小字体', exact: true }).click();
    await desktop.locator('[data-action="label-only"]').click();
    const materials = [];
    for (let i = 0; i < 3; i++) {
      materials.push((await panelState()).material);
      assert.equal(
        await desktop.locator('.csw-rim').evaluate((el) => getComputedStyle(el).display),
        'block',
        'Embedded materials keep a soft depth cue',
      );
      await desktop.locator('[data-action="material"]').click();
    }
    assert.deepEqual(new Set(materials), new Set(['frosted', 'matte', 'native-glass']));
    record('三种材质轮换、字号及标题摘要切换');
    await desktop.evaluate(() => window.__companionFloatingPanel.setMaterial('native-glass'));
    assert.equal(
      await desktop.locator('.csw-popover').getAttribute('data-effective-material'),
      'frosted',
    );
    const embeddedGlass = await waitFor(
      () =>
        desktop.evaluate(() => {
          const status = window.__codexBuddyGlassLab?.status?.();
          if (!status) return null;
          const reduced = matchMedia('(prefers-reduced-transparency: reduce)').matches;
          if (!reduced && !['ready', 'error'].includes(status.phase)) return null;
          return {
            phase: status.phase,
            reduced,
            supported:
              /Chrome|Chromium|Edg/.test(navigator.userAgent) &&
              CSS.supports('backdrop-filter', 'url(#x)'),
          };
        }),
      'Embedded liquid capability did not settle in the release build',
    );
    if (embeddedGlass.reduced) {
      assert.equal(embeddedGlass.phase, 'idle');
      assert.equal(await desktop.locator('feDisplacementMap').count(), 0);
    } else if (embeddedGlass.supported) {
      assert.equal(embeddedGlass.phase, 'ready');
      assert.equal(await desktop.locator('feDisplacementMap').count(), 1);
      assert.equal(
        await desktop.locator('[data-companion-stepwise-root]').getAttribute('data-glass-backend'),
        'svg',
      );
    } else {
      assert.equal(embeddedGlass.phase, 'error');
      assert.equal(await desktop.locator('feDisplacementMap').count(), 0);
    }
    assert.equal(await desktop.locator('[data-material-value]').textContent(), '液态');
    assert.equal(
      await desktop.getByRole('button', { name: '通透液态（Clear）', exact: true }).count(),
      1,
    );
    assert.equal(await desktop.locator('[data-action=glass-style]').count(), 0);
    await desktop.evaluate(() => window.__companionFloatingPanel.setMaterial('frosted'));
    await waitFor(
      async () => (await desktop.locator('feDisplacementMap').count()) === 0,
      'Embedded SVG liquid did not clean up after switching material',
    );
    record(
      '正式版内嵌液态启用自有 SVG，浏览器不支持或系统要求减少透明度时回退，切换材质后清理光学节点',
    );

    await desktop.locator('[data-action="prompt-click-mode"]').click();
    assert.equal((await panelState()).clickMode, 'direct');
    await switchView('next');
    await desktop.locator('.csw-row[data-index="0"]').click();
    await waitFor(
      async () => (await desktop.evaluate(() => window.submitCount)) === 1,
      'Explicit direct send failed',
    );
    await composer.fill('');
    await switchView('settings');
    await desktop.locator('[data-action="prompt-click-mode"]').click();
    assert.equal((await panelState()).clickMode, 'hybrid');
    await switchView('next');
    await desktop.locator('.csw-row[data-index="0"]').click();
    await delay(350);
    assert.equal(await desktop.evaluate(() => window.submitCount), 1);
    await composer.fill('');
    await desktop.locator('.csw-row[data-index="1"]').dblclick();
    await waitFor(
      async () => (await desktop.evaluate(() => window.submitCount)) === 2,
      'Explicit double-click send failed',
    );
    await composer.fill('');
    await switchView('settings');
    await desktop.locator('[data-action="prompt-click-mode"]').click();
    assert.equal((await panelState()).clickMode, 'fill');
    record('显式直接发送／单击填入双击发送模式，仅在测试页面计数');

    await switchView('next');
    for (const theme of ['light', 'dark']) {
      await desktop.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      await waitFor(async () => (await panelState()).theme === theme, 'Theme did not follow host');
      for (const material of materials) {
        await desktop.evaluate(
          (material) => window.__companionFloatingPanel.setMaterial(material),
          material,
        );
        await settle();
        await delay(150);
        await desktop.screenshot({ path: join(output, `floating-${theme}-${material}.png`) });
      }
    }
    await desktop.evaluate(() => {
      document.documentElement.classList.remove('dark');
      window.__companionFloatingPanel.setMaterial('frosted');
    });
    await waitFor(async () => {
      const state = await panelState();
      return state.theme === 'light' && state.material === 'frosted';
    }, 'Theme and material did not restore before dragging');
    await settle();
    await desktop.locator('.csw-head-face').waitFor({ state: 'visible' });
    record('三材质 × 明暗模式的桌面视觉产物');

    const panelBox = await desktop.locator('.csw-panel').boundingBox();
    const dragFace = await desktop.locator('.csw-head-face').boundingBox();
    await desktop.mouse.move(dragFace.x + dragFace.width / 2, dragFace.y + dragFace.height / 2);
    await desktop.mouse.down();
    await desktop.mouse.move(
      dragFace.x + dragFace.width / 2 - 150,
      dragFace.y + dragFace.height / 2 + 90,
      { steps: 8 },
    );
    await desktop.mouse.up();
    await delay(200);
    const movedBox = await desktop.locator('.csw-panel').boundingBox();
    assert.ok(Math.abs(movedBox.x - panelBox.x) > 80);
    const handle = await desktop.locator('.csw-resize-handle[data-corner="br"]').boundingBox();
    await desktop.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await desktop.mouse.down();
    await desktop.mouse.move(handle.x + 65, handle.y + 65, { steps: 8 });
    await desktop.mouse.up();
    await delay(200);
    let resizedBox = await desktop.locator('.csw-panel').boundingBox();
    assert.ok(resizedBox.width > movedBox.width + 20);
    assert.ok(resizedBox.height > movedBox.height + 20);
    assert.ok(
      Math.abs(resizedBox.x - movedBox.x) < 2,
      'Right resize must keep the left edge fixed',
    );
    assert.ok(Math.abs(resizedBox.y - movedBox.y) < 2, 'Right resize must keep the top fixed');
    assert.ok(
      Math.abs(resizedBox.width - movedBox.width - (65 - handle.width / 2)) < 2,
      'Right edge must track the pointer one to one',
    );
    const rightEdge = resizedBox.x + resizedBox.width;
    const leftHandle = await desktop.locator('.csw-resize-handle[data-corner="bl"]').boundingBox();
    await desktop.mouse.move(
      leftHandle.x + leftHandle.width / 2,
      leftHandle.y + leftHandle.height / 2,
    );
    await desktop.mouse.down();
    await desktop.mouse.move(
      leftHandle.x + leftHandle.width / 2 - 30,
      leftHandle.y + leftHandle.height / 2,
      { steps: 6 },
    );
    await desktop.mouse.up();
    const leftResizedBox = await desktop.locator('.csw-panel').boundingBox();
    assert.ok(
      Math.abs(leftResizedBox.x + leftResizedBox.width - rightEdge) < 2,
      'Left resize must keep the right edge fixed',
    );
    assert.ok(Math.abs(leftResizedBox.y - resizedBox.y) < 2, 'Left resize must keep the top fixed');
    assert.ok(Math.abs(leftResizedBox.width - resizedBox.width - 30) < 2);
    resizedBox = leftResizedBox;
    const firstTab = await desktop.locator('button[data-view="next"]').boundingBox(),
      secondTab = await desktop.locator('button[data-view="outline"]').boundingBox();
    await desktop.mouse.move(firstTab.x + firstTab.width / 2, firstTab.y + firstTab.height / 2);
    await desktop.mouse.down();
    await desktop.mouse.move(secondTab.x + secondTab.width, secondTab.y + secondTab.height / 2, {
      steps: 8,
    });
    await desktop.mouse.up();
    await waitFor(
      async () => (await panelState()).order[0] === 'outline',
      'View reorder did not persist',
    );
    record('浮窗拖拽、固定对角的 1:1 双向缩放和面板拖动排序');

    const pendingFace = await desktop.locator('.csw-head-face').boundingBox();
    await desktop.mouse.move(
      pendingFace.x + pendingFace.width / 2,
      pendingFace.y + pendingFace.height / 2,
    );
    await desktop.mouse.down();
    await desktop.mouse.move(
      pendingFace.x + pendingFace.width / 2 - 12,
      pendingFace.y + pendingFace.height / 2,
      { steps: 3 },
    );
    await desktop.mouse.up();
    await delay(400);
    assert.equal((await panelState()).open, true, 'Dragging must not collapse the panel');
    assert.equal(
      await desktop.evaluate(() => window.__companionFloatingPanel.state.detachPending),
      false,
    );
    record('表情拖动不误收起或弹出');

    await desktop.getByRole('button', { name: '收起', exact: true }).click();
    await settle();
    assert.equal((await panelState()).open, false);
    await desktop.locator('.csw-fab').click();
    await delay(100);
    await desktop.keyboard.press('Escape');
    await settle();
    assert.equal((await panelState()).open, false);
    await desktop.locator('.csw-fab').click();
    await settle();
    await desktop.locator('.csw-head-face').focus();
    await desktop.keyboard.press('Enter');
    assert.equal(
      (await panelState()).open,
      false,
      'Keyboard collapse must not wait for double click',
    );
    await settle();
    await desktop.locator('.csw-fab').focus();
    await desktop.keyboard.press('Enter');
    assert.equal((await panelState()).open, true, 'Keyboard expand must respond immediately');
    await settle();
    record('鼠标单击等待 100ms，键盘立即收放，Escape 中断动画');

    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`settings: ${error.message}`));
    await page.goto(`${base}/#token=${runtime.token}`);
    await page.getByRole('heading', { name: 'Stepwise 模型', exact: true }).waitFor();
    assert.equal(page.url(), `${base}/`);
    assert.equal(await page.locator('option[value="desktop"]').isDisabled(), false);
    const gatedSettings = await context.newPage();
    await gatedSettings.route('**/api/settings', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, popoutSupported: false } });
    });
    await gatedSettings.goto(`${base}/#token=${runtime.token}`);
    await gatedSettings.getByRole('heading', { name: 'Stepwise 模型', exact: true }).waitFor();
    await waitFor(
      () => gatedSettings.locator('option[value="desktop"]').evaluate((option) => option.disabled),
      'Unsupported desktop option remained enabled',
    );
    assert.equal(await gatedSettings.locator('option[value="embedded"]').isDisabled(), false);
    await gatedSettings.close();
    record('Web 设置禁用不支持平台的桌面选项，内嵌选项保持可用');

    assert.equal(await page.getByLabel('API 密钥', { exact: true }).inputValue(), '');
    await page.getByLabel('最多建议数量').fill('3');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await waitFor(async () => (await settings()).maxItems === 3, 'Web settings were not saved');
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'secrets.json'))).apiKey, 'fixture-key');
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'config.json'))).unrelatedOption.keep, true);
    assert.equal(statSync(join(dataDir, 'secrets.json')).mode & 0o777, 0o600);
    await page.getByRole('button', { name: '读取模型', exact: true }).click();
    await waitFor(
      async () => (await page.locator('#available-models option').count()) === 2,
      'Models list did not load',
    );
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await page.getByText('连接正常，已生成 3 条测试建议。', { exact: true }).waitFor();
    record('网页保存、模型列表、连接测试、密钥保留与私有权限');
    const appearanceBefore = (await api('appearance')).body;
    const selectLiquid = async () => {
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/appearance') && response.request().method() === 'POST',
      );
      await page.getByLabel('材质', { exact: true }).selectOption('native-glass');
      return saved;
    };
    let materialSave = await selectLiquid();
    if (!materialSave.ok()) {
      // 前面的内嵌收放可能刚保存新修订；确认冲突提示和重新读取，再按界面约定重试一次。
      assert.equal((await materialSave.json()).message, '外观已在其他窗口更新，请重试');
      await page.getByText('外观已在其他窗口更新，请重试', { exact: true }).waitFor();
      await waitFor(
        () => page.getByLabel('材质', { exact: true }).isEnabled(),
        'Appearance conflict did not recover',
      );
      materialSave = await selectLiquid();
    }
    assert.ok(materialSave.ok(), 'Web material save failed after refreshing preferences');
    await waitFor(
      async () => (await panelState()).material === 'native-glass',
      'Web material did not reach embedded panel',
    );
    const clearStar = page.getByRole('button', { name: '通透液态（Clear）', exact: true });
    assert.equal(await clearStar.count(), 1);
    await clearStar.click();
    await waitFor(
      async () =>
        (await desktop.evaluate(() => window.__companionFloatingPanel.panelPreferences()))
          .liquidVariant === 'clear',
      'Web Clear preference did not reach embedded panel',
    );
    await clearStar.click();
    await waitFor(
      async () =>
        (await desktop.evaluate(() => window.__companionFloatingPanel.panelPreferences()))
          .liquidVariant === 'regular',
      'Web Regular preference did not reach embedded panel',
    );
    await page.screenshot({ path: join(output, 'settings-single-liquid.png') });
    await page.getByLabel('点击建议', { exact: true }).selectOption('hybrid');
    await waitFor(
      async () => (await panelState()).clickMode === 'hybrid',
      'Web click mode did not reach embedded panel',
    );
    await page.getByLabel('内容显示', { exact: true }).selectOption('true');
    await waitFor(
      async () =>
        (await desktop.evaluate(() => window.__companionFloatingPanel.panelPreferences()))
          .labelOnly,
      'Web label display did not reach embedded panel',
    );
    await desktop.evaluate(() => window.__companionFloatingPanel.setMaterial('matte'));
    await waitFor(
      async () => (await page.getByLabel('材质', { exact: true }).inputValue()) === 'matte',
      'Panel material did not reach Web',
    );
    const staleAppearance = await api('appearance', {
      expectedRevision: appearanceBefore.revision,
      ui: { material: 'frosted' },
    });
    assert.notEqual(staleAppearance.status, 200);
    await page.getByLabel('字号（px）', { exact: true }).fill('16');
    await page.getByLabel('字号（px）', { exact: true }).blur();
    await waitFor(
      async () =>
        await desktop.evaluate(() => {
          const s = window.__companionFloatingPanel.state;
          return Math.round(s.hostTypography.baseItemFontSize + s.fontOffset) === 16;
        }),
      'Web font size did not match panel pixels',
    );
    const currentAppearance = (await api('appearance')).body;
    await api('appearance', {
      expectedRevision: currentAppearance.revision,
      ui: appearanceBefore.ui,
    });
    await waitFor(
      async () => (await panelState()).material === appearanceBefore.ui.material,
      'Appearance restore failed',
    );
    record('Web 与内嵌胶囊的材质、点击和摘要设置双向同步，旧版本保存被拒绝');

    await switchView('settings');
    await desktop.locator('[data-action="generation-mode"]').click();
    await waitFor(
      async () => (await settings()).generationMode === 'auto',
      'Desktop mode did not persist',
    );
    await waitFor(
      async () => (await page.getByLabel('建议生成方式').inputValue()) === 'auto',
      'Web did not sync desktop mode',
    );
    await patch({ generationMode: 'manual' });
    await waitFor(
      async () => (await panelState()).mode === 'manual',
      'Desktop did not sync web mode',
    );
    await patch({ answerOutlineEnabled: false });
    await waitFor(
      async () => (await desktop.locator('button[data-view="outline"]').count()) === 0,
      'Independent outline disable did not apply',
    );
    await patch({ enabled: false });
    await waitFor(
      async () => (await desktop.locator('[data-companion-stepwise-root]').count()) === 0,
      'Disabled runtime still mounted',
    );
    await patch({ enabled: true, answerOutlineEnabled: true });
    await waitFor(
      async () => (await desktop.locator('[data-companion-stepwise-root]').count()) === 1,
      'Runtime did not reactivate',
    );
    await desktop.locator('.csw-fab').click();
    await settle();
    record('桌面／网页设置双向同步与独立功能开关');

    for (const protocol of ['responses', 'chat_completions', 'anthropic_messages']) {
      await patch({ protocol });
      const result = await api('settings/test', {});
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.items.length, 3);
      assert.equal(calls.at(-1).protocol, protocol);
      assert.equal(
        protocol === 'responses'
          ? lastBody.max_output_tokens
          : protocol === 'chat_completions'
            ? lastBody.max_completion_tokens
            : lastBody.max_tokens,
        2000,
      );
    }
    apiMode = 'fallback';
    await patch({ protocol: 'auto' });
    assert.equal((await api('settings/test', {})).status, 200);
    assert.deepEqual(
      calls.slice(-2).map((call) => call.protocol),
      ['responses', 'chat_completions'],
    );
    apiMode = 'auth';
    const beforeAuth = calls.length;
    assert.equal((await api('settings/test', {})).status, 400);
    assert.equal(calls.length, beforeAuth + 1);
    apiMode = 'ok';
    await patch({ protocol: 'responses' });
    record('三种模型协议、端点识别及仅对缺失端点回退');

    for (const mode of ['http', 'bad', 'truncated']) {
      apiMode = mode;
      const result = await api('settings/test', {});
      assert.equal(result.status, 400);
      assert.ok(result.body.message);
    }
    apiMode = 'ok';
    modelDelay = 1500;
    await patch({ timeoutMs: 1000 });
    const timeoutResult = await api('settings/test', {});
    assert.equal(timeoutResult.status, 400);
    assert.match(timeoutResult.body.message, /超时/);
    modelDelay = 80;
    await patch({ timeoutMs: 120000 });
    record('HTTP 错误、无效 JSON、截断与超时不伪装成成功');

    if ((await panelState()).tab !== 'next') await switchView('next');
    modelDelay = 2500;
    const priorCalls = calls.length;
    await desktop.locator('.csw-head').hover();
    await desktop.locator('[data-action="refresh"]').click();
    await waitFor(() => calls.length > priorCalls, 'Delayed model request did not start');
    await desktop.evaluate(() => {
      document.body.dataset.companionThreadId = 'fixture-thread-b';
      const root = document.querySelector('.thread-scroll-container');
      root.dataset.threadId = 'fixture-thread-b';
      document
        .querySelector('[data-response-annotation-conversation]')
        .setAttribute('data-response-annotation-conversation', 'fixture-thread-b');
      document
        .querySelector('[data-content-search-turn-key]')
        .setAttribute('data-content-search-turn-key', 'turn-0002');
      document.querySelector('#answer').appendChild(
        Object.assign(document.createElement('p'), {
          textContent: '任务已经切换，新回答内容应使旧建议失效。',
        }),
      );
    });
    await delay(2900);
    assert.equal((await panelState()).count, 0);
    assert.notEqual((await panelState()).status, 'ok');
    modelDelay = 80;
    await generate();
    assert.equal((await panelState()).count, 3);
    record('生成中切换任务取消旧结果，当前任务重新生成成功');

    const savedRevision = (await settings()).configurationRevision;
    await patch({ maxItems: 4 });
    const stale = await api('settings', { expectedRevision: savedRevision, maxItems: 1 });
    assert.equal(stale.status, 400);
    assert.equal((await settings()).maxItems, 4);
    const invalid = await api('settings', { maxItems: 99, apiKey: 'must-not-save' });
    assert.equal(invalid.status, 400);
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'secrets.json'))).apiKey, 'fixture-key');
    assert.ok(!JSON.stringify((await api('settings')).body).includes('fixture-key'));
    record('配置并发冲突、非法配置拒绝及密钥不回传');

    await patch({ protocol: 'responses', maxInputChars: 32000 });
    await desktop.evaluate(() => {
      document.querySelector('#answer').textContent =
        '长回答开头' + '中'.repeat(32500) + '末尾验证标记';
    });
    await waitFor(
      async () =>
        await desktop.evaluate(() => window.__companionFloatingPanel.state.scanStatus === 'ready'),
      'Long answer did not settle',
    );
    await generate();
    const longInput = JSON.parse(lastBody.input).answer;
    assert.equal(Array.from(longInput).length, 32000);
    assert.ok(longInput.includes('末尾验证标记'));
    assert.ok(longInput.includes('紧邻的用户问题'));
    assert.equal((await panelState()).count, 4);
    await desktop.evaluate(() =>
      document.querySelector('#answer').prepend(document.createTextNode('在截取范围外新增内容')),
    );
    await waitFor(
      async () => (await panelState()).count === 0,
      'Changes outside the model excerpt kept stale suggestions',
    );
    await patch({ maxInputChars: 12000 });
    record('长中文回答遵循 32000 字符上限，正文截取范围外的更新也使旧建议失效');

    await desktop.reload();
    await waitFor(
      async () => (await panelState())?.active,
      'Reload did not restore floating panel',
    );
    assert.equal(await desktop.locator('[data-companion-stepwise-root]').count(), 1);
    assert.equal((await panelState()).order[0], 'outline');
    // Preference hydration may already have restored an expanded panel.
    // Set the required state explicitly instead of toggling a possibly hidden button.
    await desktop.evaluate(() => window.__companionFloatingPanel.setOpen(true));
    await settle();
    const restoredBox = await desktop.locator('.csw-panel').boundingBox();
    assert.ok(Math.abs(restoredBox.width - resizedBox.width) < 2);
    record('renderer 重载自动恢复，保留尺寸与面板顺序');

    if (systemMajor >= 15) {
      await checkPopout({
        browser,
        desktop,
        api,
        base,
        runtime,
        dataDir,
        output,
        errors,
        record,
        waitFor,
        delay,
        generate,
        suggestions,
      });
    } else {
      assert.equal((await settings()).popoutSupported, false);
      assert.equal(await desktop.locator('[data-action="detach"]').isDisabled(), true);
      record('macOS 14 保持内嵌并跳过不可用的桌面浮窗用例');
    }

    await desktop.evaluate(() => {
      const example = document.createElement('pre');
      example.id = 'legacy-payload-example';
      example.textContent = JSON.stringify({
        codex_stepwise: true,
        items: [{ prompt: 'LEGACY_PAYLOAD_SENTINEL' }],
      });
      document.querySelector('#answer').append(example);
      window.__companionFloatingPanel.scan();
    });
    await generate();
    assert.equal(
      await desktop.locator('#legacy-payload-example').isVisible(),
      true,
      'Chat JSON examples must remain visible',
    );
    assert.ok(
      JSON.stringify(lastBody).includes('LEGACY_PAYLOAD_SENTINEL'),
      'Model context must retain chat JSON examples',
    );
    assert.deepEqual(
      await desktop.evaluate(() =>
        window.__companionFloatingPanel.state.prompts.map((item) => item.prompt),
      ),
      suggestions.map((item) => item.prompt),
    );
    await desktop.evaluate(() => {
      document.querySelector('#legacy-payload-example').remove();
      window.__companionFloatingPanel.scan();
    });
    await generate();
    record('旧格式 JSON 作为普通正文保留，建议只来自独立模型');
    await page.reload();
    await page.getByRole('heading', { name: 'Stepwise 模型', exact: true }).waitFor();
    await delay(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(output, 'settings-desktop.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: join(output, 'settings-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(output, 'settings-mobile.png'), fullPage: true });
    assert.equal(errors.length, 0, errors.join('\n'));
    record('配置网页明暗／窄屏渲染，无溢出与脚本错误');

    assert.equal((await fetch(`${base}/api/settings`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/settings`, {
          headers: { Authorization: `Bearer ${runtime.token}`, Origin: 'https://example.test' },
        })
      ).status,
      403,
    );
    const hostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: runtime.port,
          path: '/api/state',
          headers: { Host: 'attacker.test', Authorization: `Bearer ${runtime.token}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(hostStatus, 403);
    record('本机 HTTP 的 token、Origin 和 Host 校验');

    // 从靠近底边的胶囊向上展开，再缩短高度；松手不能翻转锚点导致跳位。
    await desktop.evaluate(async () => {
      const p = window.__companionFloatingPanel;
      await p.setDetached(false);
      p.syncPanelPreferences(
        { ...p.panelPreferences(), activeTab: 'next', width: 400, height: 650 },
        100000,
        false,
      );
      const { bounds, chip } = p.state.layout;
      p.state.position.x = bounds.left + (bounds.width - chip.width) / 2;
      p.state.position.y = bounds.bottom - chip.height;
      p.setOpen(true);
      p.renderFloat();
    });
    await settle();
    assert.equal(
      await desktop.evaluate(() => window.__companionFloatingPanel.state.layout.opensDown),
      false,
    );
    const upwardStart = await desktop.locator('.csw-panel').boundingBox();
    const upwardHandle = await desktop
      .locator('.csw-resize-handle[data-corner="br"]')
      .boundingBox();
    await desktop.mouse.move(
      upwardHandle.x + upwardHandle.width / 2,
      upwardHandle.y + upwardHandle.height / 2,
    );
    await desktop.mouse.down();
    await desktop.mouse.move(
      upwardHandle.x + upwardHandle.width / 2,
      upwardHandle.y + upwardHandle.height / 2 - 400,
      { steps: 10 },
    );
    const upwardDuring = await desktop.locator('.csw-panel').boundingBox();
    await desktop.mouse.up();
    const upwardEnd = await desktop.locator('.csw-panel').boundingBox();
    assert.ok(Math.abs(upwardDuring.y - upwardStart.y) < 2, 'Upward panel resize must fix the top');
    assert.ok(
      Math.abs(upwardEnd.y - upwardStart.y) < 2,
      'Releasing resize must not flip the anchor',
    );
    assert.ok(Math.abs(upwardEnd.height - 340) < 2, 'Minimum height must stop at the dragged edge');
    record('向上展开的面板缩到最小高度后，松手不跳位');

    await api('disconnect', {});
    await waitFor(
      async () => (await desktop.locator('[data-companion-stepwise-root]').count()) === 0,
      'Disconnect did not remove panel',
    );
    await desktop.reload();
    await delay(600);
    assert.equal(await desktop.locator('[data-companion-stepwise-root]').count(), 0);
    const connectedAgain = await api('connect', { endpoint: String(debugPort) });
    assert.equal(connectedAgain.status, 200);
    await waitFor(async () => (await panelState())?.active, 'Reconnect failed');
    const stopping = new Promise((resolve) => service.once('exit', resolve));
    await api('shutdown', {});
    await Promise.race([
      stopping,
      delay(10000).then(() => {
        throw new Error('Shutdown did not exit');
      }),
    ]);
    assert.equal(await desktop.locator('[data-companion-stepwise-root]').count(), 0);
    assert.equal(
      await desktop.evaluate(() => typeof window.__companionDesktopRequest),
      'undefined',
    );
    assert.equal(await desktop.title(), 'CodexBuddy 浮窗验收示例');
    record('断开／重新连接／停止移除浮窗和重载脚本，保留宿主');
    writeFileSync(
      join(output, 'e2e-report.json'),
      JSON.stringify(
        {
          artifact,
          version: '0.3.0',
          passed: reports.length,
          reports,
          pageErrors: errors,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`All ${reports.length} desktop/settings checks passed`);
  }
} catch (error) {
  console.error(error);
  console.error('PAGE_ERRORS', JSON.stringify(errors));
  console.error('SERVICE_LOG', serviceLog.slice(-3000));
  if (desktop && !desktop.isClosed()) {
    console.error(
      'PANEL_STATE',
      JSON.stringify(
        await desktop
          .evaluate(() => {
            const p = window.__companionFloatingPanel;
            return (
              p && {
                status: p.state.bridgeStatus,
                error: p.state.bridgeError,
                scan: p.state.scanStatus,
                settingsStatus: p.state.settingsStatus,
                open: p.state.open,
                tab: p.state.activeTab,
                diagnostics: p.diagnostics().slice(-8),
              }
            );
          })
          .catch(() => null),
      ),
    );
    await desktop.screenshot({ path: join(output, 'desktop-failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  service?.kill('SIGTERM');
  await browser?.close();
  await new Promise((resolve) => fixture.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
}
