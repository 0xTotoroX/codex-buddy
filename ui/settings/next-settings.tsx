/* [INPUT]: 现有设置表单、认证 API 与共用设置控件。
 * [OUTPUT]: 下一步生成模型、方向、提示词与生成限制；沿用现有保存队列。
 * [POS]: 设置展示层，不执行后台业务或读取聊天正文。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useState } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import { NativeSelect } from './components/ui/native-select';
import { Field, FeatureSwitch } from './settings-controls';
import { request, type View, type EditableSettings } from './api';
import type { SettingsEditor } from './use-settings-form';
import { Eye, EyeOff, Plug, RefreshCw, LoaderCircle } from 'lucide-react';
import { DirectionSettings } from './direction-settings';
import { PanelSettings } from './panel-settings';
export function NextSettings({
  editor,
  appearance,
  notify,
}: {
  editor: SettingsEditor;
  appearance?: View['panelPreferences'];
  notify: (text: string, failed?: boolean) => void;
}) {
  const {
    form,
    saved,
    change,
    schedule,
    dirty,
    save,
    remoteChanged,
    apiKey,
    clearKey,
    setApiKey,
    setClearKey,
    jevApiKey,
    clearJevKey,
    setJevApiKey,
    setClearJevKey,
  } = editor;
  const [showKey, setShowKey] = useState(false),
    [models, setModels] = useState<string[]>([]),
    [busy, setBusy] = useState('');
  async function run(name: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(name);
    try {
      await action();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy('');
    }
  }
  async function test() {
    if (dirty) await save();
    const r = await request<{ items: unknown[]; generationAttempted: boolean }>(
      'settings/test',
      {},
    );
    notify(
      r.generationAttempted === false
        ? '示例没有合适方向，生成服务尚未验证。'
        : `连接正常，已生成 ${r.items.length} 条测试建议。`,
    );
  }
  if (!form || !saved) return null;
  return (
    <>
      <div className="settings-section">
        <FeatureSwitch
          name="下一步"
          checked={form.enabled}
          onChange={(v) => change('enabled', v)}
          onOpen={() =>
            void request('features', { op: 'reveal', id: 'next' }).catch((e) =>
              notify(e.message, true),
            )
          }
        />
        <Field id="generation-mode" label="建议生成方式">
          <NativeSelect
            id="generation-mode"
            value={form.generationMode}
            onChange={(e) => change('generationMode', e.target.value as 'auto' | 'manual')}
          >
            <option value="manual">手动刷新</option>
            <option value="auto">自动生成</option>
          </NativeSelect>
        </Field>
        <PanelSettings value={appearance} section="next" />
      </div>
      <Card tabIndex={-1} id="settings-model" aria-labelledby="model-title">
        <h2 id="model-title">生成模型</h2>
        {saved.environmentOverrides.length > 0 && (
          <div className="mb-4 rounded-[9px] border border-notice-border bg-notice px-[13px] py-[11px] text-[14px] leading-[1.8] text-notice-foreground [overflow-wrap:anywhere]">
            当前进程环境变量优先：{saved.environmentOverrides.join('、')}
            。修改对应字段后需去掉环境覆盖并重启。
          </div>
        )}
        <Field id="provider" label="模型来源">
          <NativeSelect
            id="provider"
            value={form.provider}
            onChange={(e) => change('provider', e.target.value as 'codex' | 'api')}
          >
            <option value="codex">现有 Codex 登录</option>
            <option value="api">指定 API</option>
          </NativeSelect>
        </Field>
        {form.provider === 'api' && (
          <>
            <Field id="protocol" label="API 协议">
              <NativeSelect
                id="protocol"
                value={form.protocol}
                onChange={(e) => change('protocol', e.target.value as EditableSettings['protocol'])}
              >
                <option value="responses">OpenAI Responses</option>
                <option value="chat_completions">Chat Completions</option>
                <option value="anthropic_messages">Anthropic Messages</option>
                <option value="auto">自动识别</option>
              </NativeSelect>
            </Field>
            <Field id="base-url" label="API 地址" hint="填写 API 根地址或完整请求端点。">
              <Input
                id="base-url"
                type="url"
                value={form.baseUrl}
                onChange={(e) => change('baseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
            </Field>
            <Field
              id="api-key"
              label="API 密钥"
              hint={
                saved.apiKeyConfigured
                  ? '已配置。留空保留现有密钥，保存后不会回显。'
                  : '密钥只保存在本机后台，桌面浮窗不会收到密钥。'
              }
            >
              <div className="relative flex items-center [&_input]:pr-[43px]">
                <Input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setClearKey(false, false);
                  }}
                  placeholder={saved.storedApiKey ? '已保存 · 留空保留' : '输入 API key'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1"
                  aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
            </Field>
            {saved.storedApiKey && (
              <label className="-mt-1.5 mb-5 flex items-center gap-1.5 text-[14px] text-muted-foreground [&_input]:accent-primary">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(e) => {
                    setClearKey(e.target.checked);
                  }}
                />
                保存时清除已存密钥
              </label>
            )}
            <Field
              id="api-key-env"
              label="或使用密钥环境变量"
              hint="填写变量名，读取后台进程的环境；环境值优先于已存密钥。"
            >
              <Input
                id="api-key-env"
                value={form.apiKeyEnv}
                onChange={(e) => change('apiKeyEnv', e.target.value)}
                placeholder="CODEX_BUDDY_API_KEY"
                spellCheck={false}
              />
            </Field>
          </>
        )}
        <Field
          id="model"
          label="模型名称"
          hint={
            form.provider === 'codex'
              ? '留空沿用 Codex 当前模型。'
              : '可以手动输入，或保存连接后读取可用模型。'
          }
        >
          <div className="relative flex items-center [&_input]:pr-[110px]">
            <Input
              id="model"
              value={form.model}
              list="available-models"
              onChange={(e) => change('model', e.target.value)}
              placeholder={form.provider === 'codex' ? '沿用当前模型' : '模型 ID'}
              spellCheck={false}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="absolute right-[5px]"
              disabled={!!busy || dirty}
              onClick={() =>
                void run('models', async () => {
                  const result = await request<{ models: string[] }>('settings/models');
                  setModels(result.models);
                  notify(`已读取 ${result.models.length} 个模型，可在模型输入框中选择。`);
                })
              }
            >
              <RefreshCw
                size={14}
                className={busy === 'models' ? 'animate-spin [animation-duration:1.2s]' : ''}
              />
              读取模型
            </Button>
          </div>
          <datalist id="available-models">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </Field>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          {!saved.available && <p className="settings-error">{saved.reason || '等待配置'}</p>}
          <Button
            type="button"
            variant="outline"
            disabled={!!busy || remoteChanged}
            onClick={() => void run('test', test)}
          >
            {busy === 'test' ? (
              <LoaderCircle className="animate-spin [animation-duration:1.2s]" size={15} />
            ) : (
              <Plug size={15} />
            )}
            {busy === 'test' ? '正在测试…' : dirty ? '保存并测试' : '测试连接'}
          </Button>
        </div>
        <p className="mt-[7px] text-[14px] leading-[1.7] text-muted-foreground">
          连接测试使用固定示例，不读取你的聊天。
        </p>
      </Card>
      <DirectionSettings
        form={form}
        saved={saved}
        change={change}
        schedule={schedule}
        apiKey={jevApiKey}
        clearKey={clearJevKey}
        setApiKey={setJevApiKey}
        setClearKey={setClearJevKey}
      />
      <Card tabIndex={-1} id="settings-quick-prompts" aria-labelledby="quick-prompts-title">
        <h2 id="quick-prompts-title" className="mb-2 text-[15px] font-semibold">
          常用提示词
        </h2>
        <p className="mb-4 text-[14px] text-muted-foreground">
          显示在下一步面板中，点击只填入，不自动发送。
        </p>
        <div className="space-y-3">
          {form.quickPrompts.map((item, index) => (
            <div
              key={index}
              className="grid grid-cols-[120px_minmax(0,1fr)_auto] gap-3 items-start max-[600px]:grid-cols-[minmax(0,1fr)_auto] [&>textarea]:max-[600px]:col-span-full [&>textarea]:max-[600px]:row-start-2"
            >
              <Input
                aria-label={`常用提示词 ${index + 1} 名称`}
                value={item.label}
                maxLength={20}
                required
                onChange={(e) =>
                  change(
                    'quickPrompts',
                    form.quickPrompts.map((p, i) =>
                      i === index ? { ...p, label: e.target.value } : p,
                    ),
                  )
                }
              />
              <textarea
                aria-label={`常用提示词 ${index + 1} 内容`}
                value={item.prompt}
                maxLength={4000}
                required
                rows={2}
                className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-[14px]"
                onChange={(e) =>
                  change(
                    'quickPrompts',
                    form.quickPrompts.map((p, i) =>
                      i === index ? { ...p, prompt: e.target.value } : p,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                aria-label={`删除常用提示词 ${index + 1}`}
                onClick={() => {
                  change(
                    'quickPrompts',
                    form.quickPrompts.filter((_, i) => i !== index),
                  );
                  schedule();
                }}
              >
                删除
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={form.quickPrompts.length >= 8}
            onClick={() =>
              change('quickPrompts', [...form.quickPrompts, { label: '', prompt: '' }])
            }
          >
            添加提示词
          </Button>
        </div>
      </Card>
      <details id="settings-limits" className="settings-section">
        <summary>高级生成设置</summary>
        <div className="space-y-5">
          <Field id="context-scope" label="输入上下文" hint="最近一次提问与回答，不包含更早历史。">
            <NativeSelect
              id="context-scope"
              value={form.maxInputChars === 0 ? 'latest' : 'limited'}
              onChange={(e) => change('maxInputChars', e.target.value === 'latest' ? 0 : 12000)}
            >
              <option value="latest">最近一次聊天（完整）</option>
              <option value="limited">自定义字符上限</option>
            </NativeSelect>
          </Field>
          {form.maxInputChars !== 0 && (
            <Field id="max-input" label="输入字符上限">
              <Input
                id="max-input"
                type="number"
                min="500"
                max="32000"
                step="100"
                value={form.maxInputChars}
                onChange={(e) => change('maxInputChars', Number(e.target.value))}
              />
            </Field>
          )}
          {form.provider === 'api' && (
            <Field id="max-output" label="输出 token 上限">
              <Input
                id="max-output"
                type="number"
                min="128"
                max="16000"
                step="1"

                value={form.maxOutputTokens}
                onChange={(e) => change('maxOutputTokens', Number(e.target.value))}
              />
            </Field>
          )}
          <Field id="timeout" label="请求超时（秒）">
            <Input
              id="timeout"
              type="number"
              min="1"
              max="300"
              value={form.timeoutMs / 1000}
              onChange={(e) => change('timeoutMs', Number(e.target.value) * 1000)}
            />
          </Field>
        </div>
      </details>
    </>
  );
}
