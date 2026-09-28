/* [INPUT]: Task API, native window events and drag/drop components.
 * [OUTPUT]: Editable task groups, inline creation and compact tabs or wide columns.
 * [POS]: Task-only application entry; no Codex/model dependencies.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import {
  columns as defaults,
  emptyFields,
  taskGroup,
  useTasks,
  type Task,
  type Fields,
  type TaskRequest,
} from './api';
import { Column, TaskCard, taskDragOver, taskDrop } from './card';
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
  quickAdd?: { column: string; title: string } | null;
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
  const [stage, setStage] = useState(view?.tab === 'archive' ? 'done' : view?.stage || 'todo');
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
  const [searchOpen, setSearchOpen] = useState(!!view?.search);
  const [quickAdd, setQuickAdd] = useState(view?.quickAdd ?? null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [dropTab, setDropTab] = useState('');
  const columns = state?.store.columns ?? defaults;
  useEffect(() => {
    if (!columns.some((c) => c.id === stage)) setStage('todo');
  }, [columns, stage]);
  useEffect(() => {
    if (view) Object.assign(view, { search, stage, tab, editor, quickAdd });
  }, [view, search, stage, tab, editor, quickAdd]);
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
      if (!task || busy || id === before) return;
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
      before={(id) => move(id, taskGroup(task), task.id)}
    />
  );
  const nameInput = () =>
    renaming && (
      <form
        className="group-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          void command({
            op: renaming.id ? 'renameColumn' : 'createColumn',
            id: renaming.id,
            title: renaming.title,
          }).then((ok) => {
            if (ok) setRenaming(null);
          });
        }}
      >
        <input
          autoFocus
          aria-label="分组名称"
          maxLength={40}
          value={renaming.title}
          disabled={busy}
          onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRenaming(null);
          }}
        />
        <button disabled={busy || !renaming.title.trim()} type="submit">
          保存
        </button>
        <button
          disabled={busy}
          type="button"
          aria-label="取消分组编辑"
          onClick={() => setRenaming(null)}
        >
          <X size={14} />
        </button>
      </form>
    );
  const boardTools = (
    <div className="board-tools">
      <button
        title="新增分组"
        aria-label="新增分组"
        disabled={busy}
        onClick={() => setRenaming({ id: '', title: '' })}
      >
        <Plus size={16} />
        分组
      </button>
      <button
        title="搜索任务"
        aria-label="搜索任务"
        aria-expanded={searchOpen}
        onClick={() => {
          setSearchOpen(!searchOpen);
          if (searchOpen) setSearch('');
        }}
      >
        <Search size={15} />
      </button>
    </div>
  );
  const addTask = (column: string) =>
    quickAdd?.column === column ? (
      <form
        className="quick-add"
        onSubmit={(event) => {
          event.preventDefault();
          void command({
            op: 'create',
            fields: {
              ...emptyFields(),
              title: quickAdd.title.trim(),
              column: column === 'done' ? 'todo' : column,
              completed: column === 'done',
            },
          }).then((ok) => {
            if (ok) setQuickAdd(null);
          });
        }}
      >
        <input
          autoFocus
          aria-label="新任务标题"
          placeholder="任务标题"
          maxLength={1000}
          value={quickAdd.title}
          disabled={busy}
          onChange={(e) => setQuickAdd({ column, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuickAdd(null);
          }}
        />
        <div>
          <button disabled={busy || !quickAdd.title.trim()} type="submit">
            添加
          </button>
          <button disabled={busy} type="button" onClick={() => setQuickAdd(null)}>
            取消
          </button>
        </div>
      </form>
    ) : (
      <button
        className="add-task"
        disabled={busy}
        onClick={() => setQuickAdd({ column, title: '' })}
      >
        <Plus size={14} />
        新建任务
      </button>
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
      {!embedded && (
        <header className="board-header">
          <h1>我的任务看板</h1>
        </header>
      )}
      <main className="board-main">
        {narrow && (
          <div className="board-toolbar">
            <nav className="stage-tabs" aria-label="任务阶段">
              {columns.map((column) => (
                <button
                  key={column.id}
                  aria-pressed={stage === column.id}
                  className={dropTab === column.id ? 'drop-tab' : ''}
                  title="双击修改分组名称"
                  onClick={() => setStage(column.id)}
                  onDoubleClick={() => setRenaming({ ...column })}
                  onDragOver={(e) => {
                    if (!busy && taskDragOver(e)) setDropTab(column.id);
                  }}
                  onDragLeave={() => setDropTab('')}
                  onDrop={(e) => {
                    setDropTab('');
                    if (!busy)
                      taskDrop(e, (id) => {
                        move(id, column.id);
                        setStage(column.id);
                      });
                  }}
                >
                  {column.title}
                </button>
              ))}
            </nav>
            {boardTools}
          </div>
        )}
        {searchOpen && (
          <input
            className="board-search"
            autoFocus
            type="search"
            aria-label="搜索任务"
            placeholder="搜索任务…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        {renaming && (!renaming.id || narrow) && nameInput()}
        {editor?.suspended && (
          <button
            className="resume-draft"
            onClick={() => setEditor({ ...editor, suspended: false })}
          >
            继续编辑草稿
          </button>
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
        <div
          className={`board-grid ${narrow ? 'narrow' : ''}`}
          style={
            narrow
              ? undefined
              : { gridTemplateColumns: `repeat(${columns.length}, minmax(210px, 1fr))` }
          }
        >
          {(narrow ? columns.filter((column) => column.id === stage) : columns).map((column) => {
            const group = visible.filter((t) => taskGroup(t) === column.id);
            return (
              <Column
                key={column.id}
                {...column}
                disabled={busy}
                move={move}
                heading={
                  <>
                    {!narrow && renaming?.id === column.id ? (
                      nameInput()
                    ) : (
                      <>
                        <button
                          className="group-title"
                          title="修改分组名称"
                          disabled={busy}
                          onClick={() => setRenaming({ ...column })}
                        >
                          {column.title}
                        </button>
                        <small>{group.length}</small>
                      </>
                    )}
                    {!narrow && column.id === columns.at(-1)?.id && boardTools}
                  </>
                }
              >
                {group.map(card)}
                {addTask(column.id)}
              </Column>
            );
          })}
        </div>
      </main>
      {editor && !editor.suspended && (
        <Editor
          key={`${editor.task?.id ?? 'new'}-${editor.revision}`}
          columns={columns}
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
