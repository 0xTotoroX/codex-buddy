/*
 * [INPUT]: 版本化设置 API、连接状态与服务端修订。
 * [OUTPUT]: 生成/Jev 独立密钥及表单的失焦/选择自动保存与手动保存共用队列，保留在途编辑和失败草稿。
 * [POS]: 设置表单事务；不执行模型生成、宿主重启或窗口操作。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { useEffect, useRef, useState } from 'react';
import { request, type EditableSettings, type Settings } from './api';

type ControlPatch = { directionSource?: EditableSettings['directionSource']; jevConsent?: boolean };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Draft = {
  form: EditableSettings | null;
  apiKey: string;
  clearKey: boolean;
  jevApiKey: string;
  clearJevKey: boolean;
};
export function useSettingsForm(
  live: boolean,
  revision: number | undefined,
  editable: (value: Settings) => EditableSettings,
  notify: (text: string, failed?: boolean) => void,
) {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft>({
    form: null,
    apiKey: '',
    clearKey: false,
    jevApiKey: '',
    clearJevKey: false,
  });
  const [saving, setSaving] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const current = useRef(draft);
  const baseline = useRef(saved);
  const conflict = useRef(false);
  const flight = useRef<Promise<Settings | null> | null>(null);
  const queued = useRef<Draft | null>(null);
  const controls = useRef<ControlPatch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const changed = () =>
    !!current.current.form &&
    (!equal(current.current.form, baseline.current && editable(baseline.current)) ||
      !!current.current.apiKey ||
      current.current.clearKey ||
      !!current.current.jevApiKey ||
      current.current.clearJevKey);
  function update(value: Draft) {
    current.current = value;
    setDraft(value);
  }
  function load(value: Settings) {
    clearTimeout(timer.current);
    queued.current = null;
    controls.current = null;
    baseline.current = value;
    setSaved(value);
    update({
      form: editable(value),
      apiKey: '',
      clearKey: false,
      jevApiKey: '',
      clearJevKey: false,
    });
    conflict.current = false;
    setRemoteChanged(false);
  }
  useEffect(() => {
    if (!live) return;
    let disposed = false;
    void request<Settings>('settings')
      .then((value) => {
        if (
          disposed ||
          flight.current ||
          value.configurationRevision < (baseline.current?.configurationRevision || 0)
        )
          return;
        if (!changed()) load(value);
        else if (value.configurationRevision !== baseline.current?.configurationRevision) {
          conflict.current = true;
          setRemoteChanged(true);
        }
      })
      .catch((error) => {
        if (!disposed) notifyRef.current(error.message, true);
      });
    return () => {
      disposed = true;
    };
  }, [live, revision]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const dirty =
    !!draft.form &&
    (!equal(draft.form, saved && editable(saved)) ||
      !!draft.apiKey ||
      draft.clearKey ||
      !!draft.jevApiKey ||
      draft.clearJevKey);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function save(snapshot = current.current, control?: ControlPatch): Promise<Settings | null> {
    clearTimeout(timer.current);
    if (control) {
      controls.current = { ...controls.current, ...control };
      queued.current = null;
    } else queued.current = snapshot;
    if (flight.current) return flight.current;
    if (conflict.current)
      return Promise.reject(new Error('设置已在其他窗口更新，请重新载入后再保存'));
    setSaving(true);
    const operation = async () => {
      try {
        while (queued.current || controls.current) {
          const control = controls.current;
          const submitted = control ? current.current : queued.current!;
          if (control) controls.current = null;
          else queued.current = null;
          if (
            !submitted.form ||
            !baseline.current ||
            (!control &&
              equal(submitted.form, editable(baseline.current)) &&
              !submitted.apiKey &&
              !submitted.clearKey &&
              !submitted.jevApiKey &&
              !submitted.clearJevKey)
          )
            continue;
          const value = await request<Settings>('settings', {
            ...(control || {
              ...submitted.form,
              apiKey: submitted.apiKey,
              clearApiKey: submitted.clearKey,
              jevApiKey: submitted.jevApiKey,
              clearJevApiKey: submitted.clearJevKey,
            }),
            expectedRevision: baseline.current.configurationRevision,
          });
          baseline.current = value;
          setSaved(value);
          // Normalize only fields that were not edited while this save was in flight.
          const latest = current.current;
          const form = { ...latest.form! };
          if (!control) {
            for (const key of Object.keys(form) as (keyof EditableSettings)[]) {
              if (equal(form[key], submitted.form[key]))
                Object.assign(form, { [key]: editable(value)[key] });
            }
          } else {
            if (
              control.directionSource !== undefined &&
              form.directionSource === control.directionSource
            )
              form.directionSource = value.directionSource;
            if (control.jevConsent !== undefined && form.jev.consent === control.jevConsent)
              form.jev = { ...form.jev, consent: value.jev.consent };
          }
          update({
            form,
            apiKey: !control && latest.apiKey === submitted.apiKey ? '' : latest.apiKey,
            clearKey: !control && latest.clearKey === submitted.clearKey ? false : latest.clearKey,
            jevApiKey: !control && latest.jevApiKey === submitted.jevApiKey ? '' : latest.jevApiKey,
            clearJevKey:
              !control && latest.clearJevKey === submitted.clearJevKey ? false : latest.clearJevKey,
          });
          notifyRef.current('设置已保存，桌面浮窗会自动同步。');
        }
        return baseline.current;
      } catch (error) {
        queued.current = null;
        if ((error as Error).message.includes('其他窗口')) {
          controls.current = null;
          conflict.current = true;
          setRemoteChanged(true);
        }
        throw error;
      } finally {
        flight.current = null;
        setSaving(false);
        // A failed older draft must not swallow a later explicit disable/revocation.
        const pendingControl = controls.current;
        controls.current = null;
        if (pendingControl && !conflict.current)
          queueMicrotask(() => {
            void saveRef
              .current(current.current, pendingControl)
              .catch((error) => notifyRef.current(error.message, true));
          });
      }
    };
    // Defer execution until flight is assigned, including the no-op path.
    flight.current = Promise.resolve().then(operation);
    return flight.current;
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  function schedule(formElement?: HTMLFormElement) {
    clearTimeout(timer.current);
    const snapshot = current.current;
    timer.current = setTimeout(() => {
      if (formElement && !formElement.checkValidity()) {
        notifyRef.current('有未完成或无效的输入，请修正后保存。', true);
        return;
      }
      void saveRef.current(snapshot).catch((error) => notifyRef.current(error.message, true));
    }, 180);
  }
  function change<K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) {
    if (!current.current.form) return;
    const previous = current.current.form;
    update({ ...current.current, form: { ...previous, [key]: value } });
    notifyRef.current('');
    const control: ControlPatch | null =
      key === 'directionSource' && value !== 'smart'
        ? { directionSource: value as EditableSettings['directionSource'] }
        : key === 'jev' && previous.jev.consent && !(value as EditableSettings['jev']).consent
          ? { jevConsent: false }
          : null;
    if (control) {
      void saveRef
        .current(current.current, control)
        .catch((error) => notifyRef.current(error.message, true));
      return;
    }
    if (
      typeof value === 'boolean' ||
      ['provider', 'protocol', 'generationMode', 'hostRestartPolicy', 'directionSource'].includes(
        key,
      )
    )
      schedule();
  }
  function setApiKey(value: string) {
    update({ ...current.current, apiKey: value });
  }
  function setClearKey(value: boolean, autoSave = true) {
    update({ ...current.current, clearKey: value });
    if (autoSave) schedule();
  }
  function setJevApiKey(value: string) {
    update({ ...current.current, jevApiKey: value, clearJevKey: false });
  }
  function setClearJevKey(value: boolean) {
    update({ ...current.current, clearJevKey: value });
    schedule();
  }
  return {
    jevApiKey: draft.jevApiKey,
    clearJevKey: draft.clearJevKey,
    setJevApiKey,
    setClearJevKey,
    saved,
    form: draft.form,
    dirty,
    apiKey: draft.apiKey,
    clearKey: draft.clearKey,
    remoteChanged,
    saving,
    load,
    change,
    save,
    schedule,
    setApiKey,
    setClearKey,
  };
}
