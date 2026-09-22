/*
 * [INPUT]: 工作台合成宿主、既有布局/投影测试辅助。
 * [OUTPUT]: 跟随/锁定、建议缓存恢复与失效、失联恢复、迟到结果、误写保护与冷启动行为回归。
 * [POS]: workbench.mjs 的关联场景；不调用真实模型。
 * [PROTOCOL]: 变更时检查 tests/AGENTS.md。
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const snapshot = (page) => page.evaluate(() => window.__companionFloatingPanel.exportPanelState());
async function associate(page, action) {
  // 前端入口暂时隐藏，通过保留的处理器验证关联功能没有被删除。
  await page.locator(`[data-association="${action}"]`).evaluate((button) => button.click());
}
async function defer(page) {
  await page.evaluate(() => {
    window.workbenchFixture.deferred = [];
  });
  await page.locator('[data-refresh="next"]').click();
  await page.waitForFunction(() => window.workbenchFixture.deferred.length === 1);
}
async function complete(page, index, label) {
  await page.evaluate(
    ({ index, label }) =>
      window.__companionDesktop.complete(window.workbenchFixture.deferred[index].id, {
        items: [{ label, prompt: `${label} 的合成建议`, summary: '关联回归' }],
      }),
    { index, label },
  );
}
async function replaceIdentity(page, id) {
  await page.evaluate((id) => {
    const root = document.querySelector('#fixture-host-content .thread-scroll-container');
    root.dataset.threadId = id;
    root
      .querySelector('[data-response-annotation-conversation]')
      .setAttribute('data-response-annotation-conversation', id);
    window.__companionFloatingPanel.scan();
  }, id);
}
async function addSecondChat(page) {
  await page.evaluate(() => {
    const root = document.querySelector('#fixture-host-content .thread-scroll-container');
    const second = root.cloneNode(true);
    second.id = 'chat-b';
    second.dataset.threadId = 'fixture-thread-b';
    second
      .querySelector('[data-response-annotation-conversation]')
      .setAttribute('data-response-annotation-conversation', 'fixture-thread-b');
    second.querySelector('#answer').id = 'answer-b';
    second.querySelector('h2').textContent = '聊天 B';
    second.style.cssText =
      'position:fixed;left:190px;top:65px;width:320px;height:400px;z-index:20;overflow:auto';
    const composer = document.querySelector('#composer-form').cloneNode(true);
    composer.id = 'composer-b';
    const holder = document.createElement('section');
    holder.style.cssText =
      'position:fixed;left:190px;top:65px;width:320px;height:600px;z-index:20;display:flex;flex-direction:column';
    second.style.cssText = 'flex:1;min-height:0;overflow:auto';
    composer.style.cssText = 'position:relative;flex:none;width:100%;inset:auto;transform:none';
    holder.append(second, composer);
    document.body.append(holder);
    composer
      .querySelector('.ProseMirror')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.__companionFloatingPanel.scan();
  });
}
export function chatBindingCases({
  mode,
  settle,
  chooseLayout,
  createPopout,
  project,
  bundle,
  output,
}) {
  return [
    [
      'binding quick prompts fill independently and reject stale popout shortcuts',
      async (page) => {
        await mode(page, true);
        await page.locator('[data-quick-prompt="0"]').waitFor();
        await page.screenshot({ path: resolve(output, 'quick-prompts.png') });
        const before = await page.evaluate(
          () =>
            window.workbenchFixture.requests.filter((r) => r.path === '/stepwise/generate').length,
        );
        await page.locator('[data-quick-prompt="0"]').click();
        const composer = page.locator('#composer-form .ProseMirror');
        assert.equal(await composer.innerText(), '继续');
        assert.equal(
          await page.evaluate(
            () =>
              window.workbenchFixture.requests.filter((r) => r.path === '/stepwise/generate')
                .length,
          ),
          before,
        );
        await composer.fill('');
        const stale = await snapshot(page);
        await page.evaluate(async () => {
          window.workbenchFixture.settings.quickPrompts = [
            { label: '解释', prompt: '解释这个概念' },
          ];
          window.workbenchFixture.settings.configurationRevision += 1;
          await window.__companionFloatingPanel.syncSettings();
        });
        await page.getByRole('button', { name: '解释', exact: true }).waitFor();
        const rejected = await page.evaluate(
          (source) =>
            window.__companionFloatingPanel.panelCommand({
              ...source,
              kind: 'quick-fill',
              index: 0,
            }),
          stale,
        );
        assert.equal(rejected.ok, false);
        assert.equal((await composer.innerText()).trim(), '');
        const current = await snapshot(page);
        const filled = await page.evaluate(
          (source) =>
            window.__companionFloatingPanel.panelCommand({
              ...source,
              kind: 'quick-fill',
              index: 0,
              submit: true,
            }),
          current,
        );
        assert.equal(filled.ok, true);
        assert.equal(await composer.innerText(), '解释这个概念');
        await composer.fill('已有草稿');
        const drafts = await snapshot(page);
        const protectedDraft = await page.evaluate(
          (source) =>
            window.__companionFloatingPanel.panelCommand({
              ...source,
              kind: 'quick-fill',
              index: 0,
            }),
          drafts,
        );
        assert.equal(protectedDraft.needsConfirmation, true);
        assert.equal(await composer.innerText(), '已有草稿');
        assert.equal(await page.evaluate(() => window.submitCount || 0), 0);
        assert.equal(
          await page.evaluate(
            () =>
              window.workbenchFixture.requests.filter((r) => r.path === '/stepwise/generate')
                .length,
          ),
          before,
        );
      },
    ],
    ...['manual', 'auto'].map((generationMode) => [
      `binding suggestion cache restores ${generationMode} A-B-A without new requests`,
      async (page) => {
        await mode(page, true);
        await page.evaluate(async (generationMode) => {
          window.workbenchFixture.deferred = [];
          const patch = { generationMode };
          Object.assign(window.workbenchFixture.settings, patch);
          await window.__companionFloatingPanel.syncSettings(patch);
        }, generationMode);
        if (generationMode === 'manual') await page.locator('[data-refresh="next"]').click();
        await page.waitForFunction(() => window.workbenchFixture.deferred.length === 1);
        await complete(page, 0, 'A');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        const original = await snapshot(page);

        // 同一栏位换聊天，回答文字相同也不能复用另一个 session 的建议。
        await replaceIdentity(page, 'fixture-thread-b');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.scanStatus === 'ready',
        );
        assert.equal((await snapshot(page)).prompts.length, 0);
        if (generationMode === 'manual') await page.locator('[data-refresh="next"]').click();
        await page.waitForFunction(() => window.workbenchFixture.deferred.length === 2);
        await complete(page, 1, 'B');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        assert.equal((await snapshot(page)).prompts[0].label, 'B');

        // 模拟 DOM 重新挂载，不能依靠旧节点或旧上下文恢复。
        await page.locator('#fixture-host-content .thread-scroll-container').evaluate((node) => {
          node.replaceWith(node.cloneNode(true));
        });
        await replaceIdentity(page, 'fixture-thread-a');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts[0]?.label === 'A',
        );
        const restored = await snapshot(page);
        assert.notEqual(restored.context.generation, original.context.generation);
        const filled = await page.evaluate(
          (source) =>
            window.__companionFloatingPanel.panelCommand({ ...source, kind: 'fill', index: 0 }),
          restored,
        );
        assert.equal(filled.ok, true);
        assert.equal(await page.locator('#composer-form .ProseMirror').innerText(), 'A 的合成建议');
        await replaceIdentity(page, 'fixture-thread-b');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts[0]?.label === 'B',
        );
        assert.equal(await page.evaluate(() => window.workbenchFixture.deferred.length), 2);
      },
    ]),
    [
      'binding suggestion cache checks the complete user question beyond the old prefix',
      async (page) => {
        await mode(page, true);
        const question = '问'.repeat(3000);
        await page.locator('.user-bubble').evaluate((node, text) => {
          node.textContent = text + '完整执行全部任务';
        }, question);
        await defer(page);
        await complete(page, 0, 'A');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        await replaceIdentity(page, 'fixture-thread-b');
        await page.locator('.user-bubble').evaluate((node, text) => {
          node.textContent = text + '仅讨论方案不要执行';
        }, question);
        await replaceIdentity(page, 'fixture-thread-a');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.scanStatus === 'ready',
        );
        assert.equal((await snapshot(page)).prompts.length, 0);
        assert.equal(await page.evaluate(() => window.workbenchFixture.deferred.length), 1);
      },
    ],
    [
      'binding suggestion cache invalidates changed answer and generation settings',
      async (page) => {
        await mode(page, true);
        await defer(page);
        await complete(page, 0, 'A');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        await replaceIdentity(page, 'fixture-thread-b');
        await page
          .locator('#answer h2')
          .first()
          .evaluate((node) => {
            node.textContent = '新的回答';
          });
        await replaceIdentity(page, 'fixture-thread-a');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.scanStatus === 'ready',
        );
        assert.equal((await snapshot(page)).prompts.length, 0);
        assert.equal(await page.evaluate(() => window.workbenchFixture.deferred.length), 1);
        await page.locator('[data-refresh="next"]').click();
        await page.waitForFunction(() => window.workbenchFixture.deferred.length === 2);
        await complete(page, 1, '新 A');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        await replaceIdentity(page, 'fixture-thread-b');
        await page.evaluate(async () => {
          const f = window.workbenchFixture;
          f.settings.generationRevision += 1;
          await window.__companionFloatingPanel.syncSettings();
        });
        await replaceIdentity(page, 'fixture-thread-a');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.scanStatus === 'ready',
        );
        assert.equal((await snapshot(page)).prompts.length, 0);
        assert.equal(await page.evaluate(() => window.workbenchFixture.deferred.length), 2);
      },
    ],
    [
      'binding same target preserves pending generation reading and request count',
      async (page) => {
        await mode(page, true);
        await page.locator('[data-view-body="outline"]').evaluate((node) => {
          node.scrollTop = 50;
          window.workbenchFixture.reading = node.scrollTop;
        });
        await defer(page);
        const before = await snapshot(page);
        await associate(page, 'lock');
        const locked = await snapshot(page);
        assert.equal(locked.association.mode, 'locked');
        assert.equal(locked.association.available, true);
        assert.deepEqual(locked.context, before.context);
        assert.equal(locked.viewToken, before.viewToken);
        assert.equal(locked.bridgeStatus, 'pending');
        assert.equal(
          await page.locator('[data-view-body="outline"]').evaluate((node) => node.scrollTop),
          await page.evaluate(() => window.workbenchFixture.reading),
        );
        await associate(page, 'follow');
        await associate(page, 'lock');
        await complete(page, 0, 'A');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        assert.equal((await snapshot(page)).prompts[0].label, 'A');
        assert.equal(await page.getByRole('button', { name: '聊天关联', exact: true }).count(), 0);
        assert.equal(await page.locator('.csw-association-menu').isHidden(), true);
        assert.equal(await page.locator('.csw-workbench-source').isHidden(), true);
        assert.match(await page.locator('.csw-workbench-source').innerText(), /已锁定/);
        await page
          .locator('.csw-workbench')
          .screenshot({ path: resolve(output, 'binding-light.png') });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await settle(page);
        await page
          .locator('.csw-workbench')
          .screenshot({ path: resolve(output, 'binding-dark.png') });
        assert.equal(await page.evaluate(() => window.workbenchFixture.deferred.length), 1);
      },
    ],
    [
      'binding locked A ignores selected B and writes only to A; follow switches together',
      async (page) => {
        await mode(page, true);
        await defer(page);
        await complete(page, 0, 'A');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        await associate(page, 'lock');
        const a = await snapshot(page);
        await addSecondChat(page);
        await settle(page);
        const current = await snapshot(page);
        assert.equal(current.context.sessionId, a.context.sessionId);
        assert.equal(current.association.canRetarget, true);
        const result = await page.evaluate(
          (source) =>
            window.__companionFloatingPanel.panelCommand({
              ...source,
              kind: 'fill',
              index: 0,
              submit: false,
            }),
          current,
        );
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(await page.locator('#composer-b .ProseMirror').innerText(), '');
        assert.equal(await page.locator('#composer-form .ProseMirror').innerText(), 'A 的合成建议');
        // Filling A focuses A. Select B again before leaving follow mode.
        await page.locator('#chat-b').dispatchEvent('pointerdown');
        await associate(page, 'follow');
        await page.waitForFunction(
          () =>
            window.__companionFloatingPanel.exportPanelState().context.sessionId ===
            'fixture-thread-b',
        );
        assert.equal((await snapshot(page)).prompts.length, 0);
        const stale = await page.evaluate(
          (source) =>
            window.__companionFloatingPanel.panelCommand({ ...source, kind: 'fill', index: 0 }),
          a,
        );
        assert.equal(stale.ok, false);
      },
    ],
    [
      'binding retarget invalidates late A while B generation remains current',
      async (page) => {
        await mode(page, true);
        await defer(page);
        await associate(page, 'lock');
        await addSecondChat(page);
        await associate(page, 'current');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.scanStatus === 'ready',
        );
        assert.equal((await snapshot(page)).association.sessionId, 'fixture-thread-b');
        await page.locator('[data-refresh="next"]').click();
        await page.waitForFunction(() => window.workbenchFixture.deferred.length === 2);
        await complete(page, 0, '迟到 A');
        await settle(page);
        assert.equal((await snapshot(page)).prompts.length, 0);
        assert.equal((await snapshot(page)).bridgeStatus, 'pending');
        await complete(page, 1, 'B');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        assert.equal((await snapshot(page)).prompts[0].label, 'B');
      },
    ],
    [
      'binding missing or replaced source stays locked and revalidates remount',
      async (page) => {
        await mode(page, true);
        await defer(page);
        await complete(page, 0, 'A');
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.prompts.length === 1,
        );
        await associate(page, 'lock');
        const original = await snapshot(page);
        await replaceIdentity(page, 'fixture-thread-b');
        const lost = await snapshot(page);
        assert.equal(lost.association.available, false);
        assert.equal(lost.association.sessionId, 'fixture-thread-a');
        assert.deepEqual(lost.prompts, original.prompts);
        assert.deepEqual(lost.outlineItems, original.outlineItems);
        assert.match(await page.locator('.csw-workbench-source').innerText(), /来源暂不可用/);
        assert.equal(await page.locator('[data-refresh="next"]').isDisabled(), true);
        for (const kind of ['fill', 'generate', 'outline-refresh', 'outline-jump']) {
          const r = await page.evaluate(
            ({ source, kind }) =>
              window.__companionFloatingPanel.panelCommand({
                ...source,
                kind,
                index: 0,
                id: source.outlineItems[0]?.id,
              }),
            { source: lost, kind },
          );
          assert.equal(r.ok, false, kind);
        }
        assert.equal(await page.locator('#composer-form .ProseMirror').innerText(), '');
        await replaceIdentity(page, 'fixture-thread-a');
        await page.evaluate(() => {
          const root = document.querySelector('#fixture-host-content .thread-scroll-container');
          const clone = root.cloneNode(true);
          clone.dataset.tabId = 'moved-pane';
          root.replaceWith(clone);
          window.__companionFloatingPanel.scan();
        });
        await page.waitForFunction(
          () => window.__companionFloatingPanel.exportPanelState().association.available,
        );
        assert.equal((await snapshot(page)).context.sessionId, original.context.sessionId);
        assert.deepEqual((await snapshot(page)).prompts, original.prompts);
        const good = await page.evaluate(
          (source) =>
            window.__companionFloatingPanel.panelCommand({
              ...source,
              kind: 'fill',
              index: 0,
              submit: false,
            }),
          await snapshot(page),
        );
        assert.equal(good.ok, true, JSON.stringify(good));
        await page.evaluate(() => {
          document.querySelector('#answer h2').textContent = 'A 的新回答';
        });
        const stale = await page.evaluate(
          (source) =>
            window.__companionFloatingPanel.panelCommand({ ...source, kind: 'fill', index: 0 }),
          await snapshot(page),
        );
        assert.equal(stale.ok, false);
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.outlineItems[0]?.text === 'A 的新回答',
        );
        assert.equal((await snapshot(page)).association.sessionId, 'fixture-thread-a');
        assert.equal((await snapshot(page)).prompts.length, 0);
        await page.evaluate(() => {
          window.workbenchFixture.closedRoot = document.querySelector(
            '#fixture-host-content .thread-scroll-container',
          );
          window.workbenchFixture.closedRoot.remove();
          window.__companionFloatingPanel.scan();
        });
        assert.equal((await snapshot(page)).association.available, false);
        await page.evaluate(() => {
          document
            .querySelector('#fixture-host-content')
            .prepend(window.workbenchFixture.closedRoot);
          window.__companionFloatingPanel.scan();
        });
        assert.equal((await snapshot(page)).association.available, true);
        await page.evaluate(() => {
          const root = window.workbenchFixture.closedRoot;
          const duplicate = root.cloneNode(true);
          duplicate.id = 'ambiguous-a';
          document.body.append(duplicate);
          window.__companionFloatingPanel.scan();
        });
        assert.equal(
          (await snapshot(page)).association.available,
          false,
          'ambiguous duplicate source fails closed',
        );
        await page.evaluate(() => {
          document.querySelector('#ambiguous-a').remove();
          window.__companionFloatingPanel.scan();
        });
        assert.equal((await snapshot(page)).association.available, true);
      },
    ],
    [
      'binding source loss rejects pending response even after recovery',
      async (page) => {
        await mode(page, true);
        await defer(page);
        await associate(page, 'lock');
        await replaceIdentity(page, 'fixture-thread-b');
        await replaceIdentity(page, 'fixture-thread-a');
        await complete(page, 0, '失联前 A');
        await settle(page);
        assert.equal((await snapshot(page)).prompts.length, 0);
        assert.equal((await snapshot(page)).association.available, true);
        assert.equal(await page.evaluate(() => window.workbenchFixture.deferred.length), 1);
      },
    ],
    [
      'binding layout popout disconnection and cold start preserve verified association',
      async (page) => {
        await mode(page, true);
        await associate(page, 'lock');
        const original = await snapshot(page);
        for (const action of ['horizontal', 'merge', 'swap', 'split', 'auto'])
          await chooseLayout(page, action);
        assert.deepEqual((await snapshot(page)).association, original.association);
        const pop = await createPopout(page, true);
        try {
          await project(pop.page, pop.projection, true);
          assert.match(await pop.page.locator('.csw-workbench-source').innerText(), /已锁定/);
          await pop.page.exposeFunction('bindingHostCommand', (command) =>
            page.evaluate(
              (command) => window.__companionFloatingPanel.panelCommand(command),
              command,
            ),
          );
          await pop.page.evaluate(() => {
            window.__companionPopout.request = async (path, { command }) =>
              path === 'command' ? window.bindingHostCommand(command) : { ok: false };
          });
          await associate(pop.page, 'follow');
          await page.waitForFunction(
            () => window.__companionFloatingPanel.exportPanelState().association.mode === 'follow',
          );
          pop.projection.snapshot = await snapshot(page);
          await project(pop.page, pop.projection, false);
          await associate(pop.page, 'lock');
          await page.waitForFunction(
            () => window.__companionFloatingPanel.exportPanelState().association.mode === 'locked',
          );
          pop.projection.snapshot = await snapshot(page);
          await project(pop.page, pop.projection, false);

          await pop.page.evaluate(() =>
            window.__companionFloatingPanel.panelDisconnected('fixture lost'),
          );
          assert.match(await pop.page.locator('.csw-workbench-source').innerText(), /来源暂不可用/);
          assert.equal(await pop.page.locator('[data-refresh="outline"]').isDisabled(), true);
          await project(pop.page, pop.projection, false);
          assert.equal(await pop.page.locator('[data-refresh="outline"]').isDisabled(), false);
        } finally {
          await pop.page.close();
        }
        await replaceIdentity(page, 'fixture-thread-b');
        await page.evaluate(() => window.__companionFloatingPanel.destroy());
        await page.evaluate(bundle);
        await page.waitForFunction(() => window.__companionFloatingPanel?.state.settingsLoaded);
        await mode(page, true);
        const cold = await snapshot(page);
        assert.equal(cold.association.mode, 'locked');
        assert.equal(cold.association.sessionId, original.context.sessionId);
        assert.equal(cold.association.available, false);
        assert.equal(cold.context.sessionId, '');
        const saved = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('codex-buddy-chat-binding-v1')),
        );
        assert.deepEqual(Object.keys(saved).sort(), ['label', 'mode', 'sessionId']);
        await associate(page, 'follow');
        await page.waitForFunction(
          () =>
            window.__companionFloatingPanel.exportPanelState().context.sessionId ===
            'fixture-thread-b',
        );
      },
    ],
  ];
}
