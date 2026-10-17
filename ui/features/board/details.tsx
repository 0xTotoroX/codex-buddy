/* [INPUT]: Task snapshot, retained draft and the existing revision-checked task command.
 * [OUTPUT]: Task details with explicit save, preserved failures and conflict-safe editing.
 * [POS]: Board-only presentation; never migrates tasks or writes reminder metadata.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useEffect, useRef, useId } from 'react';
import { Icon } from '../../shared/icons/react';
import { dueText, type Fields, type Task } from './api';
export type TaskDraft = { task: Task; fields: Fields; open: boolean };
export function priorityLabel(value: number) {
  return value === 0 ? '' : value <= 4 ? '高' : value === 5 ? '中' : '低';
}
export function TaskDetails({
  draft,
  current,
  busy,
  error,
  syncEnabled,
  change,
  close,
  save,
  reload,
}: {
  draft: TaskDraft;
  current?: Task;
  busy: boolean;
  error: string;
  syncEnabled?: boolean;
  change: (fields: Fields) => void;
  close: () => void;
  save: () => void;
  reload: () => void;
}) {
  const fieldId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (draft.open) node?.showModal();
    else node?.close();
    return () => {
      node?.close();
    };
  }, [draft.open]);
  const changed = !!current && JSON.stringify(current) !== JSON.stringify(draft.task);
  const readonly =
    !current ||
    current.remoteMissing ||
    !!current.conflict ||
    !!current.remote?.recurring ||
    current.deleteRequested;
  const fields = draft.fields;
  const date = dueText(fields.due).slice(0, 10);
  const time = fields.due?.hour == null ? '' : dueText(fields.due).slice(11);
  function updateDue(day: string, clock: string) {
    if (!day) return change({ ...fields, due: null });
    const [year, month, d] = day.split('-').map(Number);
    const [hour, minute] = clock ? clock.split(':').map(Number) : [null, null];
    change({
      ...fields,
      due: { year, month, day: d, hour, minute, timeZone: fields.due?.timeZone ?? null },
    });
  }
  return (
    <dialog
      ref={dialog}
      className="task-details"
      aria-labelledby="task-details-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !readonly && !changed) save();
        }}
      >
        <header>
          <h2 id="task-details-title">任务详情</h2>
          <button type="button" aria-label="关闭任务详情" disabled={busy} onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        {!current && <p role="alert">任务已被移除，未保存内容仍保留。</p>}
        {readonly && current && <p role="status">此任务暂时只读，请先处理同步状态。</p>}
        {changed && (
          <p role="alert">
            任务已在其他位置更新，草稿已保留。
            <button type="button" disabled={busy} onClick={reload}>
              重新载入
            </button>
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <label htmlFor={`${fieldId}-title`}>
          <span>标题</span>
          <input
            id={`${fieldId}-title`}
            aria-label="标题"
            autoFocus
            required
            maxLength={1000}
            value={fields.title}
            disabled={busy || readonly}
            onChange={(e) => change({ ...fields, title: e.target.value })}
          />
        </label>
        <label htmlFor={`${fieldId}-notes`}>
          <span>备注</span>
          <textarea
            id={`${fieldId}-notes`}
            aria-label="备注"
            rows={5}
            maxLength={8000}
            value={fields.notes}
            disabled={busy || readonly}
            onChange={(e) => change({ ...fields, notes: e.target.value })}
          />
        </label>
        <label htmlFor={`${fieldId}-priority`}>
          <span>优先级</span>
          <select
            id={`${fieldId}-priority`}
            aria-label="优先级"
            value={fields.priority}
            disabled={busy || readonly}
            onChange={(e) => change({ ...fields, priority: Number(e.target.value) })}
          >
            <option value={0}>无</option>
            <option value={fields.priority > 0 && fields.priority < 5 ? fields.priority : 1}>
              高
            </option>
            <option value={5}>中</option>
            <option value={fields.priority > 5 ? fields.priority : 9}>低</option>
          </select>
        </label>
        <div className="task-details-date">
          <label htmlFor={`${fieldId}-date`}>
            <span>截止日期</span>
            <input
              id={`${fieldId}-date`}
              type="date"
              value={date}
              disabled={busy || readonly}
              onChange={(e) => updateDue(e.target.value, time)}
            />
          </label>
          <label htmlFor={`${fieldId}-time`}>
            <span>时间（可选）</span>
            <input
              id={`${fieldId}-time`}
              type="time"
              value={time}
              disabled={busy || readonly || !date}
              onChange={(e) => updateDue(date, e.target.value)}
            />
          </label>
        </div>
        {syncEnabled && <p className="task-details-hint">优先级和截止日期仅保存在 Buddy。</p>}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            返回
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || readonly || changed || !fields.title.trim()}
          >
            {busy ? '正在保存…' : '保存'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
