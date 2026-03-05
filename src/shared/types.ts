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

export type TargetType = 'image' | 'link' | 'text' | 'element';

export type ConnectionSlotId = string;

export const DEFAULT_SLOT_IDS: ConnectionSlotId[] = ['composition', 'tone', 'palette'];

export const DEFAULT_SLOT_TITLES: Record<string, string> = {
  composition: 'Composition',
  tone: 'Tone',
  palette: 'Palette',
  theme: 'Theme',
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

export interface GraphState {
  projectId: string;
  pageUrl: string;
  assistantNode: AssistantNode;
  targets: GraphTarget[];
  edges: GraphEdge[];
  slotIds: ConnectionSlotId[];
  slotTitles: Record<string, string>;
}

export interface AssistantSendRequestPayload {
  prompt: string;
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
}

export interface AssistantResult {
  summary?: string;
  styleSignals?: string[];
  imageDescriptions?: string[];
  generatedPrompt?: string;
  imageUrl?: string;
  text?: string;
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
  ASSISTANT_SEND_REQUEST: 'ASSISTANT_SEND_REQUEST',
  ASSISTANT_SEND_SUCCESS: 'ASSISTANT_SEND_SUCCESS',
  ASSISTANT_SEND_ERROR: 'ASSISTANT_SEND_ERROR',
  GRAPH_SAVE_REQUEST: 'GRAPH_SAVE_REQUEST',
  GRAPH_SAVE_RESPONSE: 'GRAPH_SAVE_RESPONSE',
  GRAPH_RESTORE_REQUEST: 'GRAPH_RESTORE_REQUEST',
  GRAPH_RESTORE_RESPONSE: 'GRAPH_RESTORE_RESPONSE',
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];
