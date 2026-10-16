/* [INPUT]: Shared credential draft, saved-key metadata and revision-checked deletion queue.
 * [OUTPUT]: Configured/replacement key field and an advanced, explicitly confirmed delete action.
 * [POS]: Settings presentation; never reads stored secret values or stages deletion in autosave drafts.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Field } from './settings-controls';
import { Icon } from '../shared/icons/react';
import type { SettingsEditor } from './use-settings-form';

export function ModelApiKey({ editor, busy }: { editor: SettingsEditor; busy: boolean }) {
  const { saved, apiKey, setApiKey, setClearKey } = editor;
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const savedRevision = useRef(saved?.configurationRevision);
  useEffect(() => {
    if (!apiKey) setVisible(false);
    if (savedRevision.current !== saved?.configurationRevision && saved?.storedApiKey && !apiKey)
      setEditing(false);
    savedRevision.current = saved?.configurationRevision;
  }, [saved, apiKey]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const showInput = !saved?.storedApiKey || editing || !!apiKey;
  return (
    <Field id="api-key" label="API 密钥">
      {!showInput ? (
        <div className="flex min-h-[38px] items-center justify-between gap-3">
          <span role="status">密钥已配置</span>
          <Button
            id="api-key"
            aria-label="更换密钥"
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
              id="api-key"
              type={visible ? 'text' : 'password'}
              value={apiKey}
              className={apiKey ? 'pr-[43px]' : undefined}
              onChange={(event) => {
                setApiKey(event.target.value);
                setClearKey(false, false);
              }}
              placeholder={saved?.storedApiKey ? '输入新密钥，留空保留原密钥' : '输入 API 密钥'}
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
          {saved?.storedApiKey && (
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

export function DeleteModelApiKey({ editor, busy }: { editor: SettingsEditor; busy: boolean }) {
  const [revision, setRevision] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (revision !== null && !node?.open) node?.showModal();
    if (revision === null && node?.open) node.close();
  }, [revision]);
  async function remove() {
    if (revision === null || deleting) return;
    setDeleting(true);
    setError('');
    try {
      await editor.removeApiKey(revision);
      setRevision(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      {editor.saved?.storedApiKey && (
        <Button
          type="button"
          variant="outline"
          data-settings-navigation
          disabled={busy || editor.saving || editor.remoteChanged}
          onClick={() => {
            setError('');
            setRevision(editor.saved!.configurationRevision);
          }}
        >
          删除已保存的密钥
        </Button>
      )}
      <dialog
        ref={dialog}
        className="settings-key-dialog"
        aria-labelledby="delete-key-title"
        aria-describedby="delete-key-description"
        onCancel={(event) => {
          if (deleting) event.preventDefault();
          else setRevision(null);
        }}
        onClose={() => setRevision(null)}
      >
        <h3 id="delete-key-title">删除已保存的 API 密钥？</h3>
        <p id="delete-key-description" className="mt-3 text-sm text-muted-foreground">
          删除后可能无法调用模型，需要重新填写密钥。此操作不会修改环境变量。
        </p>
        {!!editor.apiKey && (
          <p role="status" className="mt-3 text-sm">
            请先保存或取消新密钥，再删除已保存的密钥。
          </p>
        )}
        {error && (
          <p role="alert" className="settings-error mt-3 text-sm">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            autoFocus
            data-settings-navigation
            disabled={deleting}
            onClick={() => setRevision(null)}
          >
            取消
          </Button>
          <Button
            type="button"
            data-settings-navigation
            disabled={deleting || editor.saving || editor.remoteChanged || !!editor.apiKey}
            onClick={() => void remove()}
          >
            {deleting ? '正在删除…' : '确认删除'}
          </Button>
        </div>
      </dialog>
    </>
  );
}
