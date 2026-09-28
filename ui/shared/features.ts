/* [INPUT]: Authenticated feature transport and shared business DTOs.
 * [OUTPUT]: Four-feature placement, default content fonts, recursive split geometry and transient view contracts.
 * [POS]: Presentation boundary. [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import type { BoardView } from '../features/board/app';
export const titles = { outline: '大纲', board: '看板', next: '下一步', model: '模型快切' };
export type FeatureId = keyof typeof titles;
export type FontSizes = Partial<Record<FeatureId, number>>;
export const defaultFontSizes: Record<FeatureId, number> = {
  outline: 16,
  next: 16,
  board: 15,
  model: 14,
};
export function featureFontSize(id: FeatureId, sizes?: FontSizes, legacySize?: number) {
  const size =
    sizes?.[id] ??
    (['outline', 'next'].includes(id) ? legacySize : undefined) ??
    defaultFontSizes[id];
  return Math.round(Math.max(10, Math.min(24, size)) * 10) / 10;
}
export type Placement = 'sidebar' | 'overlay' | 'desktop' | 'edge';
export type Reading = {
  token?: string;
  top?: number;
  left?: number;
  selected?: number;
  previewTop?: number;
  board?: BoardView;
  modelSearch?: string;
  modelTools?: boolean;
  modelOthers?: boolean;
  modelLeft?: number;
};
export type Entry = {
  id: FeatureId;
  desktopSupported?: boolean;
  placement: Placement;
  returnPlacement?: Placement;
  open: boolean;
  closing?: boolean;
  owner: string;
  size: [number, number];
  reveal: number;
  view: Reading;
  pending: { placement: Placement; owner: string; ready: boolean } | null;
};
export type LayoutGroup = { ids: string[]; active: string; weight: number };
export type LayoutNode = LayoutGroup | (FeatureLayout & { weight: number });
export type FeatureLayout = { axis: string; groups: LayoutNode[] };
export type FeatureState = {
  layouts?: Record<string, FeatureLayout>;
  legacyLayouts?: Record<string, import('./contracts').WorkbenchLayout>;
  activeFeature?: string;
  mainPlacement?: Placement;
  returnPlacement?: Placement;
  pendingPlacement?: Placement | null;
  mainWindow?: { lease: string; pid?: number | null; size: [number, number] };
  features: Entry[];
  appearance?: {
    theme?: string | null;
    fontSize?: number;
    colors?: Record<string, string>;
    themes: Record<string, import('../surfaces/theme/appearance').SurfaceTheme>;
  };
};
export type Request = <T = FeatureState>(input: Record<string, unknown>) => Promise<T>;
