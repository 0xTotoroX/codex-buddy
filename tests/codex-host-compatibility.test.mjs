/* [INPUT]: 上游探针契约、合成多输入框 DOM 和实际适配脚本。
 * [OUTPUT]: Agent 隔离、缺失/未知/异常协议拒绝和官方模型操作边界。
 * [POS]: 不调用真实 CodexHost、不写聊天或模型。
 * [PROTOCOL]: 变更时同步 tests/AGENTS.md。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { records, installModelControlFixture } from './model-control-fixture.mjs';
const source = readFileSync(new URL('../ui/codex/codex-host.js', import.meta.url), 'utf8');
test('CodexHost adapter keeps Agent capability scoped to each composer', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CODEX_BUDDY_CHROME_BIN || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<section><textarea id="a"></textarea><button data-codexhost-agent-control="a"><i data-agent="codex"></i></button></section><section><textarea id="b"></textarea><button data-codexhost-agent-control="b"><i data-agent="claude"></i></button></section>',
    );
    await page.addScriptTag({ content: source });
    const check = (id) =>
      page.evaluate(
        (id) => window.__codexBuddyHostCompatibility.capability(document.getElementById(id)),
        id,
      );
    assert.equal((await check('a')).officialModel, false);
    assert.equal((await check('b')).officialModel, false);
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1 = {
        status: () => ({
          version: 2,
          selections: [
            { composerId: 'a', agent: 'codex' },
            { composerId: 'b', agent: 'claude' },
          ],
        }),
      };
    });
    assert.equal((await check('a')).officialModel, true);
    assert.equal((await check('b')).officialModel, false);
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1 = { status: () => ({ version: 3, selections: [] }) };
    });
    assert.equal((await check('a')).officialModel, false);
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1 = {
        status: () => {
          throw new Error('unavailable');
        },
      };
    });
    assert.equal((await check('a')).officialModel, false);
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1 = { status: () => ({ version: 2, selections: {} }) };
    });
    assert.equal((await check('a')).officialModel, false);
    // An unmounted composer must not inherit an ordinary-Codex fallback from another Agent.
    await page.evaluate(() => {
      delete window.__codexhostRendererBindingProbeV1;
      document.querySelector('[data-codexhost-agent-control="a"]').remove();
    });
    assert.equal((await check('a')).officialModel, false);
    await page.evaluate(() => {
      document.querySelector('[data-codexhost-agent-control="b"]').remove();
    });
    assert.equal((await check('a')).officialModel, true);
  } finally {
    await browser.close();
  }
});

test('official model adapter refuses external Agent without touching its menus', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CODEX_BUDDY_CHROME_BIN || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.route('http://model-host.test/**', (route) =>
      route.fulfill({ body: '<!doctype html><body></body>', contentType: 'text/html' }),
    );
    await page.goto('http://model-host.test/c/chat-a');
    await page.evaluate(installModelControlFixture, { records, options: {} });
    await page.addScriptTag({ content: source });
    await page.addScriptTag({
      content: readFileSync(new URL('../ui/codex/model.js', import.meta.url), 'utf8'),
    });
    await page.evaluate(() => {
      capability();
      const control = document.createElement('button');
      control.setAttribute('data-codexhost-agent-control', 'external');
      control.innerHTML = '<i data-agent="claude"></i>';
      document.querySelector('.ProseMirror').parentElement.append(control);
      window.__codexhostRendererBindingProbeV1 = {
        status: () => ({ version: 2, selections: [{ composerId: 'external', agent: 'claude' }] }),
      };
    });
    const value = await page.evaluate(() => window.__codexBuddyModelControl.snapshot(true));
    assert.equal(value.status, 'unavailable');
    assert.match(value.message, /claude/);
    const result = await page.evaluate(
      (state) =>
        window.__codexBuddyModelControl.apply({
          target: state.target,
          expectedRevision: state.revision,
          selection: { model: 'beta', reasoning: 'high', speed: 'standard' },
        }),
      value,
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.snapshot.status, 'unavailable');
    assert.match(result.message, /claude/);
    assert.equal(await page.evaluate(() => host.triggerEvents), 0);
    // A visible Codex label alone cannot authorize writes while the upstream API is absent.
    await page.evaluate(() => {
      delete window.__codexhostRendererBindingProbeV1;
      document.querySelector('[data-agent]').setAttribute('data-agent', 'codex');
    });
    const unavailable = await page.evaluate(() => window.__codexBuddyModelControl.snapshot(true));
    const refused = await page.evaluate(
      (state) =>
        window.__codexBuddyModelControl.apply({
          target: state.target,
          expectedRevision: state.revision,
          selection: { model: 'beta', reasoning: 'high', speed: 'standard' },
        }),
      unavailable,
    );
    assert.equal(refused.status, 'failed');
    assert.match(refused.message, /状态接口尚未就绪/);
    assert.equal(await page.evaluate(() => host.triggerEvents), 0);
  } finally {
    await browser.close();
  }
});
