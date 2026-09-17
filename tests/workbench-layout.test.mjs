/*
 * [INPUT]: 纯工作台布局模型。
 * [OUTPUT]: 尺寸约束、临界尺寸滞回和旧偏好迁移回归。
 * [POS]: 不启动宿主或模型的布局决策测试。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeWorkbenchPanels,
  workbenchPanels,
  normalizeWorkbenchLayout,
  resolveWorkbenchLayout,
} from '../ui/panel/workbench/model.js';

test('legacy ratio migrates without coupling presentation preferences', () => {
  const dock = normalizeWorkbenchLayout(null, 0.6);
  const popout = normalizeWorkbenchLayout(null, 0.6);
  dock.verticalRatio = 0.7;
  assert.equal(popout.verticalRatio, 0.6);
  assert.equal(popout.horizontalRatio, 0.4);
  assert.equal(popout.mode, 'auto');
  assert.deepEqual(
    normalizeWorkbenchLayout({ mode: 'bad', verticalRatio: NaN, horizontalRatio: 9 }),
    {
      mode: 'auto',
      first: 'outline',
      verticalRatio: 0.45,
      horizontalRatio: 0.8,
    },
  );
});

test('automatic axis has hysteresis while manual horizontal preference survives a small viewport', () => {
  const preference = normalizeWorkbenchLayout(null);
  let axis = '';
  for (const [width, expected] of [
    [480, 'vertical'],
    [510, 'vertical'],
    [520, 'horizontal'],
    [510, 'horizontal'],
    [487, 'vertical'],
  ]) {
    axis = resolveWorkbenchLayout(preference, width, 500, axis).axis;
    assert.equal(axis, expected);
  }
  preference.mode = 'horizontal';
  assert.equal(resolveWorkbenchLayout(preference, 340, 500).axis, 'vertical');
  assert.equal(preference.mode, 'horizontal');
  assert.equal(resolveWorkbenchLayout(preference, 488, 500).axis, 'horizontal');
});

test('both orders protect each pane minimum without overwriting requested proportions', () => {
  for (const first of ['outline', 'next']) {
    const p = normalizeWorkbenchLayout({ mode: 'horizontal', first, horizontalRatio: 0.2 });
    for (const width of [488, 510, 624]) {
      const split = resolveWorkbenchLayout(p, width, 500);
      const firstMinimum = first === 'outline' ? 220 : 260;
      const secondMinimum = first === 'outline' ? 260 : 220;
      assert.ok(split.available * split.ratio >= firstMinimum - 0.01);
      assert.ok(split.available * (1 - split.ratio) >= secondMinimum - 0.01);
      assert.equal(p.horizontalRatio, 0.2);
    }
  }
});

test('registering another panel does not implicitly open or generate it', () => {
  const registry = [
    ...workbenchPanels,
    { id: 'future', title: '测试', minWidth: 800, minHeight: 800 },
  ];
  assert.deepEqual(
    activeWorkbenchPanels(registry).map(({ id }) => id),
    ['outline', 'next'],
  );
  assert.equal(
    resolveWorkbenchLayout(normalizeWorkbenchLayout(null), 600, 500, '', registry).axis,
    'horizontal',
  );
});
