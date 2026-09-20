/*
 * [INPUT]: standalone host.js and isolated Playwright Chromium with a synthetic official host.
 * [OUTPUT]: target/config/capability/cancellation/lifecycle behavior checks; no live model calls.
 * [POS]: Explicit node tests/model-control-host.mjs entry point, no production imports.
 * [PROTOCOL]: Parent task owns integration/maps. Fixtures contain no real chats or credentials.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { records, installModelControlFixture } from './model-control-fixture.mjs';

const source = readFileSync(new URL('../ui/model-control/host.js', import.meta.url), 'utf8');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined),
  headless: true,
});
async function fixture(page, options = {}) {
  await page.route('http://model-host.test/**', (route) =>
    route.fulfill({ body: '<!doctype html><body></body>', contentType: 'text/html' }),
  );
  if (options.early) await page.addInitScript({ content: source });
  await page.goto('http://model-host.test/c/chat-a');
  await page.evaluate(installModelControlFixture, { records, options });
  if (!options.early) await page.addScriptTag({ content: source });
  if (!options.noCapabilities && !options.inherited) await page.evaluate(() => capability());
}
const snapshot = (page, refresh = false) =>
  page.evaluate((refresh) => window.__codexBuddyModelControl.snapshot(refresh), refresh);
async function apply(page, selection, extra = {}) {
  const state = await snapshot(page);
  return page.evaluate((args) => window.__codexBuddyModelControl.apply(args), {
    target: state.target,
    expectedRevision: state.revision,
    selection,
    ...extra,
  });
}
const targetBeta = { model: 'beta', reasoning: 'high', speed: 'standard' };
let count = 0;
async function check(name, test, options) {
  const page = await browser.newPage();
  try {
    await fixture(page, options);
    await test(page);
    assert.deepEqual(await page.evaluate(() => host.unexpected), []);
    console.log(`ok ${++count} - ${name}`);
  } finally {
    await page.close();
  }
}
try {
  await check(
    'composer identity survives references to another conversation and generic trigger labels',
    async (page) => {
      await page.evaluate(() => {
        const pane = document.querySelector('section');
        pane.removeAttribute('data-thread-id');
        pane.querySelector('form').setAttribute('data-above-composer-conversation-id', 'chat-a');
        pane.querySelector('.thread-scroll-container').innerHTML =
          '<div data-response-annotation-conversation="referenced-chat">Reference</div>';
        pane.querySelector('button').setAttribute('aria-label', 'Choose model');
        pane.querySelector('button').removeAttribute('data-selected-reasoning-effort');
      });
      assert.equal((await snapshot(page)).target.id, 'chat-a');
      assert.equal((await apply(page, targetBeta)).status, 'success');
      assert.deepEqual(await page.evaluate(() => host.configs['chat-a']), targetBeta);
    },
  );
  await check(
    'conflicting composer and ancestor identities never fall back to a guessed target',
    async (page) => {
      await page.evaluate(() =>
        document
          .querySelector('form')
          .setAttribute('data-above-composer-conversation-id', 'another-chat'),
      );
      assert.equal((await snapshot(page)).status, 'unavailable');
      assert.equal((await apply(page, targetBeta)).status, 'failed');
      assert.equal(await page.evaluate(() => host.changes.length), 0);
    },
  );
  await check(
    'passive snapshot has no clicks/focus changes; explicit refresh reads full config and restores focus',
    async (page) => {
      await page.locator('.ProseMirror').focus();
      const first = await snapshot(page);
      assert.equal(first.status, 'waiting');
      assert.equal(first.current, null);
      assert.equal(first.models.length, 2);
      assert.equal(await page.evaluate(() => host.clicks.length), 0);
      assert.equal(await page.evaluate(() => document.activeElement.matches('.ProseMirror')), true);
      const state = await snapshot(page, true);
      assert.equal(state.status, 'ready');
      assert.deepEqual(state.current, { model: 'alpha', reasoning: 'low', speed: 'standard' });
      assert.equal(await page.evaluate(() => document.activeElement.matches('.ProseMirror')), true);
      const clicks = await page.evaluate(() => host.clicks.length);
      assert.deepEqual(await snapshot(page), state);
      assert.equal(await page.evaluate(() => host.clicks.length), clicks);
    },
  );
  await check(
    'first apply works without refresh; full preset survives model resetting defaults',
    async (page) => {
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'success');
      assert.deepEqual(result.snapshot.current, targetBeta);
      assert.deepEqual(result.previous, { model: 'alpha', reasoning: 'low', speed: 'standard' });
      const restore = await apply(page, result.previous, { restore: true });
      assert.equal(restore.status, 'success');
      assert.deepEqual(restore.snapshot.current, result.previous);
    },
  );
  await check(
    'fast selection and unsupported full preset rejects before any menu mutation',
    async (page) => {
      for (const selection of [
        { ...targetBeta, speed: 'fast' },
        { ...targetBeta, reasoning: 'ultra' },
        { model: 'alpha', speed: 'standard' },
        { ...targetBeta, model: 'missing' },
      ])
        assert.equal((await apply(page, selection)).status, 'failed');
      assert.equal(await page.evaluate(() => host.clicks.length), 0);
      const selection = { model: 'alpha', reasoning: 'high', speed: 'fast' };
      assert.deepEqual((await apply(page, selection)).snapshot.current, selection);
      assert.deepEqual((await apply(page, targetBeta)).snapshot.current, targetBeta);
    },
  );
  await check(
    'ambiguous split targets refuse; last interacted composer overrides unrelated locked workbench',
    async (page) => {
      assert.equal((await snapshot(page)).status, 'unavailable');
      await page.evaluate(() => {
        window.__codexCompanion = {
          activeContext: { sessionId: 'chat-a' },
          chatBinding: { mode: 'locked', sessionId: 'chat-a' },
        };
      });
      await page.locator('[data-thread-id="chat-b"] .ProseMirror').click();
      assert.equal((await snapshot(page)).target.id, 'chat-b');
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'success');
      assert.equal(
        (await page.evaluate(() => host.changes)).every((entry) => entry.id === 'chat-b'),
        true,
      );
    },
    { two: true },
  );
  await check('foreground chat wins; unknown foreground modal refuses', async (page) => {
    await page.locator('.ProseMirror').click();
    await page.evaluate(() => addChat('foreground', true));
    assert.equal((await snapshot(page)).target.id, 'foreground');
    assert.equal((await apply(page, targetBeta)).status, 'success');
    await page.evaluate(() => {
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.textContent = 'Settings';
      document.body.append(modal);
    });
    assert.equal((await snapshot(page)).status, 'unavailable');
  });
  await check(
    'stable explicit identity required; duplicate identities refuse; pane index is never identity',
    async (page) => {
      await page.evaluate(() => {
        history.replaceState(null, '', '/');
        document.querySelector('section').removeAttribute('data-thread-id');
      });
      assert.equal((await snapshot(page)).target.id, '');
      await page.evaluate(() => {
        document.querySelector('section').dataset.threadId = 'chat-a';
        addChat('chat-a');
      });
      assert.equal((await snapshot(page)).status, 'unavailable');
    },
  );
  await check('stale revisions and old document nonce reject without clicks', async (page) => {
    const before = await snapshot(page);
    await page.evaluate(() => window.__codexBuddyModelControl.dispose());
    await page.addScriptTag({ content: source });
    await page.evaluate(() => capability());
    assert.notEqual((await snapshot(page)).revision, before.revision);
    const result = await apply(page, targetBeta, { expectedRevision: before.revision });
    assert.equal(result.status, 'failed');
    assert.equal(await page.evaluate(() => host.clicks.length), 0);
  });
  await check(
    'target switch after model selection aborts with partial and no more clicks',
    async (page) => {
      await page.evaluate(() => {
        host.onSelect = () => {
          const pane = addChat('chat-b');
          pane.querySelector('.ProseMirror').focus();
        };
      });
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'partial');
      assert.equal(result.snapshot.target.id, 'chat-b');
      assert.equal(result.snapshot.current, null);
      assert.equal((await page.evaluate(() => host.clicks)).at(-1).action, 'select:model:beta');
    },
  );
  await check(
    'composer replacement while opening submenu aborts before selection',
    async (page) => {
      await page.evaluate(() => {
        host.onSubmenu = (_, pane) =>
          pane
            .querySelector('.ProseMirror')
            .replaceWith(pane.querySelector('.ProseMirror').cloneNode(true));
      });
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'failed');
      assert.equal(await page.evaluate(() => host.changes.length), 0);
      assert.equal((await page.evaluate(() => host.clicks)).at(-1).action, 'model');
    },
  );
  await check(
    'delayed official commit is awaited before reasoning and full readback',
    async (page) => {
      await page.evaluate(() => {
        host.delay = 200;
      });
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'success');
      assert.deepEqual(result.snapshot.current, targetBeta);
      assert.deepEqual(
        (await page.evaluate(() => host.changes)).map((entry) => entry.reasoning),
        ['medium', 'high'],
      );
    },
  );
  await check(
    'unmatched/wrong-method/replayed/out-of-order model/list responses do not change capabilities',
    async (page) => {
      const empty = await snapshot(page);
      assert.equal(empty.models.length, 0);
      await page.evaluate((records) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'mcp-response', message: { id: 'foreign', result: { data: records } } },
          }),
        );
        window.dispatchEvent(
          new CustomEvent('codex-message-from-view', {
            detail: { type: 'mcp-request', request: { id: 'wrong', method: 'thread/list' } },
          }),
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'mcp-response', message: { id: 'wrong', result: { data: records } } },
          }),
        );
        host.unexpected.length = 0;
      }, records);
      assert.equal((await snapshot(page)).models.length, 0);
      await page.evaluate(() => capability('known'));
      assert.equal((await snapshot(page)).models.length, 2);
      await page.evaluate(() => {
        const request = (id) =>
          window.dispatchEvent(
            new CustomEvent('codex-message-from-view', {
              detail: { type: 'mcp-request', request: { id, method: 'model/list' } },
            }),
          );
        const response = (id, data) =>
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'mcp-response', response: { id, result: { data } } },
            }),
          );
        response('known', []);
        request('old');
        request('new');
        response('new', host.records.slice(1));
        response('old', host.records);
        host.unexpected.length = 0;
      });
      assert.deepEqual(
        (await snapshot(page)).models.map((model) => model.id),
        ['beta'],
      );
    },
    { noCapabilities: true },
  );
  await check(
    'hot injection refresh waiting; capabilities can arrive during explicit refresh without restart',
    async (page) => {
      assert.equal((await snapshot(page, true)).status, 'waiting');
      await page.evaluate(() => {
        host.onOpen = () => capability('late');
      });
      assert.equal((await snapshot(page, true)).status, 'ready');
    },
    { noCapabilities: true },
  );
  await check(
    'active legacy conflict preserves plugin and inherited cache; external removal enables operation',
    async (page) => {
      assert.equal((await snapshot(page)).status, 'conflict');
      assert.equal((await snapshot(page)).models.length, 2);
      assert.equal((await apply(page, targetBeta)).status, 'failed');
      assert.equal(await page.evaluate(() => host.clicks.length), 0);
      await page.evaluate(() => {
        delete window.__codexPlusQuickModelPresets;
      });
      assert.equal((await apply(page, targetBeta)).status, 'success');
    },
    { inherited: true },
  );
  await check(
    'generation blocks at start and aborts mid-flight without further events',
    async (page) => {
      await page.evaluate(() => {
        const stop = document.createElement('button');
        stop.textContent = 'Stop';
        document.querySelector('form').append(stop);
      });
      assert.equal((await snapshot(page)).generating, true);
      assert.equal((await apply(page, targetBeta)).status, 'failed');
      assert.equal(await page.evaluate(() => host.clicks.length), 0);
      await page.evaluate(() => {
        document.querySelector('form').lastChild.remove();
        host.onSelect = (_, pane) => {
          const stop = document.createElement('button');
          stop.textContent = 'Stop';
          pane.append(stop);
        };
      });
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'partial');
      assert.equal(result.snapshot.generating, true);
      assert.equal((await page.evaluate(() => host.clicks)).at(-1).action, 'select:model:beta');
    },
  );
  await check(
    'partial failure reports actual changed config, previous, and never fake rollback',
    async (page) => {
      await page.evaluate(() => {
        host.disabled = 'reasoning:high';
      });
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'partial');
      assert.deepEqual(result.snapshot.current, { ...targetBeta, reasoning: 'medium' });
      assert.equal(result.previous.model, 'alpha');
      assert.equal(await page.evaluate(() => host.changes.length), 1);
    },
  );
  await check(
    'one operation at a time, busy passive snapshots, explicit cancel stops pending clicks',
    async (page) => {
      await page.evaluate(() => {
        host.block = 'model';
      });
      const state = await snapshot(page);
      await page.evaluate(
        (args) => {
          window.pending = window.__codexBuddyModelControl.apply(args);
        },
        { target: state.target, expectedRevision: state.revision, selection: targetBeta },
      );
      await page.waitForFunction(() => host.clicks.some((entry) => entry.action === 'model'));
      assert.equal((await snapshot(page)).status, 'busy');
      assert.equal((await apply(page, targetBeta)).status, 'failed');
      await page.evaluate(() => window.__codexBuddyModelControl.cancel());
      const result = await page.evaluate(() => window.pending);
      assert.equal(result.status, 'failed');
      const clicks = await page.evaluate(() => host.clicks.length);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => host.clicks.length), clicks);
    },
  );
  await check(
    'dispose cancels waits/restores observer hook, old API cannot click and new installation rejects old revision',
    async (page) => {
      await page.evaluate(() => {
        host.block = 'open';
      });
      const state = await snapshot(page);
      await page.evaluate(
        (args) => {
          window.oldAPI = window.__codexBuddyModelControl;
          window.pending = oldAPI.apply(args);
        },
        { target: state.target, expectedRevision: state.revision, selection: targetBeta },
      );
      await page.waitForFunction(() => host.clicks.length > 0);
      await page.evaluate(() => oldAPI.dispose());
      assert.equal((await page.evaluate(() => pending)).status, 'failed');
      assert.equal(await page.evaluate(() => window.dispatchEvent === host.originalDispatch), true);
      assert.equal((await page.evaluate(() => oldAPI.snapshot(true))).status, 'unavailable');
      assert.equal(await page.evaluate(() => host.clicks.length), 1);
    },
  );
  await check(
    'new-document installation and hidden trigger labels still resolve without guessing current selection',
    async (page) => {
      await page.evaluate(() => {
        const button = document.querySelector('form button');
        button.innerHTML =
          '选择强度GPT-6 Astra高<span hidden>无极低轻度中高极高最高Ultra持续</span>';
        button.dataset.selectedReasoningEffort = 'high';
      });
      const state = await snapshot(page);
      assert.equal(state.target.id, 'chat-a');
      assert.equal(state.current, null);
      assert.equal((await apply(page, targetBeta)).status, 'success');
    },
    { early: true },
  );
  await check(
    'caller mutation after apply cannot alter the validated full preset',
    async (page) => {
      const state = await snapshot(page);
      const result = await page.evaluate(async (state) => {
        const selection = { model: 'beta', reasoning: 'high', speed: 'standard' };
        const pending = window.__codexBuddyModelControl.apply({
          target: state.target,
          expectedRevision: state.revision,
          selection,
        });
        selection.speed = 'fast';
        selection.reasoning = 'ultra';
        return pending;
      }, state);
      assert.equal(result.status, 'success');
      assert.deepEqual(result.snapshot.current, targetBeta);
    },
  );
  await check(
    'DOM detach and reinsert during submenu is an invalidated frozen identity',
    async (page) => {
      await page.evaluate(() => {
        host.onSubmenu = (_, pane) => {
          const editor = pane.querySelector('.ProseMirror');
          editor.remove();
          pane.querySelector('form').append(editor);
        };
      });
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'failed');
      assert.equal(await page.evaluate(() => host.changes.length), 0);
    },
  );
  await check(
    'reinjection rotates nonce and cancels previous instance without touching host menus',
    async (page) => {
      const before = await snapshot(page);
      await page.addScriptTag({ content: source });
      await page.evaluate(() => capability('reinjected'));
      assert.notEqual((await snapshot(page)).revision, before.revision);
      assert.equal(
        (await apply(page, targetBeta, { expectedRevision: before.revision })).status,
        'failed',
      );
      assert.equal(await page.evaluate(() => host.triggerEvents), 0);
    },
  );
  await check('capability change after selection aborts without more menu events', async (page) => {
    await page.evaluate(() => {
      host.onSelect = () => capability('new-capabilities', host.records.slice(1));
    });
    const result = await apply(page, targetBeta);
    assert.equal(result.status, 'partial');
    assert.equal(result.snapshot.current, null);
    assert.match(result.message, /能力/);
    assert.equal((await page.evaluate(() => host.clicks)).at(-1).action, 'select:model:beta');
  });
  await check(
    'late commit after target switch cannot become the new target current config',
    async (page) => {
      await page.evaluate(() => {
        host.delay = 200;
        host.onSelect = () => addChat('chat-b').querySelector('.ProseMirror').focus();
      });
      const result = await apply(page, targetBeta);
      assert.equal(result.status, 'partial');
      const count = await page.evaluate(() => host.triggerEvents);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => host.triggerEvents), count);
      const state = await snapshot(page);
      assert.equal(state.target.id, 'chat-b');
      assert.equal(state.current, null);
      assert.deepEqual(await page.evaluate(() => host.configs['chat-b']), {
        model: 'alpha',
        reasoning: 'low',
        speed: 'standard',
      });
    },
  );
  await check('11 second absolute deadline cancels all later adapter clicks', async (page) => {
    await page.evaluate(() => {
      host.openDelay = 1420;
      host.delay = 1520;
    });
    const started = Date.now();
    const result = await apply(page, targetBeta);
    const elapsed = Date.now() - started;
    assert.equal(result.status, 'partial');
    assert.match(result.message, /11 秒/);
    assert.ok(elapsed < 12000, `apply exceeded deadline: ${elapsed}ms`);
    assert.equal(result.snapshot.current, null);
    const clicks = await page.evaluate(
      () => host.triggerEvents + host.clicks.filter((entry) => entry.action !== 'open').length,
    );
    await page.waitForTimeout(1700);
    assert.equal(
      await page.evaluate(
        () => host.triggerEvents + host.clicks.filter((entry) => entry.action !== 'open').length,
      ),
      clicks,
    );
  });
  console.log(`${count} synthetic host checks passed`);
} finally {
  await browser.close();
}
