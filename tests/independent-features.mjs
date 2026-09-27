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
        await page.evaluate(() => {
          const fixture = window.workbenchFixture,
            entries = new Map();
          fixture.features = entries;
          fixture.featureActions = [];
          const modelState = {
            revision: 1,
            preferences: { enabled: true, pinned: [], presets: [] },
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
              bindings: { todo: '', doing: '', waiting: '' },
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
            const state = () => ({ features: structuredClone([...entries.values()]) });
            const entry = entries.get(p.id);
            if (p.op === 'state') result = state();
            else if (p.op === 'reveal' || p.op === 'move') {
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
                result = state();
              }
            } else if (p.op === 'handoff') {
              entry.view = p.view;
              entry.pending.ready = true;
              result = state();
            } else if (p.op === 'ready') {
              Object.assign(entry, {
                owner: entry.pending.owner,
                placement: entry.pending.placement,
                open: true,
                pending: null,
                reveal: entry.reveal + 1,
              });
              result = state();
            } else if (p.op === 'read')
              result =
                p.id === 'model'
                  ? modelState
                  : p.id === 'board'
                    ? tasks
                    : { snapshot: window.__companionFloatingPanel.exportPanelState() };
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
        await page.getByLabel('独立打开功能').selectOption('outline');
        const outline = page.locator('[data-feature="outline"]');
        await outline.getByRole('navigation', { name: '大纲' }).waitFor();
        await page.getByLabel('打开功能').selectOption('board');
        const board = page.locator('[data-feature="board"]');
        await board.getByRole('button', { name: '保留原任务', exact: true }).waitFor();
        assert.equal(await page.locator('[data-codex-buddy-dock]').count(), 1);
        await board.getByRole('button', { name: '保留原任务', exact: true }).click();
        await board.getByLabel('标题', { exact: true }).fill('尚未保存的标题');
        await board.getByLabel('备注', { exact: true }).fill('切换位置仍保留');
        await board.getByRole('button', { name: '保留草稿并返回' }).click();
        for (let i = 0; i < 10; i++) {
          await board.getByLabel('看板显示位置').selectOption('overlay');
          await page.waitForFunction(
            () =>
              window.workbenchFixture.features.get('board').placement === 'overlay' &&
              !window.workbenchFixture.features.get('board').pending,
          );
          await board.getByRole('button', { name: '继续编辑草稿' }).waitFor();
          assert.equal(await outline.isVisible(), true);
          await board.getByLabel('看板显示位置').selectOption('sidebar');
          await page.waitForFunction(
            () =>
              window.workbenchFixture.features.get('board').placement === 'sidebar' &&
              !window.workbenchFixture.features.get('board').pending,
          );
          await board.getByRole('button', { name: '继续编辑草稿' }).waitFor();
          assert.equal(await page.locator('[data-feature="board"]').count(), 1);
          assert.equal(await page.locator('[data-codex-buddy-dock]').count(), 1);
        }
        await board.getByRole('button', { name: '继续编辑草稿' }).click();
        assert.equal(
          await board.getByLabel('标题', { exact: true }).inputValue(),
          '尚未保存的标题',
        );
        assert.equal(
          await board.getByLabel('备注', { exact: true }).inputValue(),
          '切换位置仍保留',
        );
        await board.getByRole('button', { name: '保留草稿并返回' }).click();
        await board.getByRole('button', { name: '关闭看板', exact: true }).click();
        await board.waitFor({ state: 'detached' });
        assert.equal(await outline.isVisible(), true);
        await page.getByLabel('打开功能').selectOption('board');
        await board.getByRole('button', { name: '继续编辑草稿' }).waitFor();
        assert.equal(
          await page.evaluate(() => window.workbenchFixture.featureActions.length),
          0,
          'moving never generates or writes tasks',
        );
        await page.getByLabel('打开功能').selectOption('next');
        const next = page.locator('[data-feature="next"]');
        await next.getByRole('button', { name: '生成下一步', exact: true }).waitFor();
        await syncSettings(page, { enabled: false });
        await next.getByText('功能已停用，可在设置中重新开启。').waitFor();
        assert.equal(
          await next.getByRole('button', { name: '生成下一步', exact: true }).isDisabled(),
          true,
        );
        assert.equal(await next.locator('.feature-actions button:enabled').count(), 0);
        await syncSettings(page, { enabled: true, answerOutlineEnabled: false });
        await page.getByLabel('打开功能').selectOption('outline');
        await outline.getByText('功能已停用，可在设置中重新开启。').waitFor();
        assert.equal(
          await outline.getByRole('button', { name: '刷新大纲', exact: true }).isDisabled(),
          true,
        );
        await syncSettings(page, { answerOutlineEnabled: true });
        await outline.getByText('功能已停用，可在设置中重新开启。').waitFor({ state: 'detached' });
        await page.getByLabel('打开功能').selectOption('model');
        const model = page.locator('[data-feature="model"]');
        await model.getByRole('button', { name: 'low', exact: true }).waitFor();
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
        await model.getByRole('button', { name: 'low', exact: true }).click();
        await page.waitForFunction(() => window.workbenchFixture.featureActions.length === 1);
        await model.locator('button[aria-pressed="true"]').filter({ hasText: /^low$/ }).waitFor();
        const action = await page.evaluate(() => window.workbenchFixture.featureActions[0]);
        assert.equal(action.data.expectedRevision, 'model-v1');
        assert.equal(action.data.preserveSpeed, true);
        assert.equal(action.data.target.id, 'synthetic-chat');
        await page.screenshot({ path: 'target/reports/workbench/independent-model.png' });
        await page.setViewportSize({ width: 880, height: 960 });
        await page.waitForFunction(
          () => document.querySelector('[data-codex-buddy-dock]')?.dataset.reason === 'space',
        );
        await page.getByLabel('打开功能').selectOption('model');
        await page.getByRole('button', { name: '在聊天内展开', exact: true }).click();
        await page.waitForFunction(
          () =>
            window.workbenchFixture.features.get('model').placement === 'overlay' &&
            !window.workbenchFixture.features.get('model').pending,
        );
        await model.getByRole('button', { name: 'low', exact: true }).waitFor();
        assert.equal(
          await model.isVisible(),
          true,
          'narrow sidebar offers an accessible alternate placement',
        );
        await page.evaluate(() => {
          window.workbenchFixture.modelState.preferences.enabled = false;
        });
        await model.getByText('模型快切已停用，请在设置页开启。').waitFor();
        assert.equal(
          await model.getByRole('button', { name: '刷新', exact: true }).isDisabled(),
          true,
        );
        assert.equal(
          await model.getByRole('button', { name: 'low', exact: true }).isDisabled(),
          true,
        );
        await page.evaluate(() => window.__companionFloatingPanel.destroy());
        assert.equal(await page.locator('[data-codex-buddy-features-root]').count(), 0);
        assert.equal(await page.locator('[data-codex-buddy-dock]').count(), 0);
      },
    ],
  ];
}
