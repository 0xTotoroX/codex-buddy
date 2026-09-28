/* [INPUT]: Synthetic host runtime and feature transport fixture.
 * [OUTPUT]: Independent sidebar/overlay views, drafts and owner handoff acceptance.
 * [POS]: Browser regression; no live tasks or Apple lists.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
export function independentFeatureCases({ mode, syncSettings }) {
  return [
    [
      'independent features retain drafts and owners across ten placement round trips',
      async (page) => {
        const configureFeature = async (id, placement) => {
          await page.evaluate(
            ({ id, placement }) =>
              window.__companionDesktopRequest('/features', {
                op: placement ? 'move' : 'reveal',
                id,
                placement,
              }),
            { id, placement },
          );
        };
        const openFeature = (id) => configureFeature(id);
        await page.evaluate(() => {
          const fixture = window.workbenchFixture,
            entries = new Map();
          fixture.features = entries;
          fixture.layouts = {};
          fixture.mainPlacement = 'sidebar';
          fixture.pendingPlacement = null;
          fixture.activeFeature = '';
          fixture.busyOnce = new Set(['handoff', 'ready']);
          fixture.featureActions = [];
          fixture.outlineProjection = {
            outlineItems: Array.from({ length: 60 }, (_, i) => ({
              id: `test-${i}`,
              text: `合成大纲条目 ${i + 1}`,
              displayLevel: i % 3,
            })),
            outlineStatus: 'ok',
          };
          const modelState = {
            revision: 1,
            preferences: { enabled: true, pinned: ['a'], presets: [] },
            snapshot: {
              target: { id: 'synthetic-chat' },
              revision: 'model-v1',
              status: 'ready',
              message: '',
              current: { model: 'a', reasoning: 'high', speed: 'fast' },
              models: [{ id: 'a', label: 'Model A', reasoning: ['high', 'low'], fast: true }],
            },
          };
          fixture.modelState = modelState;
          const task = {
            id: 'feature-task',
            fields: {
              title: '保留原任务',
              notes: '原备注',
              due: null,
              priority: 0,
              column: 'todo',
              completed: false,
            },
            archived: false,
            deleteRequested: false,
            remote: null,
            remoteMissing: false,
            conflict: null,
          };
          const tasks = {
            store: {
              revision: 1,
              boardEnabled: true,
              syncEnabled: false,
              bindings: { calendarId: '' },
              tasks: [task],
              inflight: null,
            },
            status: '本地看板',
          };
          fixture.settings.taskBoardEnabled = true;
          const original = window.__companionHostRequest;
          window.__companionHostRequest = (raw) => {
            const { id, path, payload: p } = JSON.parse(raw);
            if (path !== '/features') return original(raw);
            let result;
            const state = () => ({
              features: structuredClone([...entries.values()]),
              layouts: structuredClone(fixture.layouts),
              mainPlacement: fixture.mainPlacement,
              pendingPlacement: fixture.pendingPlacement,
              activeFeature: fixture.activeFeature,
            });
            const entry = entries.get(p.id);
            if (p.id === 'board' && fixture.busyOnce.delete(p.op)) {
              queueMicrotask(() =>
                window.__companionDesktop.complete(id, {
                  error: p.op === 'ready' ? '请求较多，请稍后再试' : '请求不可用，请稍后重试',
                }),
              );
              return;
            }
            if (p.op === 'state') result = state();
            else if (p.op === 'layout') {
              fixture.layouts[p.placement] = p.layout;
              result = state();
            } else if (p.op === 'reveal' || p.op === 'move') {
              fixture.activeFeature = p.id;
              if (entry?.open && p.op === 'reveal') {
                entry.reveal++;
                result = state();
              } else {
                const e = entry || {
                  id: p.id,
                  owner: crypto.randomUUID(),
                  placement: 'sidebar',
                  open: false,
                  size: [840, 620],
                  view: {},
                  reveal: 0,
                  pending: null,
                };
                if (p.view) e.view = p.view;
                e.pending = {
                  owner: crypto.randomUUID(),
                  placement: p.placement || e.placement,
                  ready: !e.open || p.owner === e.owner,
                };
                entries.set(p.id, e);
                if (
                  p.placement &&
                  p.placement !== 'edge' &&
                  p.placement !== fixture.mainPlacement
                ) {
                  fixture.pendingPlacement = p.placement;
                  for (const item of entries.values())
                    if (item.placement !== 'edge') {
                      item.pending = {
                        owner: crypto.randomUUID(),
                        placement: p.placement,
                        ready: !item.open,
                        grouped: true,
                      };
                    }
                }
                result = state();
              }
            } else if (p.op === 'handoff') {
              entry.view = p.view;
              entry.pending.ready = true;
              result = state();
            } else if (p.op === 'ready') {
              entry.pending.targetReady = true;
              const targets = entry.pending.grouped
                ? [...entries.values()].filter((e) => e.pending?.grouped)
                : [entry];
              if (targets.every((e) => e.pending.targetReady)) {
                if (fixture.pendingPlacement) {
                  fixture.mainPlacement = fixture.pendingPlacement;
                  fixture.pendingPlacement = null;
                }
                for (const e of targets)
                  Object.assign(e, {
                    owner: e.pending.owner,
                    placement: e.pending.placement,
                    open: true,
                    pending: null,
                    reveal: e.reveal + 1,
                  });
              }
              result = state();
            } else if (p.op === 'read')
              result =
                p.id === 'model'
                  ? modelState
                  : p.id === 'board'
                    ? tasks
                    : {
                        snapshot: {
                          ...window.__companionFloatingPanel.exportPanelState(),
                          ...(p.id === 'next'
                            ? fixture.nextProjection || {}
                            : fixture.outlineProjection || {}),
                        },
                      };
            else if (p.owner !== entry?.owner || entry.pending) result = { error: '过期归属' };
            else if (p.op === 'save' || p.op === 'close') {
              entry.view = p.view;
              if (p.op === 'close') entry.open = false;
              result = state();
            } else if (p.op === 'action') {
              fixture.featureActions.push(p);
              if (p.id === 'model') {
                modelState.snapshot.current = {
                  ...p.data.selection,
                  speed: p.data.preserveSpeed
                    ? modelState.snapshot.current.speed
                    : p.data.selection.speed,
                };
                modelState.snapshot.revision = 'model-v2';
              }
              result =
                p.id === 'model'
                  ? modelState
                  : p.id === 'board'
                    ? { error: '本用例不应修改任务' }
                    : window.__companionFloatingPanel.panelCommand(p.data);
            } else result = { error: '未知请求' };
            queueMicrotask(() => window.__companionDesktop.complete(id, structuredClone(result)));
          };
        });
        await mode(page, true);
        await openFeature('outline');
        const outline = page.locator('[data-feature="outline"]');
        await outline.getByRole('navigation', { name: '大纲' }).waitFor();
        await outline.getByRole('button', { name: '定位到本轮开头' }).waitFor();
        const refresh = page.getByRole('button', { name: '刷新大纲', exact: true });
        const refreshBox = await refresh.boundingBox();
        const titleBox = await page.getByRole('tab', { name: '大纲', exact: true }).boundingBox();
        assert.ok(
          Math.abs(refreshBox.y + refreshBox.height / 2 - titleBox.y - titleBox.height / 2) < 2,
          'outline refresh shares the tab row',
        );
        assert.equal(await outline.locator('.feature-pane-head').count(), 0);
        const waitRefresh = (opacity) =>
          page.waitForFunction((opacity) => {
            const button = document.querySelector(
              '.csw-feature-header-actions [data-refresh="outline"]',
            );
            return button && getComputedStyle(button).opacity === opacity;
          }, opacity);
        await page.mouse.move(10, 10);
        await waitRefresh('0');
        await page.locator('.csw-workbench-head').hover();
        await waitRefresh('1');
        await page.mouse.move(10, 10);
        await waitRefresh('0');
        await page.keyboard.press('Tab');
        await refresh.focus();
        await waitRefresh('1');
        await refresh.evaluate((node) => node.blur());
        await waitRefresh('0');
        await page.getByRole('tab', { name: '大纲', exact: true }).dblclick();
        assert.equal(await page.locator('.csw-workbench[data-composition="focus"]').count(), 1);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.csw-workbench[data-composition="focus"]').count(), 0);
        assert.equal(await outline.locator('.feature-pane-head strong').count(), 0);
        await page.locator('.csw-workbench-face').click();
        await page.waitForFunction(() => !window.__companionFloatingPanel.state.dockOpen);
        await page.getByRole('button', { name: 'CodexBuddy', exact: true }).click();
        await outline.getByRole('navigation', { name: '大纲' }).waitFor();
        const widthHandle = page.getByRole('separator', { name: '调整工作台宽度' });
        const beforeWidth = Number(await widthHandle.getAttribute('aria-valuenow'));
        await widthHandle.press('ArrowLeft');
        assert.equal(
          Number(await widthHandle.getAttribute('aria-valuenow')),
          Math.min(460, beforeWidth + 16),
        );
        assert.equal(
          await page.evaluate(() => window.__companionFloatingPanel.panelPreferences().dockWidth),
          Math.min(460, beforeWidth + 16),
        );
        const dock = page.locator('[data-codex-buddy-dock]');
        const dockBefore = await dock.boundingBox();
        const handleBox = await widthHandle.boundingBox();
        const savedBefore = Number(await widthHandle.getAttribute('aria-valuenow'));
        const dx = savedBefore > 400 ? 50 : -50;
        await page.mouse.move(
          handleBox.x + handleBox.width / 2,
          handleBox.y + handleBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          handleBox.x + handleBox.width / 2 + dx,
          handleBox.y + handleBox.height / 2,
          { steps: 10 },
        );
        await page.mouse.up();
        await page.waitForFunction(
          (expected) => window.__companionFloatingPanel.panelPreferences().dockWidth === expected,
          savedBefore - dx,
        );
        await page.waitForFunction(
          ({ before, dx }) =>
            Math.abs(
              document.querySelector('[data-codex-buddy-dock]').getBoundingClientRect().width -
                before +
                dx,
            ) < 2,
          { before: dockBefore.width, dx },
        );
        await outline.locator('.feature-body').evaluate((node) => {
          node.scrollTop = 150;
        });
        await page.waitForFunction(
          () => window.workbenchFixture.features.get('outline').view.top === 150,
        );
        await openFeature('board');
        await page.waitForTimeout(2100);
        await openFeature('outline');
        await outline.getByRole('navigation', { name: '大纲' }).waitFor();
        assert.equal(
          await outline.locator('.feature-body').evaluate((node) => node.scrollTop),
          150,
          'hidden tabs preserve reading across periodic save',
        );
        await openFeature('board');
        const capsule = page.locator('.csw-fab');
        assert.equal(await capsule.locator('.csw-status-stage').count(), 1);
        assert.equal(await page.locator('select[aria-label="打开功能"]').count(), 0);
        const board = page.locator('[data-feature="board"]');
        await board.getByText('保留原任务', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-codex-buddy-dock]').count(), 1);
        await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
        await board.getByLabel('新任务标题', { exact: true }).fill('尚未保存的标题');

        for (let i = 0; i < 10; i++) {
          await configureFeature('board', 'overlay');
          await page.waitForFunction(
            () =>
              window.workbenchFixture.features.get('board').placement === 'overlay' &&
              !window.workbenchFixture.features.get('board').pending,
          );
          await board.getByLabel('新任务标题', { exact: true }).waitFor();
          assert.equal(await outline.count(), 1);
          if (i === 0) {
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            const face = page.locator(
              '[data-companion-stepwise-root]:not([data-codex-buddy-features-root]) .csw-workbench-face',
            );
            await face.click();
            await page.waitForFunction(
              () => window.__companionFloatingPanel.state.popover.dataset.morphing === 'true',
            );
            await page.waitForFunction(
              () =>
                !window.__companionFloatingPanel.state.open &&
                window.__companionFloatingPanel.state.popover.dataset.morphing === 'false',
            );
            const rect = await page
              .getByRole('button', { name: 'CodexBuddy', exact: true })
              .boundingBox();
            assert.equal(await page.locator('.csw-fab').isVisible(), false);
            assert.equal(Math.round(rect.width), 36);
            assert.equal(Math.round(rect.height), 36);
            await page.getByRole('button', { name: 'CodexBuddy', exact: true }).click();
            await page.waitForFunction(
              () => window.__companionFloatingPanel.state.popover.dataset.morphing === 'true',
            );
            await page.waitForFunction(
              () =>
                window.__companionFloatingPanel.state.open &&
                window.__companionFloatingPanel.state.popover.dataset.morphing === 'false',
            );
            assert.equal(
              await page.locator('.csw-feature-menu,select[aria-label="打开功能"]').count(),
              0,
            );
            await board.getByLabel('新任务标题', { exact: true }).waitFor();
            assert.equal(
              await page.locator('[data-companion-stepwise-root]').count(),
              1,
              'only one main shell',
            );
            assert.equal(
              await page.locator('[data-codex-buddy-dock]').count(),
              0,
              'overlay releases sidebar',
            );
            await page.screenshot({ path: 'target/reports/workbench/restored-shell.png' });
            await page.emulateMedia({ reducedMotion: 'reduce' });
          }
          await configureFeature('board', 'sidebar');
          await page.waitForFunction(
            () =>
              window.workbenchFixture.features.get('board').placement === 'sidebar' &&
              !window.workbenchFixture.features.get('board').pending,
          );
          await board.getByLabel('新任务标题', { exact: true }).waitFor();
          assert.equal(await page.locator('[data-feature="board"]').count(), 1);
          assert.equal(await page.locator('[data-codex-buddy-dock]').count(), 1);
        }

        assert.equal(
          await board.getByLabel('新任务标题', { exact: true }).inputValue(),
          '尚未保存的标题',
        );

        await page.waitForFunction(
          () => window.workbenchFixture.features.get('board').view.board?.quickAdd,
        );
        await page.evaluate(() => {
          const e = window.workbenchFixture.features.get('board');
          return window.__companionDesktopRequest('/features', {
            op: 'close',
            id: 'board',
            owner: e.owner,
            view: e.view,
          });
        });
        await board.waitFor({ state: 'detached' });
        assert.equal(await outline.count(), 1);
        await page.locator('.csw-workbench-face').click();
        await page.waitForFunction(() => !window.__companionFloatingPanel.state.dockOpen);
        await page.getByRole('button', { name: 'CodexBuddy', exact: true }).click();
        await outline.getByRole('navigation', { name: '大纲' }).waitFor();
        assert.equal(
          await board.count(),
          0,
          'expanding the container must not reopen a closed feature',
        );

        await openFeature('board');
        await board.getByLabel('新任务标题', { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => window.workbenchFixture.featureActions.length),
          0,
          'moving never generates or writes tasks',
        );
        await openFeature('next');
        const next = page.locator('[data-feature="next"]');
        await page.getByRole('button', { name: '重新生成建议', exact: true }).waitFor();
        await page.mouse.move(10, 10);
        const waitNextRefresh = (opacity) =>
          page.waitForFunction(
            (opacity) =>
              [
                ...document.querySelectorAll('.csw-feature-header-actions [data-refresh="next"]'),
              ].some((button) => getComputedStyle(button).opacity === opacity),
            opacity,
          );
        await waitNextRefresh('0');
        await page.locator('.csw-workbench-head').hover();
        await waitNextRefresh('1');
        const nextRefreshBox = await page
          .getByRole('button', { name: '重新生成建议', exact: true })
          .boundingBox();
        const nextTabBox = await page
          .getByRole('tab', { name: '下一步', exact: true })
          .boundingBox();
        assert.ok(
          Math.abs(
            nextRefreshBox.y + nextRefreshBox.height / 2 - nextTabBox.y - nextTabBox.height / 2,
          ) < 2,
          'next refresh shares the tab row',
        );
        assert.equal(await next.locator('.feature-pane-head').count(), 0);
        await page.mouse.move(10, 10);
        await waitNextRefresh('0');
        await page.evaluate(() => {
          window.workbenchFixture.nextProjection = {
            prompts: [
              { label: '第一条合成建议', prompt: 'SYNTHETIC_FIRST' },
              {
                label: '第二条合成建议',
                prompt: 'SYNTHETIC_SECOND\n' + '合成的长预览内容，用于验证阅读位置。\n'.repeat(50),
              },
            ],
            display: { labelOnly: true, promptClickMode: 'fill' },
            bridgeStatus: 'ok',
          };
        });
        await next.locator('.csw-row[data-index="1"]').waitFor();
        await next.locator('.csw-row[data-index="1"]').focus();
        await page.waitForTimeout(1800);
        assert.equal(
          await next
            .locator('.csw-row[data-index="1"]')
            .evaluate((node) => node.getRootNode().activeElement === node),
          true,
          'polling preserves preview focus and pending click targets',
        );
        assert.equal(
          (await next.locator('.csw-prompt-preview-body').innerText()).split('\n')[0],
          'SYNTHETIC_SECOND',
        );
        const preview = next.locator('.csw-prompt-preview-scroll');
        const oldTop = await preview.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
          return node.scrollTop;
        });
        assert.ok(oldTop > 0, 'long preview scrolls within the feature');
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        await page.waitForFunction(
          (top) => window.workbenchFixture.features.get('next').view.previewTop === top,
          oldTop,
        );
        const originalHeight = await preview.evaluate((node) => node.clientHeight);
        await preview.evaluate((node) => {
          node.style.height = `${node.clientHeight + 200}px`;
        });
        await page.waitForFunction(
          ({ height }) => {
            const host = [...document.querySelectorAll('[data-codex-buddy-features-root]')].find(
              (node) => node.shadowRoot?.querySelector('[data-feature="next"]'),
            );
            return (
              host?.shadowRoot.querySelector('.csw-prompt-preview-scroll')?.clientHeight ===
              height + 200
            );
          },
          { height: originalHeight },
        );
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        assert.ok(
          (await preview.evaluate((node) => node.scrollTop)) < oldTop,
          'larger preview clamps the visible scroll',
        );
        await preview.evaluate((node) => node.style.removeProperty('height'));
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        assert.equal(
          await preview.evaluate((node) => node.scrollTop),
          oldTop,
          'preview restores reading after a resize clamp',
        );
        await page.screenshot({ path: 'target/reports/workbench/independent-next.png' });
        await next.locator('.csw-row[data-index="1"]').click();
        await page.waitForFunction(() => window.workbenchFixture.featureActions.length === 1);
        const fill = await page.evaluate(() => window.workbenchFixture.featureActions[0]);
        assert.equal(fill.data.kind, 'fill');
        assert.equal(fill.data.index, 1);
        assert.equal(fill.data.submit, false, 'fill preference never sends a message');
        await page.evaluate(() => {
          window.workbenchFixture.featureActions.length = 0;
        });

        await syncSettings(page, { enabled: false });
        await next.getByText('功能已停用，可在设置中重新开启。').waitFor();
        assert.equal(
          await page.getByRole('button', { name: '重新生成建议', exact: true }).isDisabled(),
          true,
        );
        assert.equal(await next.locator('.feature-projection button:enabled').count(), 0);
        await syncSettings(page, { enabled: true, answerOutlineEnabled: false });
        await openFeature('outline');
        await outline.getByText('功能已停用，可在设置中重新开启。').waitFor();
        assert.equal(
          await page.getByRole('button', { name: '刷新大纲', exact: true }).isDisabled(),
          true,
        );
        await syncSettings(page, { answerOutlineEnabled: true });
        await outline.getByText('功能已停用，可在设置中重新开启。').waitFor({ state: 'detached' });
        await openFeature('model');
        const model = page.locator('[data-feature="model"]');
        await model.locator('[data-model="a"][data-reasoning="low"]').waitFor();
        assert.equal(
          await page.locator('[data-feature]:visible').count(),
          1,
          'sidebar displays only the active tab',
        );
        assert.equal(
          await model.getByText('切换未完成', { exact: false }).count(),
          0,
          'successful handoff has no rollback warning',
        );
        await model.locator('[data-model="a"][data-reasoning="low"]').click();
        await page.waitForFunction(() => window.workbenchFixture.featureActions.length === 1);
        await model.locator('[data-reasoning="low"][aria-pressed="true"]').waitFor();
        const action = await page.evaluate(() => window.workbenchFixture.featureActions[0]);
        assert.equal(action.data.expectedRevision, 'model-v1');
        assert.equal(action.data.preserveSpeed, true);
        assert.equal(action.data.target.id, 'synthetic-chat');
        await page.screenshot({ path: 'target/reports/workbench/independent-model.png' });
        await page.setViewportSize({ width: 880, height: 960 });
        await page.waitForFunction(
          () => document.querySelector('[data-codex-buddy-dock]')?.dataset.reason === 'space',
        );
        await page.getByRole('button', { name: 'CodexBuddy', exact: true }).click();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('.csw-dock-menu,.csw-dock-warning').count(), 0);
        assert.equal(
          await page.evaluate(() => window.workbenchFixture.features.get('model').placement),
          'sidebar',
        );
        assert.equal(await model.isVisible(), false);
        await page.setViewportSize({ width: 1500, height: 1000 });
        await page.getByRole('button', { name: 'CodexBuddy', exact: true }).press('Enter');
        await model.locator('[data-model="a"][data-reasoning="low"]').waitFor();
        await page.evaluate(() => {
          window.workbenchFixture.modelState.preferences.enabled = false;
        });
        await model.getByText('模型快切已停用，请在设置页开启。').waitFor();
        assert.equal(
          await model.getByRole('button', { name: '刷新可用模型', exact: true }).isDisabled(),
          true,
        );
        assert.equal(
          await model.locator('[data-model="a"][data-reasoning="low"]').isDisabled(),
          true,
        );
        await page.setViewportSize({ width: 1500, height: 1000 });
        await configureFeature('model', 'sidebar');
        await page.waitForFunction(() => !window.workbenchFixture.features.get('model').pending);
        await page
          .locator('.workspace')
          .evaluate((node) => node.classList.remove('app-shell-main-content-frame'));
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.dockStatus === 'unsupported',
        );
        await page.getByRole('button', { name: 'CodexBuddy', exact: true }).click();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('.csw-dock-menu,.csw-dock-warning').count(), 0);
        assert.equal(
          await page.evaluate(() => window.__companionFloatingPanel.panelPreferences().layoutMode),
          'workbench',
        );
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.csw-dock-menu').count(), 0);
        await page.evaluate(() => window.__companionFloatingPanel.destroy());
        assert.equal(await page.locator('[data-codex-buddy-features-root]').count(), 0);
        assert.equal(await page.locator('[data-codex-buddy-dock]').count(), 0);
      },
    ],
  ];
}
