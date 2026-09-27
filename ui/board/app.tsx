/* [INPUT]: Task API, native window events and drag/drop components.
 * [OUTPUT]: Independent four-column board with archive and recovery views.
 * [POS]: Task-only application entry; no Codex/model dependencies.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, LayoutDashboard, Archive, AlertCircle } from 'lucide-react';
import { columns, useTasks, type Task, type Fields, type TaskRequest } from './api';
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
  const [stage, setStage] = useState(view?.stage ?? 'todo');
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 680));
    observer.observe(node);
    return () => observer.disconnect();
  }, [!!state]);
  const [tab, setTab] = useState(view?.tab ?? 'board');
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
      void command({ op: 'update', id, fields, before });
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
  const attention = tasks.filter(
    (t) =>
      t.conflict || t.remoteMissing || t.deleteRequested || t.id === state.store.inflight?.taskId,
  ).length;
  const visible = tasks.filter(
    (t) =>
      (tab === 'archive'
        ? t.archived
        : tab === 'attention'
          ? t.conflict ||
            t.remoteMissing ||
            t.deleteRequested ||
            t.id === state.store.inflight?.taskId
          : !t.archived) &&
      `${t.fields.title}\n${t.fields.notes}`.toLowerCase().includes(search.toLowerCase()),
  );
  const card = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      disabled={busy || !state.store.boardEnabled || state.store.inflight?.taskId === task.id}
      edit={() => setEditor({ task, revision: state.store.revision })}
      move={(c) => move(task.id, c)}
      before={(id) => move(id, task.fields.completed ? 'done' : task.fields.column, task.id)}
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
            disabled={busy || !state.store.syncEnabled}
            onClick={() => void command({ op: 'sync' })}
          >
            <RefreshCw size={15} />
            同步
          </button>
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
          <nav aria-label="任务视图">
            <button aria-pressed={tab === 'board'} onClick={() => setTab('board')}>
              <LayoutDashboard size={15} />
              看板
            </button>
            <button aria-pressed={tab === 'archive'} onClick={() => setTab('archive')}>
              <Archive size={15} />
              归档
            </button>
            <button aria-pressed={tab === 'attention'} onClick={() => setTab('attention')}>
              <AlertCircle size={15} />
              待处理{attention > 0 && <span className="badge">{attention}</span>}
            </button>
          </nav>
          <input
            type="search"
            aria-label="搜索任务"
            placeholder="搜索任务…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="sync-line" role="status">
          <span className={`status-dot ${state.store.syncEnabled ? 'active' : ''}`} />
          {state.store.syncEnabled ? state.status : '本地看板 · Apple 同步已暂停'}
          <span>{tasks.filter((t) => !t.archived && !t.fields.completed).length} 项未完成</span>
        </div>
        {!state.store.boardEnabled && (
          <p className="error">看板已停用，请在 CodexBuddy 设置中重新开启。任务数据已保留。</p>
        )}
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
        {tab === 'board' && narrow && (
          <nav className="stage-tabs" aria-label="任务阶段">
            {columns.map((column) => (
              <button
                key={column.id}
                aria-pressed={stage === column.id}
                onClick={() => setStage(column.id)}
              >
                {column.title}
              </button>
            ))}
          </nav>
        )}
        {tab === 'board' ? (
          <div className={`board-grid ${narrow ? 'narrow' : ''}`}>
            {(narrow ? columns.filter((column) => column.id === stage) : columns).map((column) => {
              const group = visible.filter(
                (t) => (t.fields.completed ? 'done' : t.fields.column) === column.id,
              );
              return (
                <Column key={column.id} {...column} count={group.length} move={move}>
                  {group.map(card)}
                </Column>
              );
            })}
          </div>
        ) : (
          <div className="task-list">
            {visible.map(card)}
            {visible.length === 0 && (
              <div className="empty-view">
                <Archive size={28} />
                <h2>{tab === 'archive' ? '还没有归档任务' : '没有待处理事项'}</h2>
                <p>
                  {tab === 'archive'
                    ? '归档只隐藏本地卡片，保留 Apple 提醒事项。'
                    : '需要选择的冲突和恢复记录会出现在这里。'}
                </p>
              </div>
            )}
          </div>
        )}
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
