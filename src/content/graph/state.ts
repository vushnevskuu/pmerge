/**
 * Graph state: assistant node, targets, edges, slot titles.
 */

import type { GraphState, GraphTarget, GraphEdge, AssistantNode, ConnectionSlotId } from '../../shared/types';
import { DEFAULT_SLOT_IDS, DEFAULT_SLOT_TITLES, SLOT_ADD_LABELS } from '../../shared/types';
import type { ExtractedTarget } from '../targeting/extract';
import { resolveTarget } from '../targeting/locators';

const ASSISTANT_ID = 'assistant_main';

export function createInitialState(pageUrl: string): GraphState {
  const slotIds = [...DEFAULT_SLOT_IDS];
  const slotTitles: Record<string, string> = {};
  slotIds.forEach((id) => {
    slotTitles[id] = DEFAULT_SLOT_TITLES[id] ?? id;
  });
  return {
    projectId: 'project_' + Date.now(),
    pageUrl,
    assistantNode: { id: ASSISTANT_ID, position: { x: 120, y: 80 } },
    targets: [],
    edges: [],
    slotIds,
    slotTitles,
  };
}

export function addTarget(state: GraphState, extracted: ExtractedTarget): GraphTarget {
  const target: GraphTarget = {
    id: extracted.id,
    targetType: extracted.targetType,
    pageUrl: extracted.pageUrl,
    locator: extracted.locator,
    meta: extracted.meta,
    rect: extracted.rect,
    timestamp: extracted.timestamp,
  };
  state.targets.push(target);
  return target;
}

export function addEdge(state: GraphState, targetId: string, slotId: ConnectionSlotId): GraphEdge {
  const existing = getEdgeBySlot(state, slotId);
  if (existing) removeEdge(state, existing.id);
  const id = 'edge_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const source = `${ASSISTANT_ID}:${slotId}`;
  const edge: GraphEdge = { id, source, target: targetId, slotId, status: 'active' };
  state.edges.push(edge);
  return edge;
}

export function getEdgeBySlot(state: GraphState, slotId: ConnectionSlotId): GraphEdge | undefined {
  return state.edges.find((e) => e.slotId === slotId);
}

export function setSlotTitle(state: GraphState, slotId: ConnectionSlotId, title: string): void {
  state.slotTitles[slotId] = title.trim() || (DEFAULT_SLOT_TITLES[slotId] ?? slotId);
}

export function addSlot(state: GraphState): ConnectionSlotId {
  const n = state.slotIds.length;
  const label = SLOT_ADD_LABELS[n] ?? `Slot ${n + 1}`;
  const id = n === 3 ? 'theme' : `slot_${n}`;
  state.slotIds.push(id);
  state.slotTitles[id] = label;
  return id;
}

export function removeEdge(state: GraphState, edgeId: string): void {
  const i = state.edges.findIndex((e) => e.id === edgeId);
  if (i === -1) return;
  const targetId = state.edges[i].target;
  state.edges.splice(i, 1);
  const stillReferenced = state.edges.some((e) => e.target === targetId);
  if (!stillReferenced) {
    const ti = state.targets.findIndex((t) => t.id === targetId);
    if (ti !== -1) state.targets.splice(ti, 1);
  }
}

export function getTargetById(state: GraphState, id: string): GraphTarget | undefined {
  return state.targets.find((t) => t.id === id);
}

export function setAssistantPosition(state: GraphState, x: number, y: number): void {
  state.assistantNode.position = { x, y };
}

export function revalidateTargets(state: GraphState): void {
  for (const edge of state.edges) {
    const target = getTargetById(state, edge.target);
    if (!target) continue;
    const el = resolveTarget(target, document);
    edge.status = el ? 'active' : 'broken';
  }
}

export function updateTargetRect(state: GraphState, targetId: string, rect: { x: number; y: number; width: number; height: number }): void {
  const t = state.targets.find((x) => x.id === targetId);
  if (t) t.rect = rect;
}
