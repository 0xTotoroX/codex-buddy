/* [INPUT]: Authenticated feature transport and shared business DTOs.
 * [OUTPUT]: Four-feature placement, recursive split geometry and transient view contracts.
 * [POS]: Presentation boundary. [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import type { BoardView } from '../features/board/app';
export const titles = { outline: '大纲', board: '看板', next: '下一步', model: '模型快切' };
export type FeatureId = keyof typeof titles;
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
