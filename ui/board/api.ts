/* [INPUT]: Authenticated local task API. [OUTPUT]: Task DTOs and a refreshable state hook.
 * [POS]: Shared board/settings task client. [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
export type TaskRequest = <T = TaskState>(path: string, body?: unknown) => Promise<T>;
const localRequest: TaskRequest = async (path, body) => {
  const { request } = await import('../settings/api');
  return request(path, body);
};
export type Due = {
  year: number;
  month: number;
  day: number;
  hour: number | null;
  minute: number | null;
  timeZone: string | null;
};
export type Fields = {
  title: string;
  notes: string;
  due: Due | null;
  priority: number;
  column: string;
  completed: boolean;
};
export type Remote = { id: string; fields: Fields; recurring: boolean };
export type Task = {
  id: string;
  fields: Fields;
  archived: boolean;
  deleteRequested: boolean;
  remote: Remote | null;
  remoteMissing: boolean;
  conflict: { fields: string[]; remote: Remote } | null;
};
export type Bindings = { calendarId: string; todo?: string; doing?: string; waiting?: string };
export type Calendar = {
  id: string;
  title: string;
  source: string;
  sourceTitle: string;
  writable: boolean;
};
export type TaskState = {
  store: {
    revision: number;
    boardEnabled: boolean;
    syncEnabled: boolean;
    bindings: Bindings;
    tasks: Task[];
    inflight: { taskId: string; action: string } | null;
  };
  status: string;
  error?: string | null;
};
export const columns = [
  { id: 'todo', title: '待办', tab: '看板' },
  { id: 'doing', title: '进行中', tab: '处理中' },
  { id: 'done', title: '完成 / 归档', tab: '归档' },
];
export function taskGroup(task: Task) {
  return task.archived || task.fields.completed
    ? 'done'
    : task.fields.column === 'doing'
      ? 'doing'
      : 'todo';
}
export const emptyFields = (): Fields => ({
  title: '',
  notes: '',
  due: null,
  priority: 0,
  column: 'todo',
  completed: false,
});
export function useTasks(poll = false, request: TaskRequest = localRequest) {
  const [state, setState] = useState<TaskState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    if (writing.current) return;
    const epoch = ++generation.current;
    try {
      const next = await request<TaskState>('tasks/state');
      if (epoch === generation.current) {
        setState(next);
        if (next.error) setError(next.error);
      }
    } catch (e) {
      if (epoch === generation.current) setError(String(e));
    }
  }, [request]);
  useEffect(() => {
    void reload();
    window.addEventListener('focus', reload);
    const interval = poll
      ? setInterval(() => {
          if (!document.hidden) void reload();
        }, 2000)
      : undefined;
    return () => {
      generation.current++;
      window.removeEventListener('focus', reload);
      clearInterval(interval);
    };
  }, [poll, reload]);
  async function command<T = TaskState>(data: Record<string, unknown>): Promise<T | null> {
    if (writing.current) return null;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      return await request<T>('tasks/command', { revision: state?.store.revision, ...data });
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      writing.current = false;
      setBusy(false);
      await reload();
    }
  }
  return { state, error, busy, command, reload, setError };
}
export function dueText(due: Due | null) {
  if (!due) return '';
  const day = `${due.year}-${String(due.month).padStart(2, '0')}-${String(due.day).padStart(2, '0')}`;
  return due.hour == null
    ? day
    : `${day} ${String(due.hour).padStart(2, '0')}:${String(due.minute ?? 0).padStart(2, '0')}`;
}
