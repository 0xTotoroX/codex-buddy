/* [INPUT]: 认证术语 API、可唤起状态、共用卡片/动作图标与用户导入/输入。
 * [OUTPUT]: 直接显示识别、预览、检索和掌握列表；统一词库管理入口，导入先确认覆盖影响。
 * [POS]: 详细设置的功能区，不访问主聊天内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { useConfirmation } from './settings-confirmation';
import { request } from './api';
import { inheritedAppearance } from '../terminology/appearance.js';
import { NativeSelect } from './components/ui/native-select';
import { Button } from './components/ui/button';
import { Switch } from './components/ui/switch';
import { Icon } from '../shared/icons/react';
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
    jumpOnClick?: boolean;
    cardStyle: string;
    cardMaterial?: string | null;
    cardLiquidVariant?: string;
    cardCustomColor?: string;
    cardWidth?: number;
    mastered: string[];
    favorites: string[];
    revision: number;
  };
};
const sample: Term = {
  id: 'sample',
  name: '竞态条件',
  english: 'Race Condition',
  definition: '多个操作的执行先后不可预测，最终结果随完成顺序变化。',
  aliases: [],
  category: ['程序基础与执行机制', '管理运行与并发'],
  example: '',
  source: '',
};
function Preview({ term, preferences }: { term: Term; preferences: Library['preferences'] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current!;
    const card = createCard(term, {
      preferences,
      appearance: inheritedAppearance(node),
      locked: true,
    });
    node.replaceChildren(card);
    return () => {
      card.dispose();
      node.replaceChildren();
    };
  }, [term, preferences]);
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
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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
  const { confirm, confirmation } = useConfirmation(prefs?.revision, busy);
  const results = (data?.entries || []).filter(
    (t) =>
      (!masteredOnly || prefs?.mastered.includes(t.id)) &&
      (!favoritesOnly || prefs?.favorites?.includes(t.id)) &&
      [t.name, t.english, ...t.aliases, ...t.category].some((v) =>
        v.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  return (
    <section className="settings-section" id="settings-terminology">
      {confirmation}
      <style>
        {cardStyles +
          `.term-preview{margin:18px 0;--term-bg:var(--background);--term-fg:var(--foreground);--term-muted:var(--muted-foreground);--term-border:var(--border)}.term-preview .term-card{max-width:100%}.term-style-options{display:flex;gap:8px;flex-wrap:wrap}.term-style-options button{padding:7px 12px;border:1px solid var(--border);border-radius:8px}.term-style-options button[aria-pressed=true]{background:var(--muted);font-weight:600}.term-search{width:100%;margin:12px 0;padding:8px;border:1px solid var(--border);border-radius:8px}.term-results{max-height:300px;overflow:auto}.term-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;gap:12px;border-bottom:1px solid var(--border)}.term-row button{font-size:13px}.term-entry{display:grid;gap:10px;margin-top:14px}.term-entry input,.term-entry textarea{padding:8px;border:1px solid var(--border);border-radius:8px}.term-actions{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0}`}
      </style>
      <div className="settings-section-heading">
        <h2>术语释义</h2>
      </div>
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
          <div className="settings-row">
            <label htmlFor="terms-jump-on-click">点击术语时跳转到上下文</label>
            <Switch
              id="terms-jump-on-click"
              checked={prefs.jumpOnClick ?? false}
              disabled={busy}
              onCheckedChange={(jumpOnClick) =>
                void command({ action: 'settings', revision: prefs.revision, jumpOnClick })
              }
            />
          </div>
          <div className="term-style-options">
            <label>
              背景材质
              <NativeSelect
                aria-label="术语卡片背景"
                disabled={busy}
                value={prefs.cardMaterial || (prefs.cardStyle === 'frost' ? 'frosted' : 'matte')}
                onChange={(e) =>
                  void command({
                    action: 'settings',
                    revision: prefs.revision,
                    cardMaterial: e.target.value,
                  })
                }
              >
                <option value="matte">哑光</option>
                <option value="frosted">磨砂</option>
                <option value="native-glass">液态</option>
                <option value="black">纯黑</option>
                <option value="custom">自定义</option>
              </NativeSelect>
            </label>
            {prefs.cardMaterial === 'native-glass' && (
              <label>
                液态变体
                <NativeSelect
                  aria-label="术语卡片液态变体"
                  disabled={busy}
                  value={prefs.cardLiquidVariant || 'regular'}
                  onChange={(e) =>
                    void command({
                      action: 'settings',
                      revision: prefs.revision,
                      cardLiquidVariant: e.target.value,
                    })
                  }
                >
                  <option value="regular">Regular</option>
                  <option value="clear">Clear</option>
                </NativeSelect>
              </label>
            )}
            {prefs.cardMaterial === 'custom' && (
              <label>
                背景颜色
                <input
                  type="color"
                  aria-label="术语卡片自定义颜色"
                  disabled={busy}
                  value={prefs.cardCustomColor || '#33333a'}
                  onChange={(e) =>
                    void command({
                      action: 'settings',
                      revision: prefs.revision,
                      cardCustomColor: e.target.value,
                    })
                  }
                />
              </label>
            )}
          </div>
          <Preview term={preview} preferences={prefs} />
          <section className="settings-subsection">
            <h3>识别与自动积累</h3>
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
                结合问答核对词义与识别概念
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
            <p className="settings-hint">语义识别使用已配置模型处理当前问答；联网仅查询术语名。</p>
          </section>
          <section className="settings-subsection">
            <h3>
              术语库 · {data.entries.length} 条 · 已掌握 {prefs.mastered.length} 条
            </h3>
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
            <label>
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(e) => setFavoritesOnly(e.target.checked)}
              />{' '}
              只看收藏
            </label>
            <div className="term-results">
              {results.slice(0, 80).map((t) => (
                <div className="term-row" key={t.id}>
                  <button type="button" onClick={() => setPreview(t)}>
                    {t.name}
                    {t.english !== t.name && <small> · {t.english}</small>}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${prefs.mastered.includes(t.id) ? '恢复提示' : '已掌握'}：${t.name}`}
                    disabled={busy}
                    onClick={() =>
                      void command({
                        action: prefs.mastered.includes(t.id) ? 'restore' : 'master',
                        id: t.id,
                      })
                    }
                  >
                    <Icon name={prefs.mastered.includes(t.id) ? 'return' : 'check'} />
                  </Button>
                </div>
              ))}
              {!results.length && <p>没有匹配的术语</p>}
            </div>
            {results.length > 80 && (
              <p className="settings-hint">
                匹配 {results.length} 条，显示前 80 条；输入更具体的名称可缩小范围。
              </p>
            )}
          </section>
          <details>
            <summary>词库管理</summary>
            <h3 className="mt-4">添加自定义术语</h3>
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
            <p className="settings-hint">使用已配置模型分类。</p>
            <h3 className="mt-5">导入与导出</h3>
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
                    const input = e.target;
                    input.value = '';
                    setError('');
                    try {
                      if (file.size > 8_000_000) throw Error('文件过大');
                      const entries = JSON.parse(await file.text());
                      if (!Array.isArray(entries) || !entries.length)
                        throw Error('请选择包含词条的 JSON 数组');
                      confirm({
                        title: `导入 ${entries.length} 条术语？`,
                        description: `将从“${file.name}”合并词条，相同编号的已有释义会被替换；其他词条与掌握记录保留。建议先导出备份。`,
                        confirmLabel: '确认导入',
                        action: async () => {
                          setBusy(true);
                          let imported = 0;
                          try {
                            for (let i = 0; i < entries.length; i += 20) {
                              await request('terminology', {
                                action: 'import',
                                entries: entries.slice(i, i + 20),
                              });
                              imported += Math.min(20, entries.length - i);
                            }
                          } catch (error) {
                            throw Error(
                              `已导入 ${imported} 条，其余未完成：${(error as Error).message}`,
                            );
                          } finally {
                            await load();
                            setBusy(false);
                          }
                        },
                      });
                    } catch (err) {
                      setError((err as Error).message);
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
