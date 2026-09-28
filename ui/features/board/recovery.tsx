/* [INPUT]: Task sync conflict or missing-remote snapshot and command handler.
 * [OUTPUT]: Conditional inline recovery choices; no task detail editor.
 * [POS]: Board-only exception handling. [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { AlertCircle } from 'lucide-react';
import type { Fields, Task } from './api';
export function Recovery({
  task,
  busy,
  command,
}: {
  task: Task;
  busy: boolean;
  command: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  const action = (data: Record<string, unknown>) =>
    command({ id: task.id, expectedTask: task, ...data });
  return (
    <details className="task-recovery">
      <summary className="attention">
        <AlertCircle size={16} aria-hidden="true" />
        需要处理
      </summary>
      {task.conflict && (
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
                {key === 'delete'
                  ? '请求永久删除'
                  : JSON.stringify(task.fields[key as keyof Fields])}
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
      {task.remoteMissing && (
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
    </details>
  );
}
