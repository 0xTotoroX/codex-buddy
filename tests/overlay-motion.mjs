/* [INPUT]: 已挂载真实功能视图的合成浮层与 Playwright 页面。
 * [OUTPUT]: 曲面缩放中间帧、反向、草稿、减少动态效果和销毁回归。
 * [POS]: independent-features 的浮层动效验收；不读取真实聊天。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import assert from 'node:assert/strict';

export async function checkOverlayMotion(page, configureFeature) {
  const sample = (target, fraction) =>
    page.evaluate(
      async ({ target, fraction }) => {
        const runtime = window.__companionFloatingPanel;
        runtime.setOpen(target);
        const state = runtime.state;
        const animation = state.morphAnimation;
        window.clearTimeout(state.morphTransition.fallbackTimer);
        animation.pause();
        animation.currentTime = Number(animation.effect.getTiming().duration) * fraction;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const rect = state.popover.getBoundingClientRect();
        const glass = getComputedStyle(state.glass);
        const panel = getComputedStyle(state.panel);
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          glassWidth: parseFloat(glass.width),
          glassHeight: parseFloat(glass.height),
          fullWidth: state.layout.width,
          fullHeight: state.layout.height,
          panelVisible: panel.visibility === 'visible' && panel.opacity === '1',
          inert: state.panel.inert,
          capsule: getComputedStyle(state.fab).display,
          filter: getComputedStyle(state.popover).filter,
          warp: Number(
            document
              .querySelector('[id^="csw-overlay-warp-"] feDisplacementMap')
              ?.getAttribute('scale'),
          ),
          transform: getComputedStyle(state.popover).transform,
        };
      },
      { target, fraction },
    );

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const start = await page.locator('.csw-popover').boundingBox();
  const halfway = await sample(false, 0.2);
  assert.equal(halfway.panelVisible, true, 'content stays visible while closing');
  assert.equal(halfway.inert, true, 'moving content cannot receive edits');
  assert.equal(halfway.capsule, 'none');
  assert.equal(halfway.glassWidth, halfway.fullWidth, 'surface never becomes capsule geometry');
  assert.equal(halfway.glassHeight, halfway.fullHeight);
  assert.ok(halfway.width < start.width && halfway.width > 36);
  assert.ok(halfway.left < start.x, 'whole panel travels toward the left launcher');
  assert.ok(halfway.filter.includes('csw-overlay-warp-') && halfway.warp > 0);
  await page.screenshot({ path: 'target/reports/workbench/overlay-genie-midpoint.png' });
  const warped = await page.screenshot();
  await page.evaluate(() => {
    window.__companionFloatingPanel.state.popover.style.filter = 'none';
  });
  const unwarped = await page.screenshot();
  assert.notDeepEqual(warped, unwarped, 'filter changes actual rendered pixels');
  await page.evaluate((filter) => {
    window.__companionFloatingPanel.state.popover.style.filter = filter;
    document.querySelector('nav').style.transform = 'translateY(-80px)';
  }, halfway.filter);

  const reverse = await sample(true, 0);
  assert.ok(Math.abs(reverse.width - halfway.width) < 2, 'reverse starts at current visible size');
  assert.ok(
    Math.abs(reverse.left - halfway.left) < 2,
    'reverse starts at current visible position',
  );
  assert.ok(
    Math.abs(reverse.top - halfway.top) < 2,
    'moving launcher does not jump a reversed flight',
  );
  assert.ok(Math.abs(reverse.warp - halfway.warp) < 0.1, 'reverse retains the current curve');
  await page.evaluate(() => document.querySelector('nav').style.removeProperty('transform'));
  await page.evaluate(() => window.__companionFloatingPanel.state.morphAnimation.finish());
  await page.waitForFunction(
    () => window.__companionFloatingPanel.state.popover.dataset.morphing === 'false',
  );
  assert.equal(await page.locator('[id^="csw-overlay-warp-"]').count(), 0);
  assert.equal(await page.locator('.csw-popover').evaluate((node) => node.style.filter), '');
  assert.equal(await page.getByLabel('新任务标题', { exact: true }).inputValue(), '尚未保存的标题');

  await page.evaluate(() => window.__companionFloatingPanel.setOpen(false));
  await page.waitForFunction(
    () => window.__companionFloatingPanel.state.popover.dataset.morphing === 'false',
  );
  assert.equal(await page.locator('.csw-popover').isVisible(), false);
  const opening = await sample(true, 0.2);
  assert.equal(opening.panelVisible, true);
  assert.ok(opening.width > 36 && opening.width < start.width);
  await page.evaluate(() => window.__companionFloatingPanel.state.morphAnimation.finish());
  await page.waitForFunction(
    () => window.__companionFloatingPanel.state.popover.dataset.morphing === 'false',
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const runtime = window.__companionFloatingPanel;
    runtime.setOpen(false);
    window.workbenchFixture.reducedOverlayAnimated = !!runtime.state.morphAnimation;
    runtime.setOpen(true);
  });
  assert.equal(await page.evaluate(() => window.workbenchFixture.reducedOverlayAnimated), false);
  assert.equal(await page.locator('[id^="csw-overlay-warp-"]').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await sample(false, 0.2);
  await configureFeature('board', 'sidebar');
  await page.waitForFunction(() => window.__companionFloatingPanel.state.dockStatus === 'open');
  assert.equal(await page.locator('[id^="csw-overlay-warp-"]').count(), 0);
  assert.equal(
    await page.locator('.csw-popover').evaluate((node) => getComputedStyle(node).transform),
    'none',
  );
  await configureFeature('board', 'overlay');
  await page.waitForFunction(
    () =>
      window.__companionFloatingPanel.state.layoutMode === 'capsule' &&
      !window.workbenchFixture.features.get('board').pending,
  );
  await page.getByLabel('新任务标题', { exact: true }).waitFor();

  await sample(false, 0.2);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width - 20, height: viewport.height });
  await page.waitForFunction(() => !window.__companionFloatingPanel.state.morphAnimation);
  assert.equal(await page.locator('[id^="csw-overlay-warp-"]').count(), 0);
  await page.setViewportSize(viewport);
  await page.evaluate(() => window.__companionFloatingPanel.setOpen(true));
  await page.waitForFunction(() => !window.__companionFloatingPanel.state.morphAnimation);

  // 导航暂时消失时只短缩放/淡出，不恢复旧胶囊。
  await page.evaluate(() => {
    window.workbenchFixture.hiddenRail = document.querySelector('nav');
    window.workbenchFixture.hiddenRail.remove();
  });
  await page.waitForFunction(() => !document.querySelector('[data-codex-buddy-launcher]'));
  const missing = await sample(false, 0.2);
  assert.equal(missing.capsule, 'none');
  assert.equal(missing.filter, 'none');
  await page.evaluate(() => {
    window.__companionFloatingPanel.state.morphAnimation.finish();
    document.body.append(window.workbenchFixture.hiddenRail);
  });
  await page.waitForFunction(() => !window.__companionFloatingPanel.state.morphAnimation);
  await page.getByRole('button', { name: 'CodexBuddy', exact: true }).press('Enter');
  await page.waitForFunction(() => !window.__companionFloatingPanel.state.morphAnimation);
}
