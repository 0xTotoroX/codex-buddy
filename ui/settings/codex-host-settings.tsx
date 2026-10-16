/* [INPUT]: 认证 CodexHost API。 [OUTPUT]: CodexHost 独立开关、运行状态、版本更新及显式重启停用。
 * [POS]: 设置展示，不管理进程或复制其他功能配置；只在此分类可见时轮询。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { SettingsDrawer } from './settings-drawer';
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Toggle, Feedback } from './settings-controls';
import { ConfirmationButton } from './settings-confirmation';
import { Button } from './components/ui/button';
import type { CodexHostStatus } from '../shared/codex-host';
const labels: Record<CodexHostStatus['state'], string> = {
  disabled: '已关闭',
  notInstalled: '尚未安装',
  pendingEnable: '待启动启用',
  pendingDisable: '待重启停用',
  pendingUpdate: '所选安装待重启生效',
  running: '运行中',
  error: '状态异常',
};
export function CodexHostSettings({ live, active }: { live: boolean; active: boolean }) {
  const [state, setState] = useState<CodexHostStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const writing = useRef(false),
    generation = useRef(0);
  const restarting = ['queued', 'confirming', 'restarting'].includes(state?.restart?.state || '');
  const disabled = !live || busy || restarting;
  useEffect(() => {
    if (!live || !active) return;
    let disposed = false;
    const load = async () => {
      if (writing.current) return;
      const current = ++generation.current;
      try {
        const result = await request<CodexHostStatus>('codex-host');
        if (!disposed && current === generation.current) {
          setState(result);
        }
      } catch (e) {
        if (!disposed && current === generation.current) setError(String(e));
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    window.addEventListener('focus', load);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [live, active]);
  async function command(op: string, data: Record<string, unknown> = {}) {
    if (writing.current || restarting || !state) return false;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      if (op === 'check-update') {
        const result = await request<{ version: string }>('codex-host', { op, id: 'codex-host' });
        setLatest(result.version);
      } else
        setState(
          await request<CodexHostStatus>('codex-host', {
            op,
            id: 'codex-host',
            expectedRevision: state.revision,
            ...data,
          }),
        );
      return true;
    } catch (e) {
      setError(String(e));
      if (op === 'restore' || op === 'restart-disabled') throw e;
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const target = latest || state?.baseline;
  const newer =
    target &&
    (!state?.version ||
      target
        .split('.')
        .map(Number)
        .some(
          (n, i, parts) =>
            parts.slice(0, i).every((v, j) => v === Number(state.version?.split('.')[j])) &&
            n > Number(state.version?.split('.')[i]),
        ));
  return (
    <section
      className="settings-section space-y-6"
      aria-label="CodexHost 设置"
      id="settings-codex-host"
    >
      <h2>CodexHost</h2>
      <Toggle
        label="启用 CodexHost"
        checked={state?.enabled ?? false}
        disabled={disabled || !state}
        onChange={(enabled) => void command('set-enabled', { enabled })}
      />
      <Feedback text={error || state?.error || ''} failed />
      {state?.restart && (
        <Feedback text={state.restart.message} failed={state.restart.state === 'failed'} />
      )}
      {state && (
        <>
          <dl className="space-y-4">
            <div className="settings-row">
              <dt>状态</dt>
              <dd>{labels[state.state]}</dd>
            </div>
            <div className="settings-row">
              <dt>已安装版本</dt>
              <dd>{state.version || '未安装'}</dd>
            </div>
            {state.runningVersion && (
              <div className="settings-row">
                <dt>实际运行版本</dt>
                <dd>{state.runningVersion}</dd>
              </div>
            )}
          </dl>
          {state.executable && (
            <SettingsDrawer title="程序路径">
              <dl className="space-y-4">
                {state.executable && (
                  <div className="space-y-2">
                    <dt>启动路径</dt>
                    <dd className="break-all select-text">{state.executable}</dd>
                  </div>
                )}
                {state.runningExecutable && state.runningExecutable !== state.executable && (
                  <div className="space-y-2">
                    <dt>运行路径</dt>
                    <dd className="break-all select-text">{state.runningExecutable}</dd>
                  </div>
                )}
              </dl>
            </SettingsDrawer>
          )}
          {state.state === 'pendingEnable' && (
            <p>需要重开 Codex 才能启用时，请先结束任务，再打开 Buddy。</p>
          )}
          <div className="flex flex-wrap gap-3">
            {state.state === 'pendingDisable' && (
              <ConfirmationButton
                disabled={disabled}
                revision={state.revision}
                title="重启 Codex 并停用 CodexHost？"
                description="Codex 将退出并重新打开，正在运行的任务可能中断。请先保存内容并结束任务。"
                confirmLabel="确认重启"
                onConfirm={() => command('restart-disabled')}
              >
                {restarting ? '正在重启…' : '重启 Codex 并停用'}
              </ConfirmationButton>
            )}
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void command('check-update')}
            >
              检查更新
            </Button>
            {target && newer && (
              <Button
                disabled={disabled}
                onClick={() => void command('install', { version: target })}
              >
                {busy ? '处理中…' : `${state.version ? '更新到' : '安装'} ${target}`}
              </Button>
            )}
            {state.enabled && ['pendingEnable'].includes(state.state) && (
              <Button variant="outline" disabled={disabled} onClick={() => void command('start')}>
                启动
              </Button>
            )}
            {state.canRestore && (
              <ConfirmationButton
                variant="ghost"
                disabled={disabled}
                revision={state.revision}
                title="恢复 CodexHost 上一版本？"
                description="将切换回先前安装的版本，当前会话可能需要重新启动才能使用。已有配置保持不变。"
                confirmLabel="确认恢复"
                onConfirm={() => command('restore')}
              >
                恢复上一版本
              </ConfirmationButton>
            )}
          </div>
          {latest === state.version && <p role="status">已是最新版本</p>}
        </>
      )}
    </section>
  );
}
