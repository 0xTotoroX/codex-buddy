/* [INPUT]: 认证术语 API、共用卡片呈现与用户导入/输入。
 * [OUTPUT]: 三种真实卡片预览、检索、掌握列表、分类入库和文档导出。
 * [POS]: 详细设置的功能区，不访问主聊天内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { cardStyles, createCard } from '../terminology/card.js';

type Term = {
  id: string;
  name: string;
  english: string;
  definition: string;
  aliases: string[];
  category: string[];
  example: string;
  source: string;
};
type Library = {
  entries: Term[];
  preferences: {
    enabled: boolean;
    semantic: boolean;
    autoExpand: boolean;
    cardStyle: string;
    mastered: string[];
    revision: number;
  };
};
const sample: Term = {
  id: 'sample',
  name: '竞态条件',
  english: 'Race Condition',
  definition:
    '多个操作的执行先后不可预测，最终结果随完成顺序变化。例如切换聊天后，旧请求较晚返回并覆盖新页面。',
  aliases: [],
  category: ['程序基础与执行机制', '管理运行与并发'],
  example: '',
  source: '',
};
function Preview({ term, style }: { term: Term; style: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current!;
    const card = createCard(term, { style, onMaster: async () => {} });
    card.querySelector('button')?.setAttribute('disabled', '');
    node.replaceChildren(card);
    return () => node.replaceChildren();
  }, [term, style]);
  return <div ref={ref} className="term-preview" />;
}
function download(text: string, name: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TerminologySettings({ active }: { active: boolean }) {
  const [data, setData] = useState<Library | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''),
    [masteredOnly, setMasteredOnly] = useState(false);
  const [name, setName] = useState(''),
    [english, setEnglish] = useState(''),
    [definition, setDefinition] = useState('');
  const [preview, setPreview] = useState<Term>(sample);
  const load = () =>
    request<Library>('terminology')
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (active) void load();
  }, [active]);
  async function command(payload: object) {
    setBusy(true);
    setError('');
    try {
      const state = await request<Library>('terminology', payload);
      setData(state);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(manual = false, json = false) {
    setError('');
    try {
      const value = await request<{ filename: string; markdown: string; entries: Term[] }>(
        'terminology',
        { action: 'export', manual },
      );
      download(
        json ? JSON.stringify(value.entries, null, 2) : value.markdown,
        json ? value.filename.replace('.md', '.json') : value.filename,
        json ? 'application/json' : 'text/markdown;charset=utf-8',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const prefs = data?.preferences;
  const results = (data?.entries || []).filter(
    (t) =>
      (!masteredOnly || prefs?.mastered.includes(t.id)) &&
      [t.name, t.english, ...t.aliases, ...t.category].some((v) =>
        v.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  return (
    <section className="settings-section" id="settings-terminology">
      <style>
        {cardStyles +
          `.term-preview{margin:18px 0;--term-bg:var(--background);--term-fg:var(--foreground);--term-muted:var(--muted-foreground);--term-border:var(--border)}.term-preview .term-card{width:100%;max-width:440px}.term-style-options{display:flex;gap:8px;flex-wrap:wrap}.term-style-options button{padding:7px 12px;border:1px solid var(--border);border-radius:8px}.term-style-options button[aria-pressed=true]{background:var(--muted);font-weight:600}.term-search{width:100%;margin:12px 0;padding:8px;border:1px solid var(--border);border-radius:8px}.term-results{max-height:300px;overflow:auto}.term-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;gap:12px;border-bottom:1px solid var(--border)}.term-row button{font-size:13px}.term-entry{display:grid;gap:10px;margin-top:14px}.term-entry input,.term-entry textarea{padding:8px;border:1px solid var(--border);border-radius:8px}.term-actions{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0}`}
      </style>
      <h2>术语释义</h2>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!prefs ? (
        <p>正在读取术语库…</p>
      ) : (
        <>
          <div className="settings-row">
            <label>
              <input
                type="checkbox"
                checked={prefs.enabled}
                disabled={busy}
                onChange={(e) =>
                  void command({
                    action: 'settings',
                    revision: prefs.revision,
                    enabled: e.target.checked,
                  })
                }
              />{' '}
              在聊天中标注术语
            </label>
          </div>
          <p className="settings-hint">
            细下划线 · 悬停查看释义 · Alt + Shift + T 打开当前可见术语
          </p>
          <div className="term-style-options" aria-label="卡片样式">
            {[
              ['plain', '简洁白卡'],
              ['frost', '磨砂卡'],
              ['note', '阅读批注'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={busy}
                aria-pressed={prefs.cardStyle === id}
                onClick={() =>
                  void command({ action: 'settings', revision: prefs.revision, cardStyle: id })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <Preview term={preview} style={prefs.cardStyle} />
          <details>
            <summary>识别与自动积累</summary>
            <div className="settings-row">
              <label>
                <input
                  type="checkbox"
                  checked={prefs.semantic}
                  disabled={busy}
                  onChange={(e) =>
                    void command({
                      action: 'settings',
                      revision: prefs.revision,
                      semantic: e.target.checked,
                    })
                  }
                />{' '}
                根据问答含义识别概念
              </label>
            </div>
            <div className="settings-row">
              <label>
                <input
                  type="checkbox"
                  checked={prefs.autoExpand}
                  disabled={busy}
                  onChange={(e) =>
                    void command({
                      action: 'settings',
                      revision: prefs.revision,
                      autoExpand: e.target.checked,
                    })
                  }
                />{' '}
                联网核对并补充缺失术语
              </label>
            </div>
            <p className="settings-hint">
              语义识别使用 Buddy
              配置的模型，独立处理当前一问一答；联网仅查询短术语名。当前查询公共百科，找不到可靠资料时不自动入库。结果不写回主聊天。
            </p>
          </details>
          <details>
            <summary>
              术语库 · {data.entries.length} 条 · 已掌握 {prefs.mastered.length} 条
            </summary>
            <input
              className="term-search"
              aria-label="搜索术语"
              placeholder="搜索名称、别名或分类"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={masteredOnly}
                onChange={(e) => setMasteredOnly(e.target.checked)}
              />{' '}
              只看已掌握
            </label>
            <div className="term-results">
              {results.slice(0, 80).map((t) => (
                <div className="term-row" key={t.id}>
                  <button type="button" onClick={() => setPreview(t)}>
                    {t.name}
                    {t.english !== t.name && <small> · {t.english}</small>}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void command({
                        action: prefs.mastered.includes(t.id) ? 'restore' : 'master',
                        id: t.id,
                      })
                    }
                  >
                    {prefs.mastered.includes(t.id) ? '恢复提示' : '已掌握'}
                  </button>
                </div>
              ))}
              {!results.length && <p>没有匹配的术语</p>}
            </div>
            {results.length > 80 && (
              <p className="settings-hint">
                匹配 {results.length} 条，显示前 80 条；输入更具体的名称可缩小范围。
              </p>
            )}
          </details>
          <details>
            <summary>手动添加</summary>
            <div className="term-entry">
              <input
                aria-label="中文术语名"
                placeholder="中文术语名"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                aria-label="英文名称"
                placeholder="英文名称（可选）"
                value={english}
                onChange={(e) => setEnglish(e.target.value)}
              />
              <textarea
                aria-label="中文释义"
                placeholder="中文释义"
                rows={3}
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !name.trim() || !definition.trim()}
                onClick={async () => {
                  if (
                    await command({
                      action: 'manual',
                      entries: [
                        {
                          id: 'manual',
                          name,
                          english,
                          definition,
                          aliases: [],
                          category: [],
                          example: '',
                          source: '',
                        },
                      ],
                    })
                  ) {
                    setName('');
                    setEnglish('');
                    setDefinition('');
                  }
                }}
              >
                自动分类并添加
              </button>
            </div>
            <p className="settings-hint">
              使用已配置模型分类。手动词条独立保存，分类失败保留输入。
            </p>
          </details>
          <details>
            <summary>导入与导出</summary>
            <div className="term-actions">
              <button type="button" onClick={() => void exportFile()}>
                导出术语文档
              </button>
              <button type="button" onClick={() => void exportFile(true)}>
                导出手动词条
              </button>
              <button type="button" onClick={() => void exportFile(false, true)}>
                导出可导入备份
              </button>
              <label>
                导入词库{' '}
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    setError('');
                    try {
                      if (file.size > 8_000_000) throw Error('文件过大');
                      const entries = JSON.parse(await file.text());
                      if (!Array.isArray(entries)) throw Error('请选择词条数组格式的 JSON 文件');
                      for (let i = 0; i < entries.length; i += 20)
                        await request('terminology', {
                          action: 'import',
                          entries: entries.slice(i, i + 20),
                        });
                      await load();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
