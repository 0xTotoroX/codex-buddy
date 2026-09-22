/*
 * [INPUT]: 已展开的合成工作台页面与功能名。
 * [OUTPUT]: 使用实际控件打开设置或专注面板，不调用业务 API。
 * [POS]: 端到端测试共享操作；替代已移除的旧展开页标签。
 * [PROTOCOL]: 变更时更新 tests/AGENTS.md。
 */
export async function showWorkbenchView(page, name) {
  const settings = page.locator('.csw-workbench-settings');
  if (name === 'settings') {
    if (!(await settings.isVisible())) await page.locator('[data-workbench-settings]').click();
    return;
  }
  if (await settings.isVisible()) await page.locator('[data-workbench-settings]').click();
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
