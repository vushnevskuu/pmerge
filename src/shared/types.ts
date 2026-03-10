/** Shared types for graph, messages, and API payloads. */

export interface Locator {
  primary?: string;
  css?: string;
  xpath?: string;
  [key: string]: string | undefined;
}

export interface TargetMeta {
  tagName?: string;
  src?: string;
  alt?: string;
  href?: string;
  title?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  textContent?: string;
  [key: string]: string | number | undefined;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TargetType = 'image' | 'link' | 'text' | 'element' | 'video' | 'canvas';

export type ConnectionSlotId = string;

export type AssistantMode = 'merge' | 'compile' | 'motion';

export const DEFAULT_SLOT_IDS: ConnectionSlotId[] = ['composition', 'tone', 'palette'];

export const MERGE_DEFAULT_SLOT_IDS: ConnectionSlotId[] = ['character', 'material', 'color'];

export const MOTION_DEFAULT_SLOT_IDS: ConnectionSlotId[] = ['motion'];

export const DEFAULT_SLOT_TITLES: Record<string, string> = {
  composition: 'Composition',
  tone: 'Tone',
  palette: 'Palette',
  theme: 'Theme',
  character: 'Character',
  material: 'Material',
  color: 'Color',
  motion: 'Motion',
};

export const MERGE_DEFAULT_SLOT_TITLES: Record<string, string> = {
  character: 'Character',
  material: 'Material',
  color: 'Color',
};

export const MOTION_DEFAULT_SLOT_TITLES: Record<string, string> = {
  motion: 'Motion',
};

export const SLOT_ADD_LABELS: Record<number, string> = {
  3: 'Theme',
  4: 'Slot 5',
  5: 'Slot 6',
  6: 'Slot 7',
  7: 'Slot 8',
  8: 'Slot 9',
  9: 'Slot 10',
};

export interface GraphTarget {
  id: string;
  targetType: TargetType;
  pageUrl: string;
  locator: Locator;
  meta: TargetMeta;
  rect: Rect;
  timestamp: number;
}

export interface AssistantNode {
  id: string;
  position: { x: number; y: number };
}

export type EdgeStatus = 'active' | 'broken';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  slotId: ConnectionSlotId;
  status: EdgeStatus;
}

export interface ObservationFrame {
  x: number;    // viewport, left
  y: number;    // viewport, top
  width: number;
  height: number;
}

export interface GraphState {
  projectId: string;
  pageUrl: string;
  assistantNode: AssistantNode;
  targets: GraphTarget[];
  edges: GraphEdge[];
  slotIds: ConnectionSlotId[];
  slotTitles: Record<string, string>;
  mode: AssistantMode;
  /** Observation frame for motion mode (ROI). Viewport coords. */
  observationFrame: ObservationFrame | null;
}

export interface AssistantSendRequestPayload {
  mode: AssistantMode;
  prompt?: string;
  page: { url: string; title: string };
  slotIds: ConnectionSlotId[];
  connections: Array<{
    slotId: ConnectionSlotId;
    slotTitle: string;
    targetType: TargetType;
    meta: TargetMeta;
    id?: string;
  }>;
  images?: string[];
  observationFrame?: ObservationFrame | null;
  /** Auto-detected on page for motion mode; used to tailor naming and code prompt. */
  pageContext?: {
    detectedLibraries?: string[];
    detectedHints?: string[];
  };
}

export interface AssistantResult {
  summary?: string;
  styleSignals?: string[];
  imageDescriptions?: string[];
  generatedPrompt?: string;
  imageUrl?: string;
  text?: string;
  motionDescription?: string;
  structured?: Record<string, unknown>;
  motionPhase?: 'selection' | 'analysis';
  motionCandidates?: Array<{ id: string; label: string; description?: string }>;
  motionQuestion?: string;
}

export interface AssistantSendSuccessPayload {
  ok: true;
  result: AssistantResult;
  usage?: { cached?: boolean };
}

export type AssistantErrorCode =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'invalid_payload'
  | 'timeout'
  | 'unknown';

export interface AssistantSendErrorPayload {
  ok: false;
  error: string;
  code: AssistantErrorCode;
}

export type AssistantSendResponse =
  | AssistantSendSuccessPayload
  | AssistantSendErrorPayload;

export const MESSAGE_TYPES = {
  CAPTURE_VISIBLE_TAB: 'CAPTURE_VISIBLE_TAB',
  ASSISTANT_SEND_REQUEST: 'ASSISTANT_SEND_REQUEST',
  ASSISTANT_SEND_SUCCESS: 'ASSISTANT_SEND_SUCCESS',
  ASSISTANT_SEND_ERROR: 'ASSISTANT_SEND_ERROR',
  GRAPH_SAVE_REQUEST: 'GRAPH_SAVE_REQUEST',
  GRAPH_SAVE_RESPONSE: 'GRAPH_SAVE_RESPONSE',
  GRAPH_RESTORE_REQUEST: 'GRAPH_RESTORE_REQUEST',
  GRAPH_RESTORE_RESPONSE: 'GRAPH_RESTORE_RESPONSE',
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];
