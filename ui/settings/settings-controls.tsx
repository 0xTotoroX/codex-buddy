/* [INPUT]: 现有基础控件和设置保存队列。
 * [OUTPUT]: 统一设置行、功能开关/唤起、反馈及表单保存状态。
 * [POS]: 设置页组合组件，不持有业务数据或新增保存服务。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useId, type ReactNode } from 'react';
import { Button } from './components/ui/button';
import { Switch } from './components/ui/switch';
import { request, type Settings } from './api';
import type { SettingsEditor } from './use-settings-form';
export function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <div className="min-w-0">
        {children}
        {hint && <p className="settings-hint">{hint}</p>}
      </div>
    </div>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}
export function FeatureSwitch({
  name,
  checked,
  disabled,
  onChange,
  onOpen,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  onOpen: () => void;
}) {
  const id = useId();
  return (
    <div className="settings-row settings-feature-switch">
      <label htmlFor={id}>启用{name}</label>
      <div className="flex shrink-0 items-center gap-4">
        <Button type="button" variant="ghost" disabled={disabled || !checked} onClick={onOpen}>
          打开{name}
        </Button>
        <Switch
          id={id}
          aria-label={`启用${name}`}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </div>
    </div>
  );
}
export function Feedback({ text, failed = false }: { text?: string; failed?: boolean }) {
  return text ? (
    <p
      className={failed ? 'settings-feedback settings-error' : 'settings-feedback'}
      role={failed ? 'alert' : 'status'}
    >
      {text}
    </p>
  ) : null;
}
export function SettingsForm({
  editor,
  notify,
  children,
  active,
}: {
  editor: SettingsEditor;
  notify: (text: string, failed?: boolean) => void;
  children: ReactNode;
  active: boolean;
}) {
  const { dirty, saving, remoteChanged, save, schedule, load } = editor;
  return (
    <form
      onBlurCapture={(e) => {
        if (!(
          e.relatedTarget instanceof Element && e.relatedTarget.closest('button[type="submit"]')
        ))
          schedule(e.currentTarget);
      }}
      onChange={(e) => {
        if (e.target instanceof HTMLSelectElement) schedule(e.currentTarget);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void save().catch((e) => notify(e.message, true));
      }}
    >
      {children}
      <div hidden={!active || !editor.form}>
        {remoteChanged && (
          <div className="settings-feedback settings-error" role="alert">
            设置已在其他窗口更新，当前编辑已保留。
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                void request<Settings>('settings')
                  .then(load)
                  .catch((e) => notify(e.message, true))
              }
            >
              重新载入设置
            </Button>
          </div>
        )}
        <div className="settings-save">
          <span role="status">
            {saving ? '正在保存…' : dirty ? '编辑中，离开输入框后自动保存' : '设置已同步到本机'}
          </span>
          {dirty && (
            <Button type="submit" variant="outline" disabled={saving || remoteChanged}>
              保存设置
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
