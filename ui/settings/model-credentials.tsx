/* [INPUT]: Shared credential draft, saved-key metadata and revision-checked deletion queue.
 * [OUTPUT]: Shared API/Jev configured/replacement fields and explicitly confirmed, revision-checked deletion.
 * [POS]: Settings presentation; never reads stored secret values or stages deletion in autosave drafts.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Field } from './settings-controls';
import { Icon } from '../shared/icons/react';
import { ConfirmationButton } from './settings-confirmation';
import type { SettingsEditor } from './use-settings-form';

type KeyProps = { editor: SettingsEditor; busy: boolean; kind?: 'api' | 'jev' };
export function ModelApiKey({ editor, busy, kind = 'api' }: KeyProps) {
  const { saved } = editor;
  const jev = kind === 'jev';
  const apiKey = jev ? editor.jevApiKey : editor.apiKey;
  const setApiKey = jev ? editor.setJevApiKey : editor.setApiKey;
  const setClearKey = jev ? editor.setClearJevKey : editor.setClearKey;
  const stored = jev ? saved?.storedJevApiKey : saved?.storedApiKey;
  const configured = jev
    ? saved?.jevKeyConfigured
    : saved?.provider === 'api' && saved.apiKeyConfigured;
  const id = jev ? 'jev-key' : 'api-key';
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const savedRevision = useRef(saved?.configurationRevision);
  useEffect(() => {
    if (!apiKey) setVisible(false);
    if (savedRevision.current !== saved?.configurationRevision && stored && !apiKey)
      setEditing(false);
    savedRevision.current = saved?.configurationRevision;
  }, [saved, apiKey, stored]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const showInput = !stored || editing || !!apiKey;
  return (
    <Field
      id={id}
      label={jev ? 'Jev API 密钥' : 'API 密钥'}
      hint={
        !stored && configured ? '当前使用后台环境变量中的密钥；此处填写仅作为备用。' : undefined
      }
    >
      {!showInput ? (
        <div className="flex min-h-[38px] items-center justify-between gap-3">
          <span role="status">密钥已配置</span>
          <Button
            id={id}
            aria-label={jev ? '更换 Jev 密钥' : '更换密钥'}
            type="button"
            variant="outline"
            data-settings-navigation
            disabled={busy || editor.saving || editor.remoteChanged}
            onClick={() => setEditing(true)}
          >
            更换密钥
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <Input
              ref={input}
              id={id}
              type={visible ? 'text' : 'password'}
              value={apiKey}
              className={apiKey ? 'pr-[43px]' : undefined}
              onChange={(event) => {
                setApiKey(event.target.value);
                setClearKey(false, false);
              }}
              placeholder={stored ? '输入新密钥，留空保留原密钥' : '输入 API 密钥'}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            {!!apiKey && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1"
                data-settings-navigation
                aria-label={visible ? '隐藏新密钥' : '显示新密钥'}
                onClick={() => setVisible(!visible)}
              >
                <Icon name={visible ? 'eye-off' : 'eye'} />
              </Button>
            )}
          </div>
          {stored && (
            <Button
              type="button"
              variant="ghost"
              data-settings-navigation
              disabled={busy || editor.saving}
              onClick={() => {
                setApiKey('');
                setClearKey(false, false);
                setVisible(false);
                setEditing(false);
              }}
            >
              取消更换
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}

export function DeleteModelApiKey({ editor, busy, kind = 'api' }: KeyProps) {
  const jev = kind === 'jev';
  const stored = jev ? editor.saved?.storedJevApiKey : editor.saved?.storedApiKey;
  const draft = jev ? editor.jevApiKey : editor.apiKey;
  const revision = editor.saved?.configurationRevision;
  if (!stored || revision === undefined) return null;
  return (
    <ConfirmationButton
      variant="outline"
      disabled={busy || editor.saving || editor.remoteChanged}
      confirmDisabled={!!draft}
      revision={revision}
      title={jev ? '删除已保存的 Jev 密钥？' : '删除已保存的 API 密钥？'}
      description={
        draft
          ? '请先保存或取消新密钥，再删除已保存的密钥。'
          : `删除后可能无法${jev ? '使用智能挑选' : '调用模型'}，需要重新填写密钥。此操作不会修改环境变量。`
      }
      confirmLabel="确认删除"
      onConfirm={() => editor.removeApiKey(revision, kind)}
    >
      {jev ? '删除已保存的 Jev 密钥' : '删除已保存的密钥'}
    </ConfirmationButton>
  );
}
