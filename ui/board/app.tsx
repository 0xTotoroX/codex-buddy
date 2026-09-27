/* [INPUT]: Task API, native window events and drag/drop components.
 * [OUTPUT]: Three task groups with compact tabs and a wide board.
 * [POS]: Task-only application entry; no Codex/model dependencies.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { columns, taskGroup, useTasks, type Task, type Fields, type TaskRequest } from './api';
import { Column, TaskCard } from './card';
import { Editor } from './editor';
export type BoardEditor = {
  task: Task | null;
  revision: number;
  draft?: Fields;
  suspended?: boolean;
};
export type BoardView = {
  search: string;
  stage: string;
  tab: string;
  gridLeft?: number;
  editor?: BoardEditor | null;
};
export function Board({
  request,
  embedded = false,
  locked = false,
  view,
}: {
  request: TaskRequest;
  embedded?: boolean;
  locked?: boolean;
  view?: BoardView;
}) {
  const { state, error, busy: taskBusy, command } = useTasks(true, request);
  const busy = taskBusy || locked;
  const element = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [stage, setStage] = useState(
    view?.tab === 'archive'
      ? 'done'
      : view?.stage === 'doing' || view?.stage === 'done'
        ? view.stage
        : 'todo',
  );
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 680));
    observer.observe(node);
    return () => observer.disconnect();
  }, [!!state]);
  const tab = 'board';
  const [editor, setEditor] = useState<BoardEditor | null>(view?.editor ?? null);
  const [search, setSearch] = useState(view?.search ?? '');
  useEffect(() => {
    if (view) Object.assign(view, { search, stage, tab, editor });
  }, [view, search, stage, tab, editor]);
  useEffect(() => {
    const resize = (e: Event) => {
      void request('tasks/command', { op: 'windowSize', size: (e as CustomEvent).detail }).catch(
        () => {},
      );
    };
    window.addEventListener('board-size', resize);
    return () => window.removeEventListener('board-size', resize);
  }, [request]);
  useEffect(() => {
    const grid = element.current?.querySelector<HTMLElement>('.board-grid');
    if (grid && !narrow) grid.scrollLeft = view?.gridLeft || 0;
  }, [narrow, tab, state?.store.tasks.length, view]);
  const move = useCallback(
    (id: string, column: string, before?: string) => {
      const task = state?.store.tasks.find((t) => t.id === id);
      if (!task || busy) return;
      const fields = {
        ...task.fields,
        completed: column === 'done',
        column: column === 'done' ? task.fields.column : column,
      };
      void command({ op: 'update', id, fields, before, archived: false });
    },
    [state, busy, command],
  );
  if (!state)
    return (
      <main className="loading">
        <h1>任务看板</h1>
        <p role="status">{error || '正在读取本地任务…'}</p>
      </main>
    );
  if (!state.store.boardEnabled)
    return <div className="loading">任务看板已停用，请在设置页开启。</div>;
  const tasks = state.store.tasks;
  const visible = tasks.filter((t) =>
    `${t.fields.title}\n${t.fields.notes}`.toLowerCase().includes(search.toLowerCase()),
  );
  const card = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      disabled={busy || !state.store.boardEnabled || state.store.inflight?.taskId === task.id}
      edit={() => setEditor({ task, revision: state.store.revision })}
      move={(c) => move(task.id, c)}
      before={(id) => move(id, taskGroup(task), task.id)}
    />
  );
  return (
    <div
      ref={element}
      onScrollCapture={(e) => {
        const node = e.target as HTMLElement;
        if (view && node.classList.contains('board-grid') && node.scrollWidth > node.clientWidth)
          view.gridLeft = node.scrollLeft;
      }}
      className={`board-app ${embedded ? 'embedded' : ''}`}
    >
      <header className="board-header">
        <div className="heading">
          <div>
            <p className="eyebrow">CodexBuddy</p>
            <h1>任务看板</h1>
          </div>
        </div>
        <div className="header-actions">
          {editor?.suspended && (
            <button onClick={() => setEditor({ ...editor, suspended: false })}>继续编辑草稿</button>
          )}
          <button
            className="primary"
            disabled={busy || !state.store.boardEnabled}
            onClick={() => setEditor({ task: null, revision: state.store.revision })}
          >
            <Plus size={16} />
            新建任务
          </button>
        </div>
      </header>
      <main className="board-main">
        <div className="board-toolbar">
          <input
            type="search"
            aria-label="搜索任务"
            placeholder="搜索任务…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {state.store.inflight?.action === 'create' && (
          <div className="recovery">
            <strong>创建结果待确认</strong>
            <p>请先在 Apple 提醒事项中检查。同步会尝试找到此前创建的任务，不会盲目重建。</p>
            <button
              disabled={busy}
              onClick={() => {
                if (confirm('确认已核对 Apple 提醒事项？此次操作将保留并归档本地记录，停止重试。'))
                  void command({ op: 'uncertain', confirmChecked: true });
              }}
            >
              已核对，归档并停止重试
            </button>
          </div>
        )}
        {narrow && (
          <nav className="stage-tabs" aria-label="任务阶段">
            {columns.map((column) => (
              <button
                key={column.id}
                aria-pressed={stage === column.id}
                onClick={() => setStage(column.id)}
              >
                {column.tab}
              </button>
            ))}
          </nav>
        )}
        <div className={`board-grid ${narrow ? 'narrow' : ''}`}>
          {(narrow ? columns.filter((column) => column.id === stage) : columns).map((column) => {
            const group = visible.filter((t) => taskGroup(t) === column.id);
            return (
              <Column key={column.id} {...column} count={group.length} move={move}>
                {group.map(card)}
              </Column>
            );
          })}
        </div>
      </main>
      {editor && !editor.suspended && (
        <Editor
          key={`${editor.task?.id ?? 'new'}-${editor.revision}`}
          task={editor.task}
          draft={editor.draft}
          onDraft={(draft) => {
            editor.draft = draft;
            if (view) view.editor = editor;
          }}
          suspend={() => setEditor({ ...editor, suspended: true })}
          busy={busy}
          error={error}
          close={() => setEditor(null)}
          command={command}
        />
      )}
    </div>
  );
}
