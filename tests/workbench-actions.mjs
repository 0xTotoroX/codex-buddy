/*
 * [INPUT]: 已展开的合成工作台页面与功能名。
 * [OUTPUT]: 使用实际控件专注面板；显式挂载已隐藏的旧设置模板仅用于兼容回归。
 * [POS]: 端到端测试共享操作；替代已移除的旧展开页标签。
 * [PROTOCOL]: 变更时更新 tests/AGENTS.md。
 */
export async function showRetainedSettings(page, visible) {
  if ((await page.locator('.csw-workbench-settings').isVisible()) !== visible)
    await page.locator('[data-legacy-settings]').evaluate((node) => node.click());
}

export async function showWorkbenchView(page, name) {
  const settings = page.locator('.csw-workbench-settings');
  if (name === 'settings') {
    // 测试保留代码，不代表产品仍提供内置设置入口。
    await showRetainedSettings(page, true);
    return;
  }
  if (await settings.isVisible()) await showRetainedSettings(page, false);
  const workbench = page.locator('.csw-workbench');
  if ((await workbench.getAttribute('data-composition')) === 'focus') {
    const current = page.locator('[data-pane]:not([hidden])');
    if ((await current.getAttribute('data-pane')) === name) return;
    await page.keyboard.press('Escape');
  }
  if ((await workbench.getAttribute('data-composition')) === 'tabs')
    await page.locator(`[data-pane-tab="${name}"]`).dblclick();
  else await page.locator(`[data-pane-focus="${name}"]`).dblclick();
}
