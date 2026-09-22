/*
 * [INPUT]: ui/contracts.ts 共享类型。
 * [OUTPUT]: 无聊天和凭据的标准设置、字体投影 fixture。
 * [POS]: 验收共用数据；形状由完整类型检查约束。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
/** @satisfies {import('../ui/contracts').Settings} */
export const fixtureSettings = {
  hostRestartPolicy: 'ask',
  popoutSupported: true,
  enabled: true,
  answerOutlineEnabled: true,
  generationMode: 'manual',
  provider: 'api',
  protocol: 'responses',
  model: 'fixture-model',
  baseUrl: 'http://127.0.0.1:1',
  apiKeyEnv: '',
  maxItems: 4,
  quickPrompts: [
    { label: '继续', prompt: '继续' },
    { label: '执行', prompt: '执行' },
  ],
  maxInputChars: 12000,
  maxOutputTokens: 2000,
  timeoutMs: 120000,
  apiKeyConfigured: true,
  storedApiKey: false,
  baseUrlConfigured: true,
  available: true,
  reason: '',
  configurationRevision: 1,
  generationRevision: 1,
  environmentOverrides: [],
};
/** @satisfies {import('../ui/contracts').HostTypography} */
export const fixtureTypography = {
  source: 'fixture',
  fontFamily: '-apple-system',
  fontWeight: 400,
  labelWeight: 500,
  hostFontSize: 15,
  baseItemFontSize: 13,
  chromeFontSize: 12,
  iconFontSize: 16,
};
