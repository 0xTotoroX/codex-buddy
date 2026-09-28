/* [INPUT]: Task DTO and edit/move handlers. [OUTPUT]: Draggable title cards and column drop areas.
 * [POS]: Native drag events stay inside the board Shadow DOM; no document-level retargeting.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useState, type DragEvent, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import type { Task } from './api';
const taskType = 'application/x-codex-buddy-task';
export function taskDragOver(event: DragEvent) {
  if (!event.dataTransfer.types.includes(taskType)) return false;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';
  return true;
}
export function taskDrop(event: DragEvent, move: (id: string) => void) {
  if (!taskDragOver(event)) return;
  const id = event.dataTransfer.getData(taskType);
  if (id) move(id);
}
export function TaskCard({
  task,
  disabled,
  edit,
  before,
}: {
  task: Task;
  disabled: boolean;
  edit: () => void;
  before: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const readonly =
    disabled ||
    task.remoteMissing ||
    !!task.conflict ||
    !!task.remote?.recurring ||
    task.deleteRequested;
  return (
    <article
      draggable={!readonly}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.setData(taskType, task.id);
        event.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        setOver(false);
      }}
      onDragOver={(event) => {
        if (!readonly && taskDragOver(event)) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (!readonly)
          taskDrop(event, (id) => {
            if (id !== task.id) before(id);
          });
      }}
      className={`task-card ${dragging ? 'dragging' : ''} ${over ? 'drop-before' : ''}`}
    >
      <button className="card-title" onClick={edit}>
        {task.fields.title}
      </button>
      {(task.conflict || task.remoteMissing || task.remote?.recurring) && (
        <div className="card-meta">
          {(task.conflict || task.remoteMissing) && (
            <span className="attention">
              <AlertCircle size={12} />
              需要处理
            </span>
          )}
          {task.remote?.recurring && <span>重复 · 只读</span>}
        </div>
      )}
    </article>
  );
}
export function Column({
  id,
  title,
  heading,
  children,
  move,
  disabled,
}: {
  id: string;
  title: string;
  heading: ReactNode;
  children: ReactNode;
  move: (taskId: string, column: string) => void;
  disabled: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      className={`board-column ${over ? 'drop-column' : ''}`}
      aria-label={title}
      onDragOver={(event) => {
        if (!disabled && taskDragOver(event)) setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDropCapture={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (!disabled) taskDrop(event, (taskId) => move(taskId, id));
      }}
    >
      <header className="column-heading">{heading}</header>
      <div className="column-cards">{children}</div>
    </section>
  );
}
