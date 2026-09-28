/* [INPUT]: 现有设置表单、认证 API 与共用设置控件。
 * [OUTPUT]: 按职责组织的设置内容，保留自动保存与错误反馈。
 * [POS]: 设置展示层，不执行后台业务或读取聊天正文。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/tokens.css';
import './styles.css';
import icon from '../icon.png';
import { request, useCompanion, type Settings, type EditableSettings } from './api';
import { useSettingsForm } from './use-settings-form';
import { SettingsOutline, useSettingsPage, pageTitles } from './settings-outline';
import { SettingsForm, FeatureSwitch, Feedback } from './settings-controls';
import { TaskSettings } from './task-settings';
import { ModelControlSettings } from './model-control-settings';
import { SurfaceSettings } from './surface-settings';
import { NextSettings } from './next-settings';
import { SettingsOverview } from './settings-overview';
import { ConnectionSettings } from './connection-settings';
function editable(value: Settings): EditableSettings {
  const {
    enabled,
    answerOutlineEnabled,
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
  const [notice, setNotice] = useState({ text: '', failed: false });
  const notify = (text: string, failed = false) => setNotice({ text, failed });
  const editor = useSettingsForm(live, view?.configurationRevision, editable, notify);
  const { page, dev, navigate } = useSettingsPage(!!editor.form);
  useEffect(() => {
    setNotice((current) => (current.failed ? current : { text: '', failed: false }));
  }, [page]);
  const connected = live && view?.connection.status === 'connected';
  return (
    <div className="settings-app">
      <header className="settings-header">
        <a href="#settings-overview" className="flex items-center gap-3 font-semibold">
          <img src={icon} alt="" className="size-9 rounded-xl" />
          CodexBuddy{import.meta.env.DEV ? ' · 开发版' : ''}
        </a>
        <span className="text-sm text-muted-foreground">
          {connected ? 'Codex 已连接' : live ? '等待连接' : '服务未连接'}
        </span>
      </header>
      <div className="settings-layout">
        <SettingsOutline page={page} dev={dev} navigate={navigate} />
        <main className="min-w-0">
          <h1 className="settings-title">{pageTitles[page]}</h1>
          {error && <Feedback text={error} failed />}
          {page !== 'overview' && !editor.form && !error && !notice.failed && (
            <p role="status">正在读取设置…</p>
          )}
          <Feedback text={notice.text} failed={notice.failed} />
          <div hidden={page !== 'overview'}>
            <SettingsOverview active={page === 'overview'} live={live} view={view} />
          </div>
          <SettingsForm
            editor={editor}
            notify={notify}
            active={['outline', 'next', 'connection'].includes(page)}
          >
            <div hidden={page !== 'outline'}>
              <FeatureSwitch
                name="大纲"
                checked={editor.form?.answerOutlineEnabled ?? false}
                disabled={!live || !editor.form}
                onChange={(v) => editor.change('answerOutlineEnabled', v)}
                onOpen={() =>
                  void request('features', { op: 'reveal', id: 'outline' }).catch((e) =>
                    notify(e.message, true),
                  )
                }
              />
            </div>
            <div hidden={page !== 'next'}>
              <NextSettings editor={editor} appearance={view?.panelPreferences} notify={notify} />
            </div>
            <div hidden={page !== 'connection'}>
              <ConnectionSettings editor={editor} view={view} live={live} notify={notify} />
            </div>
          </SettingsForm>
          <div hidden={page !== 'board'}>
            <TaskSettings />
          </div>
          <div hidden={page !== 'model'}>
            <ModelControlSettings live={live} />
          </div>
          <div hidden={page !== 'surfaces'}>
            <SurfaceSettings
              live={live}
              desktopSupported={editor.saved?.popoutSupported === true}
              appearance={view?.panelPreferences}
              fontBase={view?.panelFontBase}
            />
          </div>
          <div hidden={page !== 'dev'} id="settings-dev-content" />
          <footer className="settings-footer">CodexBuddy {view?.version || '—'}</footer>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
