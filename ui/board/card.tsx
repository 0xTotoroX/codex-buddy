/* [INPUT]: Task DTO and edit/move handlers. [OUTPUT]: Accessible draggable task card and column.
 * [POS]: Board interaction primitives. [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { Check, GripVertical, AlertCircle } from 'lucide-react';
import { columns, taskGroup, type Task } from './api';
export function TaskCard({
  task,
  disabled,
  edit,
  move,
  before,
}: {
  task: Task;
  disabled: boolean;
  edit: () => void;
  move: (column: string) => void;
  before: (id: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const readonly =
    disabled ||
    task.archived ||
    task.remoteMissing ||
    !!task.conflict ||
    !!task.remote?.recurring ||
    task.deleteRequested;
  useEffect(() => {
    if (!ref.current || readonly) return;
    return combine(
      draggable({
        element: ref.current,
        getInitialData: () => ({ taskId: task.id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: ref.current,
        canDrop: ({ source }) =>
          typeof source.data.taskId === 'string' && source.data.taskId !== task.id,
        onDragEnter: () => setOver(true),
        onDragLeave: () => setOver(false),
        onDrop: ({ source }) => {
          setOver(false);
          before(String(source.data.taskId));
        },
      }),
    );
  }, [task.id, readonly, before]);
  return (
    <article
      ref={ref}
      className={`task-card ${dragging ? 'dragging' : ''} ${over ? 'drop-before' : ''}`}
    >
      <div className="card-top">
        <button
          className="complete"
          aria-label={task.fields.completed ? '取消完成' : '完成任务'}
          disabled={readonly}
          onClick={() => move(task.fields.completed ? task.fields.column : 'done')}
        >
          {task.fields.completed && <Check size={13} />}
        </button>
        <button className="card-title" onClick={edit}>
          {task.fields.title}
        </button>
        <GripVertical size={14} className="grip" aria-hidden="true" />
      </div>
      {task.fields.notes && <p className="card-note">{task.fields.notes}</p>}
      <div className="card-meta">
        {(task.conflict || task.remoteMissing) && (
          <span className="attention">
            <AlertCircle size={12} />
            需要处理
          </span>
        )}
        {task.remote?.recurring && <span>重复 · 只读</span>}
        {task.archived && <span>已归档</span>}
      </div>
      <label className="card-move">
        <span className="sr-only">移动 {task.fields.title}</span>
        <select
          aria-label={`移动 ${task.fields.title}`}
          disabled={readonly}
          value={taskGroup(task)}
          onChange={(e) => move(e.target.value)}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id === 'done' ? '完成' : c.title}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}
export function Column({
  id,
  title,
  count,
  children,
  move,
}: {
  id: string;
  title: string;
  count: number;
  children: ReactNode;
  move: (taskId: string, column: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    return dropTargetForElements({
      element: ref.current,
      canDrop: ({ source }) => typeof source.data.taskId === 'string',
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source, location }) => {
        setOver(false);
        if (location.current.dropTargets[0]?.element === ref.current)
          move(String(source.data.taskId), id);
      },
    });
  }, [id, move]);
  return (
    <section className={`board-column ${over ? 'drop-column' : ''}`} ref={ref} aria-label={title}>
      <h2>
        <span className={`column-dot ${id}`} />
        {title}
        <small>{count}</small>
      </h2>
      <div className="column-cards">
        {children}
        {count === 0 && <p className="empty-column">拖入卡片，或新建任务</p>}
      </div>
    </section>
  );
}
