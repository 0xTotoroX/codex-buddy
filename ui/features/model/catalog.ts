/* [INPUT]: 宿主模型能力与独立模型偏好；不读取接入凭据或聊天。
 * [OUTPUT]: 共用模型类型、保守厂家识别、稳定分组及顺序，以及不合并预设身份的名称消歧。
 * [POS]: 快切与设置共用的纯分类逻辑，不执行切换或保存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export type Selection = { model: string; reasoning: string; speed: string };
export type Model = { id: string; label: string; reasoning: string[]; fast: boolean };
export type ModelOverride = { manufacturer?: string; groupId?: string };
export type ModelPreferences = {
  enabled: boolean;
  modelColumnWidth?: number;
  pinned: string[];
  modelOrder?: string[] | null;
  presets: { id: string; name: string; selection: Selection }[];
  groups?: { id: string; name: string }[];
  modelOverrides?: Record<string, ModelOverride>;
  groupOrder?: string[];
  expandedGroups?: string[] | null;
};
export type ModelState = {
  revision: number;
  snapshot: {
    target: unknown;
    revision: string;
    status: string;
    message: string;
    current: Selection | null;
    models: Model[];
  };
  preferences: ModelPreferences;
};
// 预设身份和选择独立；只对名称消歧，不合并同模型或同配置的收藏。
const presetNameKey = (name: string) => name.trim().normalize('NFC').toLowerCase();
const presetNameLimit = (name: string, suffix = '') => {
  const chars = [...name.trim()];
  const encoder = new TextEncoder();
  while (encoder.encode(chars.join('') + suffix).length > 256) chars.pop();
  return chars.join('').trimEnd() + suffix;
};
export function uniquePresetName(name: string, existing: readonly { name: string }[]): string {
  const used = new Set(existing.map((p) => presetNameKey(p.name)));
  const base = presetNameLimit(name);
  let candidate = base;
  for (let n = 2; used.has(presetNameKey(candidate)); n++)
    candidate = presetNameLimit(base, ` ${n}`);
  return candidate;
}
export function uniquePresetNames(
  presets: ModelPreferences['presets'],
): ModelPreferences['presets'] {
  const seen = new Set<string>();
  const result: ModelPreferences['presets'] = [];
  for (const preset of presets) {
    const name = seen.has(presetNameKey(preset.name))
      ? uniquePresetName(preset.name, [...presets, ...result])
      : preset.name;
    seen.add(presetNameKey(name));
    result.push(name === preset.name ? preset : { ...preset, name });
  }
  return result;
}
const manufacturers = [
  ['OpenAI', /^(?:gpt(?:[-\s]|\d)|chatgpt(?:[-\s]|$)|o[134](?:[-\s]|$))/i],
  ['Anthropic', /^claude(?:[-\s]|$)/i],
  ['Google', /^(?:gemini|gemma)(?:[-\s]|$)/i],
  ['DeepSeek', /^deepseek(?:[-\s]|$)/i],
  ['阿里云', /^qwen(?:[-\s]|\d|$)/i],
  ['智谱', /^glm(?:[-\s]|\d|$)/i],
  ['月之暗面', /^(?:kimi|moonshot)(?:[-\s]|$)/i],
  ['xAI', /^grok(?:[-\s]|$)/i],
  ['MiniMax', /^minimax(?:[-\s]|$)/i],
  ['阶跃星辰', /^step(?:[-\s]|\d|$)/i],
  ['腾讯', /^(?:hunyuan|hy[234])(?:[-\s]|$)/i],
  ['Meta', /^llama(?!.*nemotron)(?:[-\s]|\d|$)/i],
  ['Mistral', /^(?:mistral|mixtral|codestral|devstral|magistral)(?:[-\s]|$)/i],
  ['百度', /^ernie(?:[-\s]|\d|$)/i],
  ['字节跳动', /^(?:doubao|seed)(?:[-\s]|\d|$)/i],
  ['小米', /^mimo(?:[-\s]|$)/i],
  ['Amazon', /^(?:(?:(?:us|eu|apac|global)\.)?amazon[.\s-])?nova(?:[-\s]|$)/i],
  ['Cohere', /^(?:cohere[.\s-])?command(?:[-\s]|$)/i],
  ['Microsoft', /^(?:phi|mai)(?:[-\s]|\d|$)/i],
  ['NVIDIA', /^(?:(?:nvidia[-\s])?nemotron|llama[-\d.]*[-\s]nemotron)(?:[-\s]|$)/i],
] as const;
export const manufacturerNames = manufacturers.map(([name]) => name);
export function automaticManufacturer(model: Model): string {
  // 渠道前缀不代表厂家。只识别末段模型系列，名称冲突时保留未分类。
  const names = [model.id, model.label].map((value) =>
    (value.split('/').at(-1) || '').trim().replaceAll('_', '-'),
  );
  const matches = manufacturers.filter(([, pattern]) => names.some((name) => pattern.test(name)));
  return matches.length === 1 ? matches[0][0] : '';
}
export function manufacturer(model: Model, prefs: ModelPreferences): string {
  return prefs.modelOverrides?.[model.id]?.manufacturer || automaticManufacturer(model);
}
export function modelGroup(model: Model, prefs: ModelPreferences) {
  const custom = prefs.groups?.find((g) => g.id === prefs.modelOverrides?.[model.id]?.groupId);
  const maker = manufacturer(model, prefs);
  return custom
    ? { id: `custom:${custom.id}`, name: custom.name }
    : { id: maker ? `vendor:${maker}` : 'unknown', name: maker || '未分类' };
}
export function orderedModelIds(models: Model[], prefs: ModelPreferences) {
  return [...new Set([...(prefs.modelOrder || prefs.pinned), ...models.map((m) => m.id)])];
}
export function groupedModels(models: Model[], prefs: ModelPreferences, includeEmpty = false) {
  const groups = new Map<string, { id: string; name: string; models: Model[] }>();
  if (includeEmpty)
    for (const group of prefs.groups || [])
      groups.set(`custom:${group.id}`, { id: `custom:${group.id}`, name: group.name, models: [] });
  const byId = new Map(models.map((model) => [model.id, model]));
  for (const id of orderedModelIds(models, prefs)) {
    const model = byId.get(id);
    if (!model) continue;
    const group = modelGroup(model, prefs);
    if (!groups.has(group.id)) groups.set(group.id, { ...group, models: [] });
    groups.get(group.id)!.models.push(model);
  }
  const fallback = [...groups.keys()].sort((a, b) =>
    a === 'unknown' ? 1 : b === 'unknown' ? -1 : a.localeCompare(b, 'en'),
  );
  return [...new Set([...(prefs.groupOrder || []), ...fallback])].flatMap((id) => {
    const group = groups.get(id);
    return group ? [group] : [];
  });
}
export function moveItem(order: string[], id: string, neighbor: string) {
  const next = [...order];
  const a = next.indexOf(id),
    b = next.indexOf(neighbor);
  if (a >= 0 && b >= 0) [next[a], next[b]] = [next[b], next[a]];
  return next;
}
