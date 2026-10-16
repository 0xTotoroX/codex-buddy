/* [INPUT]: 现有设置表单、认证 API 与共用设置控件。
 * [OUTPUT]: 常规配置直接显示的 Tom Modern 双模式设置、紧凑头部与常驻分类导航、主题/字体及联动预览，保留保存与错误反馈。
 * [POS]: 设置展示层，不执行后台业务或读取聊天正文。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useTypography } from './use-typography';
import { StrictMode, useEffect, useState } from 'react';
import { TerminologySettings } from './terminology-settings';
import { createRoot } from 'react-dom/client';
import '../shared/tokens.css';
import './styles.css';
import './settings-layout.css';
import './settings-preview.css';
import './settings-controls.css';
import './settings-motion.css';
import icon from '../icon.png';
import { useCompanion, type Settings, type EditableSettings } from './api';
import { useSettingsForm } from './use-settings-form';
import { SettingsOutline, useSettingsPage, pageTitles } from './settings-outline';
import { SettingsForm, FeatureSwitch, Feedback } from './settings-controls';
import { TaskSettings } from './task-settings';
import { ModelControlSettings } from './model-control-settings';
import { SurfaceSettings } from './surface-settings';
import { NextSettings } from './next-settings';
import { LauncherSettings } from './launcher-settings';
import { ModelSettings } from './model-settings';
import { useTasks } from '../features/board/api';
import { Field } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';
import { ConnectionSettings } from './connection-settings';
import { CodexHostSettings } from './codex-host-settings';
import { SettingsSearch } from './settings-search';
import { SettingsPreview } from './settings-preview';
import { useSettingsMotion } from './settings-motion';
import { SettingsTheme } from './settings-theme';
import type { FeatureState } from '../shared/features';
import type { SurfaceState } from './surface-settings';
import type { ModelState } from '../features/model/catalog';
function editable(value: Settings): EditableSettings {
  const {
    enabled,
    answerOutlineEnabled,
    promptEnhancementEnabled,
    generationMode,
    hostRestartPolicy,
    provider,
    protocol,
    model,
    baseUrl,
    apiKeyEnv,
    maxItems,
    directionSource,
    directionLibrary,
    selectedDirections,
    jev,
    quickPrompts,
    maxInputChars,
    maxOutputTokens,
    timeoutMs,
  } = value;
  return {
    enabled,
    answerOutlineEnabled,
    promptEnhancementEnabled,
    generationMode,
    hostRestartPolicy,
    provider,
    protocol,
    model,
    baseUrl,
    apiKeyEnv,
    maxItems,
    directionSource,
    directionLibrary,
    selectedDirections,
    jev,
    quickPrompts,
    maxInputChars,
    maxOutputTokens,
    timeoutMs,
  };
}

function App() {
  const { view, live, error } = useCompanion();
  useTypography(view?.panelTypography, view?.panelPreferences.typography);
  const [notice, setNotice] = useState({ text: '', failed: false });
  const notify = (text: string, failed = false) => setNotice({ text, failed });
  const editor = useSettingsForm(live, view?.configurationRevision, editable, notify);
  const { page, mode, dev, navigate, switchMode } = useSettingsPage(!!editor.form);
  const [features, setFeatures] = useState<FeatureState | null>(null);
  const [surfaces, setSurfaces] = useState<SurfaceState | null>(null);
  const [model, setModel] = useState<ModelState | null>(null);
  const contentRef = useSettingsMotion(`${mode}:${page}`);
  const tasks = useTasks(live);
  const simple = mode === 'simple';
  const featuresVisible = simple || page === 'features';
  const surfacesVisible = simple || page === 'surfaces';
  useEffect(() => {
    setNotice((current) => (current.failed ? current : { text: '', failed: false }));
  }, [page]);
  const connected = live && view?.connection.status === 'connected';
  return (
    <div className="settings-app" data-settings-mode={mode} data-settings-category={page}>
      <header className="settings-header">
        <div className="settings-topline">
          <a href="#settings-simple" className="settings-brand" data-settings-navigation>
            <img src={icon} alt="" />
            CodexBuddy{' '}
            <span className="settings-edition">{import.meta.env.DEV ? '开发版' : '设置'}</span>
          </a>
          <SettingsSearch navigate={navigate} />
          <div className="settings-header-actions">
            <SettingsTheme codexTheme={view?.panelTheme} />
            <div
              className="settings-mode"
              role="group"
              aria-label="设置显示模式"
              data-settings-navigation
            >
              <button type="button" aria-pressed={simple} onClick={() => switchMode('simple')}>
                简易
              </button>
              <button
                type="button"
                aria-label="详细设置"
                aria-pressed={!simple}
                onClick={() => switchMode('detail')}
              >
                详细
              </button>
            </div>
            <span
              className="settings-connection-status"
              data-connected={connected}
              role="status"
              aria-label={connected ? '已连接' : undefined}
            >
              {!connected &&
                (view?.connection.status === 'unresponsive'
                  ? '页面暂未响应'
                  : live
                    ? '等待连接'
                    : '未连接')}
            </span>
          </div>
        </div>
        <SettingsOutline page={page} mode={mode} dev={dev} navigate={navigate} />
      </header>
      <div className="settings-layout">
        <main className="settings-content min-w-0" ref={contentRef}>
          <div className="settings-page-heading">
            <h1 className="settings-title">{simple ? '设置' : pageTitles[page]}</h1>
          </div>
          <Feedback text={error} failed />
          {!editor.form && !error && <p role="status">正在读取设置…</p>}
          <Feedback text={notice.text} failed={notice.failed} />
          <div className="settings-body">
            <div className="settings-form-column">
              <section
                hidden={!featuresVisible}
                data-settings-page="features"
                className="settings-section settings-feature-list"
                aria-label="常用功能"
              >
                <h2>常用功能</h2>
                <div id="settings-outline">
                  <FeatureSwitch
                    name="大纲"
                    checked={editor.form?.answerOutlineEnabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(v) => editor.change('answerOutlineEnabled', v)}
                  />
                </div>
                <FeatureSwitch
                  name="下一步"
                  checked={editor.form?.enabled ?? false}
                  disabled={!live || !editor.form}
                  onChange={(v) => editor.change('enabled', v)}
                />
                <FeatureSwitch
                  name="看板"
                  checked={tasks.state?.store.boardEnabled ?? false}
                  disabled={tasks.busy || !tasks.state || !!tasks.state.error}
                  onChange={(boardEnabled) => void tasks.command({ op: 'modules', boardEnabled })}
                />
                <ModelControlSettings live={live} detailed={!simple} onSnapshot={setModel} />
                <div id="settings-prompt-enhancement">
                  <FeatureSwitch
                    name="提示词优化"
                    checked={editor.form?.promptEnhancementEnabled ?? true}
                    disabled={!live || !editor.form}
                    onChange={(value) => editor.change('promptEnhancementEnabled', value)}
                  />
                </div>
                <div hidden={!editor.form?.enabled}>
                  <Field id="generation-mode" label="建议生成方式">
                    <NativeSelect
                      id="generation-mode"
                      disabled={!editor.form}
                      value={editor.form?.generationMode ?? 'manual'}
                      onChange={(event) =>
                        editor.change('generationMode', event.target.value as 'auto' | 'manual')
                      }
                    >
                      <option value="manual">手动刷新</option>
                      <option value="auto">自动生成</option>
                    </NativeSelect>
                  </Field>
                </div>
              </section>
              <section
                data-settings-page="surfaces"
                hidden={!surfacesVisible}
                className="settings-section settings-common-surface"
              >
                <h2 hidden={!simple}>界面与操作</h2>
                <SurfaceSettings
                  live={live}
                  desktopSupported={editor.saved?.popoutSupported === true}
                  appearance={view?.panelPreferences}
                  fontBase={view?.panelFontBase}
                  simple={simple}
                  onFeatures={setFeatures}
                  onSnapshot={setSurfaces}
                />
                <LauncherSettings
                  value={view?.panelPreferences}
                  outsideAvailable={editor.saved?.popoutSupported === true}
                />
              </section>
              <div data-settings-page="features" hidden={simple || page !== 'features'}>
                <TerminologySettings active={!simple && page === 'features'} />
              </div>
              <SettingsForm
                editor={editor}
                notify={notify}
                active={simple || page === 'model' || page === 'features' || page === 'connection'}
              >
                <div data-settings-page="features" hidden={simple || page !== 'features'}>
                  <NextSettings editor={editor} appearance={view?.panelPreferences} />
                </div>
                <div data-settings-page="model" hidden={!simple && page !== 'model'}>
                  <h2 className="settings-simple-model-title" hidden={!simple}>
                    生成模型
                  </h2>
                  <ModelSettings editor={editor} simple={simple} />
                </div>
                <div data-settings-page="connection" hidden={simple || page !== 'connection'}>
                  <ConnectionSettings editor={editor} view={view} live={live} notify={notify} />
                </div>
              </SettingsForm>
              <div data-settings-page="features" hidden={simple || page !== 'features'}>
                <TaskSettings tasks={tasks} />
              </div>
              <div data-settings-page="connection" hidden={simple || page !== 'connection'}>
                <CodexHostSettings live={live} active={!simple && page === 'connection'} />
              </div>
              <section
                data-settings-page="connection"
                hidden={simple || page !== 'connection' || !dev}
                className="settings-section"
              >
                <h2>开发来源</h2>
                <div id="settings-dev-content" />
              </section>
            </div>
            <SettingsPreview
              mode={mode}
              page={page}
              form={editor.form}
              dirty={editor.dirty}
              features={features}
              surfaces={surfaces}
              model={model}
              tasks={tasks.state}
              view={view}
              live={live}
            />
          </div>
        </main>
      </div>
      <footer className="settings-footer">
        <span>CodexBuddy {view?.version || '—'}</span>
      </footer>
    </div>
  );
}
// A Vite dependency update can re-evaluate this entry without replacing its container.
const root: ReturnType<typeof createRoot> =
  import.meta.hot?.data.root || createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
