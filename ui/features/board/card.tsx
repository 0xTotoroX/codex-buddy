/* [INPUT]: Task DTO and command/move handlers. [OUTPUT]: Draggable cards with hover removal and recovery.
 * [POS]: Native drag events stay inside the board Shadow DOM; no document-level retargeting.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useState, type DragEvent, type ReactNode } from 'react';
import { Icon } from '../../shared/icons/react';
import { dueText, type Task } from './api';
import { priorityLabel } from './details';
import { Recovery } from './recovery';
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
  command,
  before,
  edit,
}: {
  task: Task;
  edit: () => void;
  disabled: boolean;
  command: (data: Record<string, unknown>) => Promise<unknown>;
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
      <button
        type="button"
        className="card-title card-open"
        aria-label={`任务详情：${task.fields.title}`}
        onClick={edit}
      >
        {task.fields.title}
      </button>
      {(task.fields.priority > 0 || task.fields.due) && (
        <div className="card-meta card-details-meta">
          {task.fields.priority > 0 && (
            <span aria-label={`优先级：${priorityLabel(task.fields.priority)}`}>
              {priorityLabel(task.fields.priority)}优先级
            </span>
          )}
          {task.fields.due && <time>{dueText(task.fields.due)}</time>}
        </div>
      )}
      <button
        type="button"
        className="card-delete"
        aria-label={`删除任务：${task.fields.title}`}
        disabled={disabled}
        draggable={false}
        onPointerDown={(event) => event.stopPropagation()}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          void command({ op: 'remove', id: task.id, expectedTask: task });
        }}
      >
        <Icon name="trash" />
      </button>
      {task.remote?.recurring && <div className="card-meta">重复 · 只读</div>}
      {(task.conflict || task.remoteMissing) && (
        <Recovery task={task} busy={disabled} command={command} />
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
