/**
 * SVG rope rendering: Bezier curves from port to targets.
 * Inertial sway: rope endpoints follow immediately; sway is triggered by movement and decays.
 */

import type { GraphState, GraphEdge, GraphTarget, ConnectionSlotId } from '../../shared/types';

let rafId: number | null = null;
let pendingDraw: (() => void) | null = null;

const swayDecay = 0.96;
const swaySensitivity = 0.8;
const swingState = new Map<string, { vx: number; vy: number; lastX1: number; lastY1: number; lastX2: number; lastY2: number }>();

function getTargetScreenRect(
  target: GraphTarget,
  resolve: (target: GraphTarget) => Element | null
): { x: number; y: number; fallback?: boolean } | null {
  const el = resolve(target);
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  if (target.rect && target.rect.width > 0 && target.rect.height > 0) {
    const cx = target.rect.x + target.rect.width / 2 - window.scrollX;
    const cy = target.rect.y + target.rect.height / 2 - window.scrollY;
    return { x: cx, y: cy, fallback: true };
  }
  return null;
}

/**
 * Кривая провисающей веревки. swayX, swayY — инерционное смещение контрольных точек.
 */
function saggingRopePath(
  x1: number, y1: number,
  x2: number, y2: number,
  swayX: number, swayY: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const sag = Math.min(len * 0.5, 180);
  const curvature = 0.25;
  const perpX = -dy / (len || 1);
  const perpY = dx / (len || 1);
  const cpx1 = x1 + dx * curvature + perpX * swayX * 2 + perpY * swayY * 0.6;
  const cpy1 = y1 + dy * 0.3 + sag * 0.7 + swayY * 1.2;
  const cpx2 = x2 - dx * curvature - perpX * swayX * 1.6 - perpY * swayY * 0.4;
  const cpy2 = y2 - dy * 0.1 + sag * 0.6 - swayY * 0.9;
  return `M ${x1} ${y1} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${x2} ${y2}`;
}

export type GetPortPositions = () => Partial<Record<ConnectionSlotId, { x: number; y: number }>>;

export function drawRopes(
  svg: SVGElement,
  state: GraphState,
  tempEnd: { x: number; y: number } | null,
  tempSlot: ConnectionSlotId | null,
  resolveTarget: (target: GraphTarget) => Element | null,
  getPortPositions: GetPortPositions
): void {
  const portPositions = getPortPositions();

  for (const eid of swingState.keys()) {
    if (!state.edges.some((e) => e.id === eid)) swingState.delete(eid);
  }

  const paths: string[] = [];
  const classes: string[] = [];
  const edgeIds: (string | null)[] = [];

  for (const edge of state.edges) {
    const portPos = portPositions[edge.slotId];
    if (!portPos) continue;
    const target = state.targets.find((t) => t.id === edge.target);
    if (!target) continue;
    const end = getTargetScreenRect(target, resolveTarget);
    const x1 = portPos.x;
    const y1 = portPos.y;
    const x2 = end ? end.x : portPos.x + 50;
    const y2 = end ? end.y : portPos.y + 50;

    let s = swingState.get(edge.id);
    if (!s) {
      s = { vx: 0, vy: 0, lastX1: x1, lastY1: y1, lastX2: x2, lastY2: y2 };
      swingState.set(edge.id, s);
    } else {
      const dx1 = x1 - s.lastX1;
      const dy1 = y1 - s.lastY1;
      const dx2 = x2 - s.lastX2;
      const dy2 = y2 - s.lastY2;
      s.vx += (dx1 + dx2) * swaySensitivity;
      s.vy += (dy1 + dy2) * swaySensitivity;
      s.lastX1 = x1;
      s.lastY1 = y1;
      s.lastX2 = x2;
      s.lastY2 = y2;
    }
    const swayX = s.vx;
    const swayY = s.vy;
    s.vx *= swayDecay;
    s.vy *= swayDecay;

    paths.push(saggingRopePath(x1, y1, x2, y2, swayX, swayY));
    classes.push(!end || (!end.fallback && edge.status === 'broken') ? 'broken' : 'active');
    edgeIds.push(edge.id);
  }

  if (tempEnd && tempSlot) {
    const portPos = portPositions[tempSlot];
    if (portPos) {
      paths.push(saggingRopePath(portPos.x, portPos.y, tempEnd.x, tempEnd.y, 0, 0));
      classes.push('temp');
      edgeIds.push(null);
    }
  }

  const existing = Array.from(svg.querySelectorAll('path'));

  paths.forEach((d, i) => {
    let path = existing[i] as SVGPathElement | undefined;
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(path);
    }
    path.setAttribute('d', d);
    path.setAttribute('class', classes[i] ?? 'active');
    const eid = edgeIds[i];
    if (eid) path.setAttribute('data-edge-id', eid);
    else path.removeAttribute('data-edge-id');
  });
  existing.slice(paths.length).forEach((p) => p.remove());
}

export function scheduleRopeDraw(
  svg: SVGElement,
  state: GraphState,
  getTempEnd: () => { x: number; y: number } | null,
  getTempSlot: () => ConnectionSlotId | null,
  resolveTarget: (target: GraphTarget) => Element | null,
  getPortPositions: GetPortPositions
): void {
  const draw = () => drawRopes(svg, state, getTempEnd(), getTempSlot(), resolveTarget, getPortPositions);
  if (rafId != null) {
    pendingDraw = draw;
    return;
  }
  pendingDraw = null;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    draw();
    if (pendingDraw) {
      pendingDraw();
      pendingDraw = null;
    }
  });
}
