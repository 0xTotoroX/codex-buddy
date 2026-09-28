/* [INPUT]: 已保存的功能、承载、任务和模型配置，以及当前连接与外观状态。
 * [OUTPUT]: 按承载和功能组织的只读总览，展示任务分组数量和模型配置，不包含操作控件。
 * [POS]: 设置展示层；仅在总览可见时读取现有服务，不创建新配置。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useState, type ReactNode } from 'react';
import { request, type Settings, type View } from './api';
import type { SurfaceState } from './surface-settings';
import { titles, type FeatureId, type FeatureState, type Placement } from '../shared/features';
import { columns, taskGroup, type TaskState } from '../features/board/api';
import type { ModelState } from '../features/model/view';
import { resolveFeatureLayout } from '../surfaces/workspace/layout';
import type { SurfaceTheme } from '../surfaces/theme/appearance';
import { Feedback } from './settings-controls';

const placements: Record<Placement, string> = {
  sidebar: '侧栏',
  overlay: '页面浮层',
  desktop: '桌面窗口',
  edge: '贴边 / 刘海',
};
const axes: Record<string, string> = {
  auto: '自动分栏',
  vertical: '上下分栏',
  horizontal: '左右分栏',
};
type Snapshot = {
  features: FeatureState;
  surfaces: SurfaceState;
  tasks: TaskState;
  models: ModelState;
  settings: Settings;
};
function themeLabel(value?: SurfaceTheme) {
  if (!value) return '未读取';
  if (value.theme === 'native-glass')
    return value.liquidVariant === 'clear' ? '液态 · 通透' : '液态 · 标准';
  return { black: '纯黑', matte: '哑光', frosted: '磨砂' }[value.theme];
}
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function SettingsOverview({
  active,
  live,
  view,
}: {
  active: boolean;
  live: boolean;
  view: View | null;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active || !live) return;
    let disposed = false,
      reading = false;
    const read = async () => {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const [features, surfaces, tasks, models, settings] = await Promise.all([
          request<FeatureState>('features', { op: 'state' }),
          request<SurfaceState>('surfaces', { op: 'state' }),
          request<TaskState>('tasks/state'),
          request<ModelState>('model-control/state'),
          request<Settings>('settings'),
        ]);
        if (!disposed) {
          setSnapshot({ features, surfaces, tasks, models, settings });
          setError('');
        }
      } catch (e) {
        if (!disposed) setError(`总览未能更新：${(e as Error).message}`);
      } finally {
        reading = false;
      }
    };
    void read();
    window.addEventListener('focus', read);
    const timer = setInterval(() => void read(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, [active, live]);
  if (!snapshot)
    return error ? (
      <Feedback text={error} failed />
    ) : live ? (
      <p role="status">正在读取总览…</p>
    ) : null;
  const { features, surfaces, tasks, models, settings } = snapshot;
  const primary = features.mainPlacement || 'sidebar';
  const ui = view?.panelPreferences.ui;
  const enabled: Record<FeatureId, boolean> = {
    outline: settings.answerOutlineEnabled,
    next: settings.enabled,
    board: tasks.store.boardEnabled,
    model: models.preferences.enabled,
  };
  const location = (id: FeatureId) =>
    features.features.find((e) => e.id === id)?.placement || (id === 'model' ? 'edge' : primary);
  const ids = (Object.keys(titles) as FeatureId[]).filter((id) => location(id) !== 'edge');
  const layout = resolveFeatureLayout(
    features.layouts?.[primary],
    features.legacyLayouts?.[primary],
    ids,
  );
  const layoutLabel =
    layout.groups.length === 1
      ? '标签组'
      : layout.groups.some((group) => 'groups' in group || group.ids.length > 1)
        ? '自定义分栏'
        : axes[layout.axis];
  const current = models.snapshot.current;
  const modelName =
    current && (models.snapshot.models.find((m) => m.id === current.model)?.label || current.model);
  const boardColumns = tasks.store.columns ?? columns;
  const modelLabel = (id: string) => models.snapshot.models.find((m) => m.id === id)?.label || id;
  const favorites = [
    ...new Set([...(models.preferences.modelOrder ?? []), ...models.preferences.pinned]),
  ].filter((id) => models.preferences.pinned.includes(id));
  const reasoningLabel = (value: string) =>
    ({
      none: '无',
      minimal: '最低',
      low: '低',
      medium: '中',
      high: '高',
      xhigh: '很高',
      max: '最高',
      ultra: '极高',
    })[value] || value;
  const featureList = (placement: Placement) => (
    <ul className="overview-features">
      {(Object.keys(titles) as FeatureId[])
        .filter((id) => location(id) === placement)
        .map((id) => (
          <li key={id}>
            <span>{titles[id]}</span>
            {!enabled[id] && <span className="overview-muted">已停用</span>}
          </li>
        ))}
    </ul>
  );
  return (
    <div className="settings-overview" aria-label="当前配置总览">
      <Feedback text={error || surfaces.error || tasks.error || ''} failed />
      <section className="overview-surface" aria-label="承载与功能">
        <div className="overview-hero">
          <div className="overview-identity">
            <h2>主界面</h2>
            <strong>{placements[primary]}</strong>
            {featureList(primary)}
          </div>
          <dl className="overview-metrics">
            <Metric label="主题">{themeLabel(surfaces.preferences.themes[primary])}</Metric>
            <Metric label="布局">{layoutLabel}</Metric>
            <Metric label="字号">
              {ui
                ? `${Math.max(10, Math.min(24, ui.fontOffset + (view?.panelFontBase ?? 13))).toFixed(1)} px`
                : '未读取'}
            </Metric>
            {primary === 'sidebar' && ui && <Metric label="宽度">{ui.dockWidth} px</Metric>}
            {primary === 'desktop' && view && (
              <Metric label="置顶">{view.panelPreferences.alwaysOnTop ? '开启' : '关闭'}</Metric>
            )}
          </dl>
        </div>
        <div className="overview-edge">
          <div>
            <h3>贴边 / 刘海</h3>
            {featureList('edge')}
          </div>
          <dl className="overview-metrics">
            <Metric label="主题">{themeLabel(surfaces.preferences.themes.edge)}</Metric>
            <Metric label="位置">
              {{ right: '右侧', left: '左侧', top: '顶部' }[surfaces.preferences.edge.edge] ||
                surfaces.preferences.edge.edge}{' '}
              · {Math.round(surfaces.preferences.edge.position * 100)}%
            </Metric>
            <Metric label="展开">
              {surfaces.preferences.edge.keepOpen ? '保持展开' : '鼠标靠近时展开'}
            </Metric>
          </dl>
        </div>
      </section>
      <section className="overview-surface" aria-label="下一步配置">
        <div className="overview-hero">
          <div className="overview-identity">
            <h2>下一步</h2>
            <strong>{settings.model || '未配置模型'}</strong>
            <p className="overview-muted">
              {!settings.enabled
                ? '已停用'
                : settings.available
                  ? '已启用'
                  : settings.reason || '等待配置'}
            </p>
          </div>
          <dl className="overview-metrics">
            <Metric label="生成">
              {settings.generationMode === 'manual' ? '手动刷新' : '自动生成'}
            </Metric>
            <Metric label="显示">
              {ui ? (ui.labelOnly ? '仅标题' : '标题 + 摘要') : '未读取'}
            </Metric>
            <Metric label="点击">
              {ui
                ? { fill: '仅填入', direct: '直接发送', hybrid: '单击填入 · 双击发送' }[
                    ui.promptClickMode
                  ]
                : '未读取'}
            </Metric>
          </dl>
        </div>
        <dl className="overview-footer">
          <Metric label="方向">
            {{ auto: '自动探索', manual: '自选方向', smart: '智能挑选' }[settings.directionSource]}
          </Metric>
          <Metric label="数量">最多 {settings.maxItems} 条</Metric>
        </dl>
      </section>
      <section className="overview-surface overview-board" aria-label="看板配置">
        <header className="overview-section-head">
          <h2>看板</h2>
          <span className="overview-muted">
            {!enabled.board && '已停用 · '}
            {tasks.store.syncEnabled ? 'Apple 提醒事项同步' : '本地保存'}
          </span>
        </header>
        <dl className="overview-board-columns">
          {boardColumns.map((column) => (
            <div key={column.id}>
              <dt>{column.title}</dt>
              <dd>
                {tasks.store.tasks.filter((task) => taskGroup(task) === column.id).length}
                <span>项</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="overview-surface overview-model" aria-label="模型快切配置">
        <header className="overview-section-head">
          <h2>模型快切</h2>
          {!enabled.model && <span className="overview-muted">已停用</span>}
        </header>
        <div className="overview-model-content">
          <div className="overview-model-current">
            <h3>当前模型</h3>
            <strong>{modelName || '未读取'}</strong>
            {current && (
              <p className="overview-muted">
                {[
                  current.reasoning && `推理：${reasoningLabel(current.reasoning)}`,
                  current.speed === 'fast' && '快速模式',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {models.snapshot.message && !['ready', 'waiting'].includes(models.snapshot.status) && (
              <p role="status">{models.snapshot.message}</p>
            )}
          </div>
          <div className="overview-model-favorites">
            <h3>常用模型</h3>
            {favorites.length ? (
              <ul>
                {favorites.map((id) => (
                  <li key={id}>{modelLabel(id)}</li>
                ))}
              </ul>
            ) : (
              <p className="overview-muted">未设置</p>
            )}
          </div>
        </div>
        {models.preferences.presets.length > 0 && (
          <div className="overview-model-presets">
            <h3>预设</h3>
            <ul>
              {models.preferences.presets.map((preset) => (
                <li key={preset.id}>
                  <span>{preset.name}</span>
                  <span className="overview-muted">{modelLabel(preset.selection.model)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
