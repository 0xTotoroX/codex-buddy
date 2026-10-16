/* [INPUT]: 模型状态、带修订校验的保存与刷新操作、共用自由输入候选控件与操作图标。
 * [OUTPUT]: 可折叠的自定义模型分组，包含厂家纠正、批量归属与稳定排序。
 * [POS]: 只管理模型展示偏好，不切换模型或修改预设。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useState } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { SuggestionInput } from './components/ui/suggestion-input';
import { Icon } from '../shared/icons/react';
import {
  automaticManufacturer,
  manufacturer,
  manufacturerNames,
  groupedModels,
  moveItem,
  orderedModelIds,
  type Model,
  type ModelState,
  type ModelPreferences,
  type ModelOverride,
} from '../features/model/catalog';

export function ModelOrganization({
  state,
  busy,
  save,
  refresh,
}: {
  state: ModelState;
  busy: boolean;
  save: (patch: Partial<ModelPreferences>) => Promise<boolean>;
  refresh: () => Promise<void>;
}) {
  const prefs = state.preferences;
  const [selected, setSelected] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [maker, setMaker] = useState('');
  const [destination, setDestination] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const available = state.snapshot.models;
  const remembered = [
    ...new Set([
      ...(prefs.modelOrder || []),
      ...prefs.pinned,
      ...Object.keys(prefs.modelOverrides || {}),
      ...prefs.presets.map((p) => p.selection.model),
    ]),
  ];
  const models: Model[] = [
    ...available,
    ...remembered
      .filter((id) => !available.some((m) => m.id === id))
      .map((id) => ({ id, label: id, reasoning: [], fast: false })),
  ];
  const groups = groupedModels(models, prefs, true);
  const order = orderedModelIds(models, prefs);
  const groupOrder = [...new Set([...(prefs.groupOrder || []), ...groups.map((g) => g.id)])];
  const blocked = busy || !selected.length;
  async function updateSelected(update: (value: ModelOverride) => ModelOverride) {
    const overrides = { ...prefs.modelOverrides };
    for (const id of selected) {
      const value = update({ ...overrides[id] });
      if (value.manufacturer || value.groupId) overrides[id] = value;
      else delete overrides[id];
    }
    await save({ modelOverrides: overrides });
  }
  async function deleteGroup(id: string) {
    const overrides = Object.fromEntries(
      Object.entries(prefs.modelOverrides || {}).map(([key, item]) => {
        const next = { ...item };
        if (next.groupId === id) delete next.groupId;
        return [key, next];
      }),
    );
    if (
      await save({
        groups: (prefs.groups || []).filter((g) => g.id !== id),
        modelOverrides: overrides,
        groupOrder: groupOrder.filter((key) => key !== `custom:${id}`),
        expandedGroups: prefs.expandedGroups?.filter((key) => key !== `custom:${id}`),
      })
    ) {
      if (destination === id) setDestination('');
    }
  }
  return (
    <details id="model-organization" className="settings-details mt-3">
      <summary>自定义模型分组</summary>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="刷新可用模型"
            disabled={busy || !prefs.enabled}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" />
          </Button>
          <span className="text-muted-foreground">{available.length} 个可用模型</span>
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save({
              groups: [...(prefs.groups || []), { id: crypto.randomUUID(), name: newName.trim() }],
            }).then((ok) => {
              if (ok) setNewName('');
            });
          }}
        >
          <Input
            className="min-w-0 flex-1 basis-40"
            aria-label="新模型分组名称"
            placeholder="新分组名称"
            maxLength={60}
            disabled={busy}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            size="icon"
            aria-label="新增分组"
            disabled={busy || !newName.trim()}
          >
            <Icon name="plus" />
          </Button>
        </form>
        <fieldset disabled={busy} className="space-y-3">
          <legend className="mb-2">
            批量调整{selected.length ? ` · 已选 ${selected.length} 个` : ''}
          </legend>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelected(models.map((m) => m.id))}
              disabled={!models.length}
            >
              全选
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelected([])}
              disabled={!selected.length}
            >
              取消选择
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={blocked}
              onClick={() => void updateSelected(() => ({}))}
            >
              恢复自动分类
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-40 space-y-1">
              厂家
              <SuggestionInput
                aria-label="批量指定厂家"
                options={manufacturerNames}
                placeholder="选择或填写厂家"
                maxLength={60}
                value={maker}
                onValueChange={setMaker}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="指定厂家"
              disabled={blocked || !maker.trim()}
              onClick={() =>
                void updateSelected((value) => ({ ...value, manufacturer: maker.trim() }))
              }
            >
              <Icon name="check" />
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-40 space-y-1">
              展示分组
              <NativeSelect
                aria-label="批量移动分组"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">按厂家归类</option>
                {(prefs.groups || []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="移动模型"
              disabled={
                blocked || (!!destination && !prefs.groups?.some((g) => g.id === destination))
              }
              onClick={() =>
                void updateSelected((value) => {
                  delete value.groupId;
                  return destination ? { ...value, groupId: destination } : value;
                })
              }
            >
              <Icon name="check" />
            </Button>
          </div>
        </fieldset>
        {!models.length && (
          <p className="text-muted-foreground">暂无模型。开启模型快切后刷新可用列表。</p>
        )}
        {groups.map((group, index) => {
          const custom = prefs.groups?.find((g) => `custom:${g.id}` === group.id);
          return (
            <section key={group.id} className="space-y-2" aria-label={`分组：${group.name}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto font-medium">
                  {group.name} · {group.models.length}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || !index}
                  aria-label={`上移分组 ${group.name}`}
                  size="icon"
                  onClick={() =>
                    void save({ groupOrder: moveItem(groupOrder, group.id, groups[index - 1].id) })
                  }
                >
                  <Icon name="arrow-up" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || index === groups.length - 1}
                  aria-label={`下移分组 ${group.name}`}
                  size="icon"
                  onClick={() =>
                    void save({ groupOrder: moveItem(groupOrder, group.id, groups[index + 1].id) })
                  }
                >
                  <Icon name="arrow-down" />
                </Button>
              </div>
              {custom && (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save({
                      groups: prefs.groups!.map((g) =>
                        g.id === custom.id ? { ...g, name: (names[g.id] ?? g.name).trim() } : g,
                      ),
                    }).then((ok) => {
                      if (ok)
                        setNames((drafts) => {
                          const next = { ...drafts };
                          delete next[custom.id];
                          return next;
                        });
                    });
                  }}
                >
                  <Input
                    className="min-w-0 flex-1 basis-32"
                    aria-label={`分组名称 ${custom.name}`}
                    maxLength={60}
                    disabled={busy}
                    value={names[custom.id] ?? custom.name}
                    onChange={(e) => setNames({ ...names, [custom.id]: e.target.value })}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={`保存分组名称 ${custom.name}`}
                    disabled={
                      busy ||
                      !(names[custom.id] || '').trim() ||
                      names[custom.id]?.trim() === custom.name
                    }
                  >
                    <Icon name="check" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void deleteGroup(custom.id)}
                    size="icon"
                    aria-label={`删除分组 ${custom.name}`}
                  >
                    <Icon name="trash" />
                  </Button>
                </form>
              )}
              {group.models.map((model, i) => {
                const manual = prefs.modelOverrides?.[model.id];
                const offline = !available.some((m) => m.id === model.id);
                return (
                  <div key={model.id} className="model-organization-row" data-model-id={model.id}>
                    <label className="flex min-w-0 flex-1 items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        aria-label={`选择 ${model.label}`}
                        checked={selected.includes(model.id)}
                        disabled={busy}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, model.id]
                              : selected.filter((id) => id !== model.id),
                          )
                        }
                      />
                      <span className="min-w-0 break-words">
                        {model.label}
                        {models.some(
                          (other) => other.id !== model.id && other.label === model.label,
                        ) && (
                          <span className="block break-all text-muted-foreground">{model.id}</span>
                        )}
                        <span className="block text-muted-foreground">
                          {manufacturer(model, prefs) || '未分类'}
                          {manual?.manufacturer || manual?.groupId ? ' · 手动' : ''}
                          {prefs.pinned.includes(model.id) ? ' · 常用' : ''}
                          {offline ? ' · 暂不可用' : ''}
                        </span>
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`上移模型 ${model.label}`}
                        size="icon"
                        disabled={busy || !i}
                        onClick={() =>
                          void save({
                            modelOrder: moveItem(order, model.id, group.models[i - 1].id),
                          })
                        }
                      >
                        <Icon name="arrow-up" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`下移模型 ${model.label}`}
                        size="icon"
                        disabled={busy || i === group.models.length - 1}
                        onClick={() =>
                          void save({
                            modelOrder: moveItem(order, model.id, group.models[i + 1].id),
                          })
                        }
                      >
                        <Icon name="arrow-down" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-expanded={detail === model.id}
                        aria-label={`详情 ${model.label}`}
                        size="icon"
                        onClick={() => setDetail(detail === model.id ? null : model.id)}
                      >
                        <Icon name="more" />
                      </Button>
                    </div>
                    {detail === model.id && (
                      <div className="basis-full space-y-2 break-all text-muted-foreground">
                        <div>{model.id}</div>
                        <div>自动识别：{automaticManufacturer(model) || '未分类'}</div>
                        {(manual?.manufacturer || manual?.groupId) && (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              const overrides = { ...prefs.modelOverrides };
                              delete overrides[model.id];
                              void save({ modelOverrides: overrides });
                            }}
                          >
                            恢复自动
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </details>
  );
}
