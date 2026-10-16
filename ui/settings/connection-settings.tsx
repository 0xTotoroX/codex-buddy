/* [INPUT]: 现有设置表单、认证 API 与共用设置控件。
 * [OUTPUT]: 启动策略、本机连接与显式重连/断开；Dev 保留固定目标。
 * [POS]: 设置展示层，不执行后台业务或读取聊天正文。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useState, useEffect } from 'react';
import { ConfirmationButton, useConfirmation } from './settings-confirmation';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import { NativeSelect } from './components/ui/native-select';
import { Field } from './settings-controls';
import { request, type View } from './api';
import type { SettingsEditor } from './use-settings-form';
import { Icon } from '../shared/icons/react';
export function ConnectionSettings({
  editor,
  view,
  live,
  notify,
}: {
  editor: SettingsEditor;
  view: View | null;
  live: boolean;
  notify: (text: string, failed?: boolean) => void;
}) {
  const { form, change } = editor;
  const { confirm, confirmation } = useConfirmation(
    editor.saved?.configurationRevision,
    editor.saving || editor.remoteChanged,
  );
  const [endpoint, setEndpoint] = useState(''),
    [targetId, setTargetId] = useState(''),
    [connectionEdited, setConnectionEdited] = useState(false),
    [busy, setBusy] = useState('');
  const connected = live && ['connected', 'unresponsive'].includes(view?.connection.status || '');
  useEffect(() => {
    if (!connectionEdited && view?.connection.endpoint) {
      setEndpoint(view.connection.endpoint);
      setTargetId(view.connection.targetId || '');
    }
  }, [view?.connection.endpoint, view?.connection.targetId, connectionEdited]);
  async function run(name: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(name);
    try {
      await action();
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      throw e;
    } finally {
      setBusy('');
    }
  }
  async function connect() {
    await request('connect', { endpoint, targetId: targetId || null });
    setConnectionEdited(false);
    notify('已连接 Codex');
  }
  return (
    <>
      {confirmation}
      {form && (
        <>
          <Card tabIndex={-1} id="settings-startup" aria-labelledby="startup-title">
            <h2 id="startup-title" className="mb-5 text-[15px] font-semibold">
              启动行为
            </h2>
            <Field
              id="host-restart-policy"
              label="ChatGPT 已打开，但没有调试连接时"
              hint={
                form.hostRestartPolicy === 'force'
                  ? '强制重开可能中断任务或丢失未保存内容。'
                  : undefined
              }
            >
              <NativeSelect
                id="host-restart-policy"
                value={form.hostRestartPolicy}
                onChange={(e) => {
                  if (e.target.value === 'force') {
                    e.stopPropagation();
                    confirm({
                      title: '允许直接强制重开？',
                      description:
                        '以后无法连接已打开的 Codex 时，将不再询问而直接强制退出，可能中断任务或丢失未保存内容。',
                      confirmLabel: '确认启用',
                      action: () => {
                        change('hostRestartPolicy', 'force');
                        return editor.save();
                      },
                    });
                  } else change('hostRestartPolicy', 'ask');
                }}
              >
                <option value="ask">询问后正常重开</option>
                <option value="force">直接强制重开</option>
              </NativeSelect>
            </Field>
          </Card>
        </>
      )}
      <Card tabIndex={-1} id="settings-connection" aria-labelledby="connection-title">
        <h2 id="connection-title">桌面连接</h2>
        {!connected && view?.connection.message && (
          <p role="status" className="settings-hint">
            {view.connection.message}
          </p>
        )}
        <div className="settings-details">
          <Field id="cdp-endpoint" label="本机调试端口">
            <Input
              id="cdp-endpoint"
              readOnly={import.meta.env.DEV}
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value);
                setTargetId('');
                setConnectionEdited(true);
              }}
              placeholder="9229 或 http://127.0.0.1:9229"
              spellCheck={false}
            />
          </Field>
          {(view?.connection.targets.length || 0) > 1 && (
            <Field id="target" label="Codex 窗口">
              <NativeSelect
                id="target"
                disabled={import.meta.env.DEV}
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setConnectionEdited(true);
                }}
              >
                <option value="">自动选择</option>
                {view?.connection.targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={!live || !!busy}
            onClick={() => void run('connect', connect).catch(() => {})}
          >
            {busy === 'connect' ? (
              <Icon name="refresh" className="animate-spin [animation-duration:1.2s]" />
            ) : (
              <Icon name="connection" />
            )}
            {connected ? '重新连接' : '连接 Codex'}
          </Button>
          {connected && (
            <ConfirmationButton
              type="button"
              variant="ghost"
              className="min-h-0 p-2"
              disabled={!!busy}
              title="断开与 Codex 的连接？"
              description="Buddy 将暂时停止跟随当前聊天，并移除桌面浮窗。已有配置保持不变，可随时重新连接。"
              confirmLabel="确认断开"
              onConfirm={() =>
                run('disconnect', async () => {
                  await request('disconnect', {});
                  notify('连接已断开，桌面浮窗已移除。');
                })
              }
            >
              断开
            </ConfirmationButton>
          )}
        </div>
        {!import.meta.env.DEV && !connected && (
          <div className="mt-6 text-sm text-muted-foreground [&>button]:mt-3 [&>button]:w-full [&>button]:justify-between [&_code]:font-mono [&_code]:text-sm">
            <span>首次接入：等待任务结束并完整退出 ChatGPT，再在终端运行</span>
            <Button
              type="button"
              variant="outline"
              aria-label="复制启动命令"
              onClick={() =>
                void run('copy', async () => {
                  await navigator.clipboard.writeText('codex-buddy launch --restart-running');
                  notify('已复制启动命令；将按启动行为设置处理已打开的 ChatGPT。');
                }).catch(() => {})
              }
            >
              <code>codex-buddy launch</code>
              <Icon name="chevron-right" />
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
