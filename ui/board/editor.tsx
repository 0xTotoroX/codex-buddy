/* [INPUT]: Task editing snapshot and command handler. [OUTPUT]: Modal task editor and recovery choices.
 * [POS]: Minimal task editor with local archive and conditional conflict review. [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { columns, emptyFields, type Fields, type Task } from './api';
export function Editor({
  task,
  draft,
  onDraft,
  suspend,
  busy,
  error,
  close,
  command,
}: {
  task: Task | null;
  draft?: Fields;
  onDraft?: (fields: Fields) => void;
  suspend?: () => void;
  busy: boolean;
  error: string;
  close: () => void;
  command: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fields, setFields] = useState<Fields>(draft ?? task?.fields ?? emptyFields());
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const frozen =
    !!task &&
    (!!task.remote?.recurring || task.remoteMissing || !!task.conflict || task.deleteRequested);
  async function action(data: Record<string, unknown>) {
    const ok = await command({ id: task?.id, ...(task ? { expectedTask: task } : {}), ...data });
    if (ok) close();
  }
  const patch = (p: Partial<Fields>) => {
    const next = { ...fields, ...p };
    setFields(next);
    onDraft?.(next);
  };
  return (
    <dialog
      ref={dialog}
      className="task-editor"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action({ op: task ? 'update' : 'create', fields });
        }}
      >
        <header>
          <h2>{task ? '任务详情' : '新建任务'}</h2>
          <button type="button" onClick={close} disabled={busy} aria-label="关闭任务详情">
            ×
          </button>
        </header>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {task?.conflict && (
          <section className="recovery">
            <h3>两端修改需要选择</h3>
            <p>不同字段已自动合并。下列字段在两端同时改变：</p>
            {task.conflict.fields.map((key) => (
              <div key={key} className="conflict-values">
                <strong>
                  {(
                    {
                      title: '标题',
                      notes: '备注',
                      due: '截止日期',
                      priority: '优先级',
                      column: '阶段',
                      completed: '完成状态',
                      delete: '删除',
                    } as Record<string, string>
                  )[key] ?? key}
                </strong>
                <p>
                  本地：
                  {key === 'delete' ? '请求永久删除' : JSON.stringify(fields[key as keyof Fields])}
                </p>
                <p>
                  Apple：
                  {key === 'delete'
                    ? '任务已修改'
                    : JSON.stringify(task.conflict!.remote.fields[key as keyof Fields])}
                </p>
              </div>
            ))}
            <div className="actions">
              <button
                type="button"
                disabled={busy || task.deleteRequested}
                onClick={() => void action({ op: 'resolve', choice: 'local' })}
              >
                保留本地修改
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action({ op: 'resolve', choice: 'remote' })}
              >
                使用 Apple 版本
              </button>
            </div>
          </section>
        )}
        {task?.remoteMissing && (
          <section className="recovery">
            <h3>Apple 任务已删除、移动或身份待核对</h3>
            <p>内容已保留。请先在提醒事项中检查原任务，恢复同步会创建一条新提醒。</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm('已检查 Apple 提醒事项，确认要创建一条新的提醒？'))
                  void action({ op: 'restore', confirmNew: true });
              }}
            >
              创建新提醒并恢复同步
            </button>
          </section>
        )}
        {task?.remote?.recurring && (
          <p className="hint">重复提醒请在 Apple 提醒事项中修改；这里保留原有重复规则和提醒。</p>
        )}
        <label>
          标题
          <input
            autoFocus
            required
            maxLength={1000}
            value={fields.title}
            disabled={frozen || busy}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>
        <label>
          备注
          <textarea
            aria-label="备注"
            rows={4}
            maxLength={8000}
            value={fields.notes}
            disabled={frozen || busy}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            阶段
            <select
              disabled={frozen || busy}
              value={fields.completed ? 'done' : fields.column === 'doing' ? 'doing' : 'todo'}
              onChange={(e) =>
                patch(
                  e.target.value === 'done'
                    ? { completed: true }
                    : { completed: false, column: e.target.value },
                )
              }
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === 'done' ? '完成' : c.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <footer>
          {suspend && (
            <button type="button" disabled={busy} onClick={suspend}>
              保留草稿并返回
            </button>
          )}
          {task && (
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void action({ op: 'archive', archived: !task.archived })}
              >
                {task.archived ? '取消归档' : '归档'}
              </button>
            </div>
          )}
          <button className="primary" type="submit" disabled={busy || frozen}>
            {busy ? '处理中…' : '保存任务'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
