/* [INPUT]: Shared workbench fixture and paired host/desktop projections.
 * [OUTPUT]: Outline/board surface and independent task behavior acceptance.
 * [POS]: Pilot cases; no EventKit access or real chats.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
export function featureSurfaceCases({ mode, createPopout, settle, output, bundle }) {
  return [
    [
      'feature surfaces preserve outline context and board data across containers',
      async (page) => {
        await page.evaluate(() => {
          const task = {
            id: 'pilot-one',
            fields: {
              title: '试点任务',
              notes: '同一任务，切换位置',
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
          const state = {
            store: {
              revision: 1,
              boardEnabled: true,
              syncEnabled: false,
              bindings: { calendarId: '' },
              tasks: [task],
              inflight: null,
            },
            status: '同步已暂停',
            error: null,
          };
          window.workbenchFixture.taskState = state;
          window.workbenchFixture.taskCommands = [];
          window.workbenchFixture.taskReads = 0;
          window.pilotTasks = (path, body) => {
            if (path === 'tasks/state') {
              window.workbenchFixture.taskReads++;
              return structuredClone(state);
            }
            window.workbenchFixture.taskCommands.push(structuredClone(body));
            if (body.op !== 'update') throw Error('Unexpected task mutation: ' + body.op);
            if (body.revision !== state.store.revision)
              return { error: '任务已在别处更新，请刷新' };
            state.store.tasks[0].fields = structuredClone(body.fields);
            state.store.revision++;
            return structuredClone(state);
          };
          const original = window.__companionHostRequest;
          window.__companionHostRequest = (raw) => {
            const { id, path, payload } = JSON.parse(raw);
            if (!path.startsWith('/tasks/') && path !== '/panel/detach') return original(raw);
            const result =
              path === '/panel/detach' ? { ok: true } : window.pilotTasks(path.slice(1), payload);
            queueMicrotask(() => window.__companionDesktop.complete(id, result));
          };
        });
        await mode(page, true);
        await page.getByLabel('显示功能', { exact: true }).selectOption('outline');
        assert.equal(await page.locator('[data-pane="outline"]').isVisible(), true);
        assert.equal(await page.locator('[data-pane="next"]').isVisible(), false);
        const outlineCount = await page.locator('[data-outline-id]').count();
        assert.ok(outlineCount > 0);
        await page.getByLabel('功能显示位置', { exact: true }).selectOption('overlay');
        await page.waitForFunction(() => !document.querySelector('[data-codex-buddy-dock]'));
        assert.equal(await page.locator('[data-outline-id]').count(), outlineCount);
        await page.getByLabel('功能显示位置', { exact: true }).selectOption('sidebar');
        await page.getByLabel('显示功能', { exact: true }).selectOption('board');
        const board = page.locator('.csw-board-mount');
        await board.getByText('试点任务', { exact: true }).waitFor();
        await board
          .getByText('试点任务', { exact: true })
          .dragTo(
            board
              .getByRole('navigation', { name: '任务阶段' })
              .getByRole('button', { name: '进行中', exact: true }),
          );
        await board
          .getByRole('navigation', { name: '任务阶段' })
          .getByRole('button', { name: '进行中', exact: true })
          .click();
        await board.getByText('试点任务', { exact: true }).waitFor();
        await board.getByRole('button', { name: '搜索任务', exact: true }).click();
        await board.getByPlaceholder('搜索任务…').fill('试点');
        await page.getByLabel('功能显示位置', { exact: true }).selectOption('overlay');
        await page.waitForFunction(() => !document.querySelector('[data-codex-buddy-dock]'));
        await board.getByText('试点任务', { exact: true }).waitFor();
        assert.equal(await board.getByPlaceholder('搜索任务…').inputValue(), '试点');
        await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
        await board.getByLabel('新任务标题', { exact: true }).fill('');
        await board.getByLabel('新任务标题', { exact: true }).press('Shift+O');
        assert.equal(await board.getByLabel('新任务标题', { exact: true }).inputValue(), 'O');
        await board.getByLabel('新任务标题', { exact: true }).press('Escape');
        await board.getByLabel('新任务标题', { exact: true }).waitFor({ state: 'detached' });
        await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
        await board.getByLabel('新任务标题', { exact: true }).fill('跨窗口新建草稿');
        assert.equal(await board.isVisible(), true);
        for (let i = 0; i < 3; i++) {
          await page.getByLabel('功能显示位置', { exact: true }).selectOption('sidebar');
          await page.getByLabel('功能显示位置', { exact: true }).selectOption('overlay');
        }
        await page.getByLabel('显示功能', { exact: true }).selectOption('outline');
        await page.getByLabel('显示功能', { exact: true }).selectOption('board');
        assert.equal(await board.getByPlaceholder('搜索任务…').inputValue(), '试点');
        await page.evaluate(async () => {
          Object.assign(window.workbenchFixture.settings, {
            enabled: false,
            answerOutlineEnabled: false,
            taskBoardEnabled: true,
          });
          await window.__companionFloatingPanel.syncSettings(window.workbenchFixture.settings);
        });
        await board.getByText('试点任务', { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => window.__companionFloatingPanel.state.runtimeActive),
          true,
        );
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.__companionFloatingPanel.setOpen(false));
          await page.locator('.csw-fab').waitFor({ state: 'visible' });
          await page.locator('.csw-fab').press('Enter');
          await board.getByText('试点任务', { exact: true }).waitFor();
        }
        const reads = await page.evaluate(() => window.workbenchFixture.taskReads);
        await page.waitForTimeout(2200);
        const delta = (await page.evaluate(() => window.workbenchFixture.taskReads)) - reads;
        assert.ok(delta >= 1 && delta <= 2, `One active board poller expected, got ${delta}`);
        await page.getByLabel('功能显示位置', { exact: true }).selectOption('desktop');
        const { page: desktop, projection } = await createPopout(page, true);
        const desktopBoard = desktop.locator('.csw-board-mount');
        await desktopBoard.getByText('试点任务', { exact: true }).waitFor();
        assert.equal(await desktopBoard.getByPlaceholder('搜索任务…').inputValue(), '试点');
        await desktop.evaluate(() =>
          window.__companionFloatingPanel.panelDisconnected('测试宿主断开'),
        );
        assert.equal(
          await desktopBoard.getByLabel('新任务标题', { exact: true }).inputValue(),
          '跨窗口新建草稿',
        );
        await desktopBoard
          .getByText('试点任务', { exact: true })
          .dragTo(
            desktopBoard
              .getByRole('navigation', { name: '任务阶段' })
              .getByRole('button', { name: '完成', exact: true }),
          );
        await desktop.waitForFunction(
          () => window.__companionFloatingPanel.state.taskView.stage === 'done',
        );
        await desktopBoard.getByPlaceholder('搜索任务…').fill('任务');
        const presentation = await desktop.evaluate(() =>
          window.__companionFloatingPanel.panelReadingState(),
        );
        await page.evaluate(
          ({ ui, presentation }) =>
            window.__companionFloatingPanel.setDetached(false, ui, presentation),
          { ui: { ...projection.preferences.ui, layoutMode: 'workbench' }, presentation },
        );
        assert.equal(presentation.taskView.search, '任务');
        await page.getByLabel('功能显示位置', { exact: true }).selectOption('sidebar');
        await board.getByText('试点任务', { exact: true }).waitFor();
        assert.equal(await board.getByPlaceholder('搜索任务…').inputValue(), '任务');
        await settle(page);
        const state = await page.evaluate(() => window.workbenchFixture.taskState);
        assert.equal(state.store.tasks.length, 1);
        assert.equal(state.store.tasks[0].fields.completed, true);
        assert.equal(state.store.tasks[0].fields.notes, '同一任务，切换位置');
        assert.equal(presentation.taskView.quickAdd.title, '跨窗口新建草稿');
        assert.equal(state.store.syncEnabled, false);
        assert.equal(
          await page.evaluate(
            () =>
              window.workbenchFixture.requests.filter((r) => r.path === '/stepwise/generate')
                .length,
          ),
          0,
        );
        assert.equal(await page.locator('iframe[src*="token="]').count(), 0);
        await page.screenshot({ path: `${output}/pilot-sidebar.png` });
        await desktop.screenshot({ path: `${output}/pilot-desktop.png` });
        await desktop.close();
        await page.evaluate(async () => {
          window.workbenchFixture.settings.taskBoardEnabled = false;
          await window.__companionFloatingPanel.syncSettings(window.workbenchFixture.settings);
        });
        await page.waitForFunction(() => !window.__companionFloatingPanel.state.runtimeActive);
        assert.equal(await page.locator('.csw-board-mount').count(), 0);
        const stoppedReads = await page.evaluate(() => window.workbenchFixture.taskReads);
        await page.waitForTimeout(2200);
        assert.equal(await page.evaluate(() => window.workbenchFixture.taskReads), stoppedReads);
        await page.evaluate(() => {
          window.__companionFloatingPanel.destroy();
          window.workbenchFixture.settings.taskBoardEnabled = true;
        });
        await page.evaluate(bundle);
        await page.waitForFunction(() => window.__companionFloatingPanel?.state.settingsLoaded);
        await page.locator('.csw-fab').waitFor({ state: 'visible' });
        await page.locator('.csw-fab').press('Enter');
        await page.getByLabel('显示功能', { exact: true }).selectOption('board');
        await board.getByRole('button', { name: '搜索任务', exact: true }).waitFor();
      },
    ],
  ];
}
