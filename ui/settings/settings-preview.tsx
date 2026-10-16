/* [INPUT]: Read-only snapshots from the existing forms, saved surfaces and feature layout.
 * [OUTPUT]: Linked configuration diagrams and isolated, state-preserving samples in a stable transition frame.
 * [POS]: Settings presentation only; no requests, credentials, task bodies or host commands.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { SettingsMode, SettingsPage } from './settings-outline';
import type { EditableSettings, View } from './api';
import type { SurfaceState } from './surface-settings';
import { titles, type FeatureId, type FeatureLayout, type FeatureState } from '../shared/features';
import type { ModelState } from '../features/model/catalog';
import type { TaskState } from '../features/board/api';
import { columns as defaultColumns } from '../features/board/api';
import { resolveFeatureLayout } from '../surfaces/workspace/layout';
import { Icon } from '../shared/icons/react';
import { usePreviewMotion, usePreviewTransition } from './settings-motion';

const placements = {
  sidebar: '侧栏',
  overlay: '页面浮层',
  desktop: '桌面窗口',
  edge: '贴边 / 刘海',
};
const materials: Record<string, string> = {
  black: '纯黑',
  matte: '哑光',
  frosted: '磨砂',
  'native-glass': '液态',
};
function suggestionLimit(form: EditableSettings | null) {
  return form?.directionSource === 'manual'
    ? form.selectedDirections.length
    : (form?.maxItems ?? 3);
}
type PreviewProps = {
  mode: SettingsMode;
  page: SettingsPage;
  form: EditableSettings | null;
  dirty: boolean;
  features: FeatureState | null;
  surfaces: SurfaceState | null;
  model: ModelState | null;
  tasks: TaskState | null;
  view: View | null;
  live: boolean;
};

function Frame({
  title,
  label = '示意预览',
  children,
}: {
  title: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <section className="preview-frame" aria-label={title}>
      <header className="preview-heading">
        <h2>{title}</h2>
        <span>{label}</span>
      </header>
      {children}
    </section>
  );
}
function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="preview-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MiniContent({ id }: { id: string }) {
  if (id === 'board')
    return (
      <div className="preview-mini-board" aria-hidden="true">
        {['待办', '进行中', '完成'].map((label) => (
          <div key={label}>
            <span>{label}</span>
            <i />
            <i />
          </div>
        ))}
      </div>
    );
  if (id === 'model')
    return (
      <div className="preview-mini-model" aria-hidden="true">
        <span>当前模型</span>
        <b>● ● ● ○ ○</b>
        <i />
        <i />
      </div>
    );
  if (id === 'terms')
    return (
      <div className="preview-mini-text">
        <strong>Context</strong>
        <span>上下文 · 当前任务的背景信息</span>
      </div>
    );
  return (
    <ol className="preview-mini-list">
      {(id === 'next'
        ? ['继续完善方案', '检查关键边界']
        : ['整体思路', '具体实现', '验证与交付']
      ).map((text, index) => (
        <li key={text}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          {text}
        </li>
      ))}
    </ol>
  );
}

function LayoutDiagram({ layout, visible }: { layout: FeatureLayout; visible: string[] }) {
  const containsVisible = (node: FeatureLayout['groups'][number]): boolean =>
    'groups' in node
      ? node.groups.some(containsVisible)
      : node.ids.some((id) => visible.includes(id));
  return (
    <div className="preview-split" data-axis={layout.axis}>
      {layout.groups.filter(containsVisible).map((group, index) =>
        'groups' in group ? (
          <div className="preview-split-child" key={index} style={{ flexGrow: group.weight || 1 }}>
            <LayoutDiagram layout={group} visible={visible} />
          </div>
        ) : (
          <PreviewPane
            key={group.ids.join('-')}
            ids={group.ids.filter((id) => visible.includes(id))}
            active={group.active}
            weight={group.weight}
          />
        ),
      )}
    </div>
  );
}
function PreviewPane({ ids, active, weight }: { ids: string[]; active: string; weight: number }) {
  const [selected, setSelected] = useState('');
  const current = ids.includes(selected) ? selected : ids.includes(active) ? active : ids[0];
  if (!current) return null;
  return (
    <div
      className="preview-pane"
      data-preview-part={`pane-${ids.join('-')}`}
      style={{ flexGrow: weight || 1 }}
    >
      <div
        className="preview-pane-tabs"
        role="group"
        aria-label="示意功能标签"
        data-settings-navigation
      >
        {ids.map((id) => (
          <button
            type="button"
            key={id}
            aria-pressed={id === current}
            onClick={() => setSelected(id)}
          >
            {titles[id as FeatureId] || id}
          </button>
        ))}
      </div>
      <MiniContent id={current} />
    </div>
  );
}

function WorkspacePreview({
  features,
  surfaces,
  live,
}: Pick<PreviewProps, 'features' | 'surfaces' | 'live'>) {
  const [target, setTarget] = useState<'main' | 'edge'>('main');
  const placement = features?.mainPlacement || 'sidebar';
  const location = target === 'edge' ? 'edge' : placement;
  const theme = surfaces?.preferences.themes[location];
  const entries = features?.features || [];
  const ids = entries
    .filter((entry) => entry.placement === location && entry.open)
    .map((entry) => entry.id);
  const layout = resolveFeatureLayout(
    features?.layouts?.[location],
    features?.legacyLayouts?.[location],
    ids,
  );
  const edge = surfaces?.preferences.edge;
  const ref = usePreviewMotion(JSON.stringify([location, layout, ids, edge?.edge, edge?.position]));
  const ready = !!features && !!surfaces;
  return (
    <Frame title="你的工作空间" label={!live ? '连接中断 · 末次状态' : '已保存配置 · 示意'}>
      <div className="preview-selector" role="group" aria-label="预览范围" data-settings-navigation>
        <button type="button" aria-pressed={target === 'main'} onClick={() => setTarget('main')}>
          主界面
        </button>
        <button type="button" aria-pressed={target === 'edge'} onClick={() => setTarget('edge')}>
          贴边 / 刘海
        </button>
      </div>
      <div
        ref={ref}
        className="preview-host"
        data-placement={location}
        data-edge={edge?.edge || 'right'}
        data-ready={ready}
        style={
          {
            '--edge-position': `${Math.max(0, Math.min(1, edge?.position ?? 0.5)) * 100}%`,
          } as CSSProperties
        }
      >
        <div className="preview-host-bar">
          <span className="preview-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>ChatGPT</span>
          <Icon name="layout" />
        </div>
        <div className="preview-host-rail" aria-hidden="true">
          <i />
          <i />
          <i />
          <span className="preview-eyes">
            <i />
            <i />
          </span>
        </div>
        <div className="preview-chat" aria-hidden="true">
          <span className="preview-caption">聊天区域</span>
          <div className="preview-message" />
          <i />
          <i />
          <i />
          <div className="preview-composer">
            输入消息…
            <Icon name="turn-start" />
          </div>
        </div>
        <div
          className="preview-workspace"
          data-preview-part="workspace"
          data-material={theme?.theme || 'matte'}
          data-variant={theme?.liquidVariant}
        >
          <div className="preview-workspace-head">
            <strong>CodexBuddy</strong>
            <Icon name={location === 'desktop' ? 'pin' : 'more'} />
          </div>
          {!ready ? (
            <p className="preview-empty">正在读取布局…</p>
          ) : ids.length ? (
            <LayoutDiagram layout={layout} visible={ids} />
          ) : (
            <p className="preview-empty">这里还没有打开的功能</p>
          )}
        </div>
      </div>
      <Facts
        items={[
          ['所在位置', ready ? placements[location] : '读取中'],
          [
            '界面材质',
            theme
              ? `${materials[theme.theme] || theme.theme}${theme.theme === 'native-glass' ? ` · ${theme.liquidVariant === 'clear' ? 'Clear' : 'Regular'}` : ''}`
              : '读取中',
          ],
          ['显示功能', ready ? ids.map((id) => titles[id]).join('、') || '暂无' : '读取中'],
        ]}
      />
      <p className="preview-note">材质效果以实际窗口为准。</p>
    </Frame>
  );
}

function FeaturePreview({ form, tasks, model, view, dirty }: PreviewProps) {
  const [tab, setTab] = useState<'outline' | 'next' | 'board' | 'model'>('next');
  const [selected, setSelected] = useState(0);
  const [demoDraft, setDemoDraft] = useState('');
  const transition = usePreviewTransition(tab);
  const enabled = {
    outline: form?.answerOutlineEnabled,
    next: form?.enabled,
    board: tasks?.store.boardEnabled,
    model: model?.preferences.enabled,
  };
  const groups = tasks?.store.columns || defaultColumns;
  const mode = view?.panelPreferences.ui.promptClickMode || 'fill';
  const clickLabels: Record<string, string> = {
    fill: '仅填入',
    direct: '直接发送',
    hybrid: '单击填入 / 双击发送',
  };
  const examples = ['完善实现方案', '检查边界条件', '补充验证步骤'];
  return (
    <Frame title="功能如何呈现" label={dirty ? '未保存编辑 · 交互示例' : '交互示例'}>
      <div className="preview-selector" role="group" aria-label="功能预览" data-settings-navigation>
        {(['outline', 'next', 'board', 'model'] as const).map((id) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {titles[id]}
          </button>
        ))}
      </div>
      <div className="preview-scenes" ref={transition}>
        {(['outline', 'next', 'board', 'model'] as const).map((scene) => {
          const active = enabled[scene];
          return (
            <div
              key={scene}
              className="preview-scene"
              data-preview-scene={scene}
              data-active={tab === scene}
              aria-hidden={tab !== scene}
              inert={tab !== scene}
            >
              <div className="preview-demo" data-enabled={active !== false}>
                <div className="preview-demo-heading">
                  <strong>{titles[scene]}</strong>
                  <span>{active === undefined ? '读取中' : active ? '已开启' : '已关闭'}</span>
                </div>
                {scene === 'outline' && (
                  <>
                    <div
                      className="preview-outline"
                      role="group"
                      aria-label="大纲定位示例"
                      data-settings-navigation
                    >
                      {['整体思路', '具体实现', '验证与交付'].map((label, index) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={selected === index}
                          onClick={() => setSelected(index)}
                        >
                          <span>0{index + 1}</span>
                          {label}
                          <Icon name="chevron-right" />
                        </button>
                      ))}
                    </div>
                    <div className="preview-answer">
                      <span>示例段落</span>
                      <strong>{['整体思路', '具体实现', '验证与交付'][selected]}</strong>
                      <i />
                      <i />
                      <i />
                    </div>
                  </>
                )}
                {scene === 'next' && (
                  <>
                    <div className="preview-suggestions" data-settings-navigation>
                      {examples
                        .slice(0, Math.max(0, Math.min(3, suggestionLimit(form))))
                        .map((text, index) => (
                          <button type="button" key={text} onClick={() => setDemoDraft(text)}>
                            <span>0{index + 1}</span>
                            <div>
                              <strong>{text}</strong>
                              {!view?.panelPreferences.ui.labelOnly && (
                                <small>
                                  {
                                    [
                                      '把已选方案分解成可执行的步骤。',
                                      '检查输入、异常和兼容情况。',
                                      '用具体场景核对预期行为。',
                                    ][index]
                                  }
                                </small>
                              )}
                            </div>
                            <Icon name="chevron-right" />
                          </button>
                        ))}
                    </div>
                    <div className="preview-quick-prompts" data-settings-navigation>
                      {form?.quickPrompts.map((item, index) => (
                        <button type="button" key={index} onClick={() => setDemoDraft(item.prompt)}>
                          {item.label || '未命名'}
                        </button>
                      ))}
                    </div>
                    <div className="preview-draft" role="status">
                      {demoDraft || '点选建议，查看示例输入效果'}
                    </div>
                  </>
                )}
                {scene === 'board' && (
                  <div className="preview-board">
                    {groups.map((group, index) => (
                      <div key={group.id}>
                        <h3>{group.title}</h3>
                        <div className="preview-task-sample">
                          <i />
                          {['梳理目标', '完善细节', '完成验证'][index % 3]}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {scene === 'model' && (
                  <>
                    <div className="preview-model-name">
                      <span>当前模型</span>
                      <strong>{model?.snapshot?.current?.model || '尚未识别'}</strong>
                      <small>
                        {[model?.snapshot?.current?.reasoning, model?.snapshot?.current?.speed]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </div>
                    <Facts
                      items={[
                        ['常用模型', String(model?.preferences.pinned?.length ?? 0)],
                        ['收藏预设', String(model?.preferences.presets?.length ?? 0)],
                        ['自定义分组', String(model?.preferences.groups?.length ?? 0)],
                      ]}
                    />
                  </>
                )}
              </div>
              {scene === 'next' && (
                <Facts
                  items={[
                    [
                      '生成时机',
                      form?.generationMode === 'auto' ? '回答完成后自动生成' : '手动刷新',
                    ],
                    [
                      '方向来源',
                      { auto: '自动探索', manual: '自选方向', smart: '智能挑选' }[
                        form?.directionSource || 'auto'
                      ],
                    ],
                    ['数量上限', form ? `最多 ${suggestionLimit(form)} 条` : '读取中'],
                    ['实际点击行为', clickLabels[mode] || mode],
                  ]}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="preview-note">示例操作不发送消息或修改任务。</p>
    </Frame>
  );
}

function GenerationPreview({ form, dirty }: PreviewProps) {
  return (
    <Frame title="建议生成路径" label={dirty ? '当前编辑 · 未全部保存' : '当前配置'}>
      <ol className="preview-flow">
        <li>
          <span>01</span>
          <div>
            <strong>最近一问一答</strong>
            <p>
              {form?.maxInputChars === 0
                ? '完整上下文'
                : `最多 ${form?.maxInputChars ?? '—'} 个字符`}
            </p>
          </div>
        </li>
        {form?.directionSource === 'smart' && (
          <li>
            <span>02</span>
            <div>
              <strong>Jev 筛选方向</strong>
              <p>{form.jev.consent ? '已启用独立判断' : '等待启用并同意'}</p>
            </div>
          </li>
        )}
        <li>
          <span>{form?.directionSource === 'smart' ? '03' : '02'}</span>
          <div>
            <strong>{form?.model || '尚未配置模型'}</strong>
            <p>{form?.provider === 'codex' ? 'Codex 登录' : form?.protocol || '—'}</p>
          </div>
        </li>
        <li>
          <span>{form?.directionSource === 'smart' ? '04' : '03'}</span>
          <div>
            <strong>下一步建议</strong>
            <p>最多 {form ? suggestionLimit(form) : '—'} 条 · 允许返回更少</p>
          </div>
        </li>
      </ol>
      <Facts
        items={[
          ['输出上限', `${form?.maxOutputTokens ?? '—'} tokens`],
          ['请求超时', `${form ? form.timeoutMs / 1000 : '—'} 秒`],
        ]}
      />
    </Frame>
  );
}
function ConnectionPreview({ view, live, form }: PreviewProps) {
  const status = view?.connection.status;
  const connected = live && status === 'connected';
  return (
    <Frame title="连接状态" label="实时回读">
      <div className="preview-connection" data-connected={connected}>
        <Icon name="connection" />
        <strong>
          {connected
            ? '连接已就绪'
            : !live
              ? '本地服务未连接'
              : status === 'unresponsive'
                ? '页面暂未响应'
                : '等待桌面连接'}
        </strong>
        <span>CodexBuddy → ChatGPT</span>
      </div>
      <Facts
        items={[
          ['本地服务', live ? '可用' : '未连接'],
          ['桌面页面', connected ? '已连接' : status === 'unresponsive' ? '暂未响应' : '未连接'],
          ['启动行为', form?.hostRestartPolicy === 'force' ? '直接强制重开' : '询问后正常重开'],
          ['版本', view?.version || '—'],
        ]}
      />
    </Frame>
  );
}

export function SettingsPreview(props: PreviewProps) {
  const workspace = props.mode === 'simple' || props.page === 'surfaces';
  return (
    <aside
      className="settings-preview"
      aria-label="联动预览"
      data-preview-kind={workspace ? 'workspace' : props.page}
    >
      {workspace ? (
        <WorkspacePreview features={props.features} surfaces={props.surfaces} live={props.live} />
      ) : props.page === 'features' ? (
        <FeaturePreview {...props} />
      ) : props.page === 'model' ? (
        <GenerationPreview {...props} />
      ) : (
        <ConnectionPreview {...props} />
      )}
    </aside>
  );
}
