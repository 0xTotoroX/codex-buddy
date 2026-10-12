/* [INPUT]: 统一字体偏好和原外观修订保存回调。
 * [OUTPUT]: 跟随对象、相对大小与自定义字号；失败保留数字草稿。
 * [POS]: 字体设置唯一入口，不另建保存通道。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useState } from 'react';
import { defaultTypography, type TypographyPreferences } from '../shared/typography';
import { Field } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';
import { Input } from './components/ui/input';
export function TypographySettings({
  value,
  save,
}: {
  value?: TypographyPreferences;
  save: (value: TypographyPreferences) => Promise<unknown>;
}) {
  const p = { ...defaultTypography, ...value };
  const [scale, setScale] = useState(String(p.scale)),
    [size, setSize] = useState(String(p.customSize));
  const [error, setError] = useState('');
  useEffect(() => {
    setScale(String(p.scale));
  }, [p.scale]);
  useEffect(() => {
    setSize(String(p.customSize));
  }, [p.customSize]);
  async function commit(key: 'scale' | 'customSize', text: string) {
    const number = Number(text),
      min = key === 'scale' ? 75 : 10,
      max = key === 'scale' ? 150 : 32;
    if (!text.trim() || !Number.isFinite(number) || number < min || number > max) {
      setError(`请输入 ${min}–${max} 之间的数值`);
      return;
    }
    setError('');
    if (number !== p[key]) await save({ ...p, [key]: Math.round(number * 10) / 10 });
  }
  const navigation = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('[data-settings-navigation]');
  return (
    <>
      <Field id="typography-mode" label="字体大小">
        <NativeSelect
          id="typography-mode"
          value={p.mode}
          onChange={(e) =>
            void save({ ...p, mode: e.target.value as TypographyPreferences['mode'] })
          }
        >
          <option value="follow">跟随 Codex</option>
          <option value="custom">自定义字号</option>
        </NativeSelect>
      </Field>
      <div hidden={p.mode !== 'follow'}>
        <Field id="typography-source" label="跟随对象">
          <NativeSelect
            id="typography-source"
            value={p.source}
            onChange={(e) =>
              void save({ ...p, source: e.target.value as TypographyPreferences['source'] })
            }
          >
            <option value="body">聊天正文</option>
            <option value="session">左侧会话标题</option>
            <option value="composer">输入框文字</option>
          </NativeSelect>
        </Field>
        <Field id="typography-scale" label="相对大小（%）">
          <Input
            id="typography-scale"
            type="number"
            min={75}
            max={150}
            step={5}
            value={scale}
            onChange={(e) => setScale(e.target.value)}
            onBlur={(e) => {
              if (!navigation(e.relatedTarget)) void commit('scale', scale);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </Field>
      </div>
      <div hidden={p.mode !== 'custom'}>
        <Field id="typography-size" label="自定义字号（px）">
          <Input
            id="typography-size"
            type="number"
            min={10}
            max={32}
            step={1}
            value={size}
            onChange={(e) => setSize(e.target.value)}
            onBlur={(e) => {
              if (!navigation(e.relatedTarget)) void commit('customSize', size);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="settings-hint">
          {error}
        </p>
      )}
    </>
  );
}
