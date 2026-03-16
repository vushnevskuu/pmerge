/**
 * Assistant overlay: Shadow DOM root, window HTML, drag, port link-drag, send, result.
 */

import type { GraphState, ConnectionSlotId } from '../../shared/types';
import { overlayStyles } from './styles';
import { drawRopes, scheduleRopeDraw } from './ropes';
import { resolveTarget } from '../targeting/locators';
import {
  createInitialState,
  addTarget,
  addEdge,
  removeEdge,
  setAssistantPosition,
  setSlotTitle,
  addSlot,
  setMode,
  revalidateTargets,
  updateTargetRect,
  getTargetById,
  getEdgeBySlot,
  setObservationFrame,
} from '../graph/state';
import { extractTarget } from '../targeting/extract';
import { captureElementFrames, captureViewportRoiFrames, captureSingleFrameRoi, subsampleFrames } from '../capture/frames';
import { filterValidImageUrls } from '../../shared/imageValidation';
import { detectPageUiContext } from '../detection/pageUiContext';
import { MESSAGE_TYPES } from '../../shared/types';

const STORAGE_POSITION_KEY = 'ai_assistant_position';

export interface OverlayCallbacks {
  onStateChange?: (state: GraphState) => void;
}

export function createOverlay(callbacks: OverlayCallbacks = {}): {
  root: HTMLElement;
  shadow: ShadowRoot;
  getState: () => GraphState;
  setState: (s: GraphState) => void;
} {
  const root = document.createElement('div');
  root.className = 'root';
  const shadow = root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${overlayStyles}</style>
    <div class="assistant-wrap" data-assistant-window data-drag-handle>
      <div class="assistant-header">
        <div class="mode-switcher" data-mode-switcher>
          <button type="button" class="mode-btn active" data-mode="compile">1</button>
          <button type="button" class="mode-btn" data-mode="motion">2</button>
        </div>
        <div class="header-right">
          <span class="drag-hint">merger</span>
          <button type="button" class="close-btn" data-close title="Close">×</button>
        </div>
      </div>
      <div class="assistant-body">
        <div class="prompt-wrap" data-prompt-wrap>
          <textarea data-prompt placeholder="e.g. make an image with this vibe on the theme of a cosmic cafe"></textarea>
        </div>
        <div class="slots" data-slots></div>
        <div class="connections-list" data-connections-items></div>
        <button type="button" class="slot-add-btn" data-slot-add title="Add slot">+</button>
        <div class="send-row" data-send-row>
          <button type="button" class="record-btn" data-record style="display:none">Record</button>
          <button type="button" class="send-btn" data-send>Generate</button>
        </div>
        <div class="status" data-status></div>
        <div class="result" data-result style="display:none">
          <div class="result-image-wrap" data-result-image></div>
          <details class="result-prompt-toggle" data-result-prompt-toggle>
            <summary class="prompt-summary">
              <span>Prompt</span>
              <button type="button" class="copy-prompt-btn" data-copy-prompt title="Copy prompt">Copy</button>
            </summary>
            <pre class="result-prompt-text" data-result-prompt-text></pre>
          </details>
          <details class="result-image-descriptions" data-result-image-descriptions>
            <summary>Descriptions</summary>
            <div class="result-image-descriptions-list" data-result-image-descriptions-list></div>
          </details>
          <details class="result-motion-structured" data-result-motion-structured>
            <summary class="prompt-summary">
              <span>Structured (JSON)</span>
              <button type="button" class="copy-prompt-btn" data-copy-motion title="Copy analysis">Copy</button>
            </summary>
            <pre class="result-motion-structured-json" data-result-motion-structured-json></pre>
          </details>
          <div class="result-text" data-result-text></div>
        </div>
      </div>
    </div>
    <svg class="svg-layer" data-ropes-svg></svg>
    <div class="highlight-box" data-highlight style="display:none"></div>
    <div class="roi-layer" data-roi-layer></div>
  `;

  let state: GraphState = createInitialState(window.location.href);

  const getState = () => state;
  const setState = (s: GraphState) => {
    state = s;
    callbacks.onStateChange?.(state);
  };

  const svg = shadow.querySelector('[data-ropes-svg]') as SVGElement;
  const updateSvgViewBox = () => {
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    svg.setAttribute('width', String(window.innerWidth));
    svg.setAttribute('height', String(window.innerHeight));
  };
  updateSvgViewBox();
  const windowEl = shadow.querySelector('[data-assistant-window]') as HTMLElement;
  const dragHandle = shadow.querySelector('[data-drag-handle]') as HTMLElement;
  const DRAG_EXCLUDE = 'button, input, textarea, select, [data-port], .slot-title, [data-close], [data-slot-add], [data-send], [data-mode-switcher] button, details summary, .connection-slot button, [data-copy-prompt], [data-copy-motion], a, .roi-frame, .roi-resize-handle';
  const slotsContainer = shadow.querySelector('[data-slots]') as HTMLElement;
  const promptWrap = shadow.querySelector('[data-prompt-wrap]') as HTMLElement;
  const promptInput = shadow.querySelector('[data-prompt]') as HTMLTextAreaElement;
  const sendBtn = shadow.querySelector('[data-send]') as HTMLButtonElement;
  const statusEl = shadow.querySelector('[data-status]') as HTMLElement;
  const resultEl = shadow.querySelector('[data-result]') as HTMLElement;
  const resultImageWrap = shadow.querySelector('[data-result-image]') as HTMLElement;
  const resultImageDescriptions = shadow.querySelector('[data-result-image-descriptions]') as HTMLDetailsElement;
  const resultImageDescriptionsList = shadow.querySelector('[data-result-image-descriptions-list]') as HTMLElement;
  const resultMotionStructured = shadow.querySelector('[data-result-motion-structured]') as HTMLDetailsElement;
  const resultMotionStructuredJson = shadow.querySelector('[data-result-motion-structured-json]') as HTMLElement;
  const resultPromptToggle = shadow.querySelector('[data-result-prompt-toggle]') as HTMLDetailsElement;
  const resultPromptText = shadow.querySelector('[data-result-prompt-text]') as HTMLElement;
  const resultTextEl = shadow.querySelector('[data-result-text]') as HTMLElement;
  const highlightEl = shadow.querySelector('[data-highlight]') as HTMLElement;
  const roiLayer = shadow.querySelector('[data-roi-layer]') as HTMLElement;
  const connectionsItems = shadow.querySelector('[data-connections-items]') as HTMLElement | null;
  const slotAddBtn = shadow.querySelector('[data-slot-add]') as HTMLButtonElement;
  const modeSwitcher = shadow.querySelector('[data-mode-switcher]') as HTMLElement;
  const recordBtn = shadow.querySelector('[data-record]') as HTMLButtonElement;

  const RECORD_INTERVAL_MS = 66;
  const RECORD_MAX_DURATION_MS = 8000;
  const RECORD_MAX_FRAMES = 120;
  /** API limit: max 5 images per request. Use 5 so we never exceed even if background is old. */
  const MOTION_IMAGES_CAP = 5;
  const RECORD_SUBSAMPLE_COUNT = MOTION_IMAGES_CAP;

  let isRecording = false;
  let recordedFrames: string[] = [];
  let recordingIntervalId: ReturnType<typeof setInterval> | null = null;
  let recordingMaxTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let recordingStatusIntervalId: ReturnType<typeof setInterval> | null = null;
  let recordingStartTime = 0;
  let overlayRestore: (() => void) | null = null;

  /** Hides ROI frame and ropes so they are not captured in screenshots. Returns restore callback. */
  function hideOverlayForCapture(): () => void {
    const ropesSvg = shadow.querySelector('[data-ropes-svg]') as SVGElement | null;
    const roi = shadow.querySelector('[data-roi-layer]') as HTMLElement | null;
    const prevRopes = ropesSvg?.style.visibility ?? '';
    const prevRoi = roi?.style.visibility ?? '';
    if (ropesSvg) ropesSvg.style.visibility = 'hidden';
    if (roi) roi.style.visibility = 'hidden';
    return () => {
      if (ropesSvg) ropesSvg.style.visibility = prevRopes || 'visible';
      if (roi) roi.style.visibility = prevRoi || 'visible';
    };
  }

  /** Wait for browser to paint (so overlay hide is visible to captureVisibleTab). */
  function waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  function stopRecording() {
    if (recordingIntervalId) {
      clearInterval(recordingIntervalId);
      recordingIntervalId = null;
    }
    if (recordingMaxTimeoutId) {
      clearTimeout(recordingMaxTimeoutId);
      recordingMaxTimeoutId = null;
    }
    if (recordingStatusIntervalId) {
      clearInterval(recordingStatusIntervalId);
      recordingStatusIntervalId = null;
    }
    if (overlayRestore) {
      overlayRestore();
      overlayRestore = null;
    }
    isRecording = false;
    if (recordBtn) recordBtn.textContent = 'Record';
    if (statusEl) statusEl.textContent = recordedFrames.length >= 2 ? `Recorded ${recordedFrames.length} frames` : 'Recording stopped';
  }

  function updateModeUI() {
    if (promptWrap) promptWrap.style.display = 'block';
    if (promptInput) {
      promptInput.placeholder = state.mode === 'motion'
        ? 'Describe what you want or leave blank'
        : 'e.g. make an image with this vibe on the theme of a cosmic cafe';
    }
    if (slotAddBtn) slotAddBtn.style.display = state.mode === 'motion' ? 'none' : '';
    if (sendBtn) sendBtn.textContent = state.mode === 'motion' ? 'Describe' : 'Generate';
    if (recordBtn) recordBtn.style.display = state.mode === 'motion' && state.observationFrame ? '' : 'none';
    modeSwitcher?.querySelectorAll('.mode-btn').forEach((btn) => {
      const m = (btn as HTMLElement).getAttribute('data-mode');
      btn.classList.toggle('active', m === state.mode);
    });
    renderRoiFrame();
  }

  function renderSlots() {
    if (!slotsContainer) return;
    slotsContainer.innerHTML = '';
    state.slotIds.forEach((slotId) => {
      const title = state.slotTitles[slotId] ?? slotId;
      const div = document.createElement('div');
      div.className = 'slot';
      div.setAttribute('data-slot', slotId);
      div.innerHTML = `
        <span class="port-dot" data-port title="Drag to element"></span>
        <input class="slot-title" data-slot-title type="text" value="${escapeHtml(title)}" />
      `;
      slotsContainer.appendChild(div);
    });
    state.slotIds.forEach((slotId) => setupSlotDrag(slotId));
    syncSlotTitleInputs();
    renderRopes();
    renderRoiFrame();
  }

  function escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function updateConnectionsList() {
    if (!connectionsItems) return;
    connectionsItems.innerHTML = '';
    state.slotIds.forEach((slotId) => {
      const edge = getEdgeBySlot(state, slotId);
      const title = state.slotTitles[slotId];
      const div = document.createElement('div');
      div.className = 'connection-slot';
      div.setAttribute('data-slot', slotId);
      const titleSpan = document.createElement('span');
      titleSpan.className = 'connection-slot-title';
      titleSpan.textContent = title + ': ';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'connection-slot-label';
      if (edge) {
        const t = getTargetById(state, edge.target);
        labelSpan.textContent = t?.meta?.alt || t?.meta?.src?.slice(-30) || edge.target.slice(0, 8) || '—';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '✕';
        btn.addEventListener('click', () => {
          removeEdge(state, edge.id);
          updateConnectionsList();
          renderRopes();
        });
        div.appendChild(titleSpan);
        div.appendChild(labelSpan);
        div.appendChild(btn);
      } else {
        labelSpan.textContent = '—';
        div.appendChild(titleSpan);
        div.appendChild(labelSpan);
      }
      connectionsItems.appendChild(div);
    });
  }

  function syncSlotTitleInputs() {
    state.slotIds.forEach((slotId) => {
      const slotEl = slotsContainer?.querySelector(`[data-slot="${slotId}"]`);
      const input = slotEl?.querySelector('[data-slot-title]') as HTMLInputElement | null;
      if (input && state.slotTitles[slotId] !== undefined) {
        input.value = state.slotTitles[slotId];
      }
    });
  }

  const resolveTargetEl = (target: GraphState['targets'][0]) =>
    resolveTarget(target, document);

  const getPortPositions = (): Partial<Record<string, { x: number; y: number }>> => {
    const out: Partial<Record<string, { x: number; y: number }>> = {};
    state.slotIds.forEach((slotId) => {
      const slotEl = slotsContainer?.querySelector(`[data-slot="${slotId}"]`);
      const port = slotEl?.querySelector('[data-port]') as HTMLElement | null;
      if (port) {
        const r = port.getBoundingClientRect();
        out[slotId] = { x: r.left + r.width / 2, y: r.bottom };
      }
    });
    return out;
  };

  let tempDragSlot: string | null = null;

  function renderRopes(tempEnd: { x: number; y: number } | null = null) {
    scheduleRopeDraw(
      svg,
      state,
      () => tempEnd,
      () => tempDragSlot,
      resolveTargetEl,
      getPortPositions
    );
  }

  const DEFAULT_ROI_SIZE = 180;

  function renderRoiFrame() {
    if (!roiLayer) return;
    roiLayer.innerHTML = '';
    roiLayer.classList.remove('active');
    if (state.mode !== 'motion' || !state.observationFrame) return;
    const f = state.observationFrame;
    const MIN_SIZE = 40;
    const w = Math.max(f.width, MIN_SIZE);
    const h = Math.max(f.height, MIN_SIZE);
    const frame = document.createElement('div');
    frame.className = 'roi-frame';
    frame.style.left = f.x + 'px';
    frame.style.top = f.y + 'px';
    frame.style.width = w + 'px';
    frame.style.height = h + 'px';
    const handles = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
    handles.forEach((edge) => {
      const hEl = document.createElement('div');
      hEl.className = 'roi-resize-handle ' + edge;
      hEl.setAttribute('data-resize', edge);
      frame.appendChild(hEl);
    });
    roiLayer.appendChild(frame);
    roiLayer.classList.add('active');
    setupRoiInteractions(frame);
  }

  function setupRoiInteractions(frameEl: HTMLElement) {
    const getFrame = () => state.observationFrame;
    let dragStart: { x: number; y: number; frameX: number; frameY: number } | null = null;
    let resizeStart: { x: number; y: number; frameX: number; frameY: number; w: number; h: number; edge: string } | null = null;
    const MIN_SIZE = 40;

    const onMove = (ev: PointerEvent) => {
      const f = getFrame();
      if (!f) return;
      if (resizeStart) {
        const dx = ev.clientX - resizeStart.x;
        const dy = ev.clientY - resizeStart.y;
        let nx = resizeStart.frameX, ny = resizeStart.frameY, nw = resizeStart.w, nh = resizeStart.h;
        const edge = resizeStart.edge;
        if (edge.includes('w')) { nx += dx; nw -= dx; }
        if (edge.includes('e')) nw += dx;
        if (edge.includes('n')) { ny += dy; nh -= dy; }
        if (edge.includes('s')) nh += dy;
        if (nw < MIN_SIZE) { nx = resizeStart.frameX + resizeStart.w - MIN_SIZE; nw = MIN_SIZE; }
        if (nh < MIN_SIZE) { ny = resizeStart.frameY + resizeStart.h - MIN_SIZE; nh = MIN_SIZE; }
        setObservationFrame(state, { x: nx, y: ny, width: nw, height: nh });
        frameEl.style.left = nx + 'px';
        frameEl.style.top = ny + 'px';
        frameEl.style.width = nw + 'px';
        frameEl.style.height = nh + 'px';
        renderRopes();
      } else if (dragStart) {
        const dx = ev.clientX - dragStart.x;
        const dy = ev.clientY - dragStart.y;
        const nx = Math.max(0, dragStart.frameX + dx);
        const ny = Math.max(0, dragStart.frameY + dy);
        setObservationFrame(state, { ...f, x: nx, y: ny });
        frameEl.style.left = nx + 'px';
        frameEl.style.top = ny + 'px';
        renderRopes();
      }
    };
    const onUp = () => {
      dragStart = null;
      resizeStart = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      callbacks.onStateChange?.(state);
      renderRopes();
    };

    frameEl.addEventListener('pointerdown', (e) => {
      const handle = (e.target as HTMLElement).closest('[data-resize]');
      const f = getFrame();
      if (!f) return;
      e.preventDefault();
      if (handle) {
        const edge = handle.getAttribute('data-resize') ?? '';
        resizeStart = { x: e.clientX, y: e.clientY, frameX: f.x, frameY: f.y, w: f.width, h: f.height, edge };
      } else {
        dragStart = { x: e.clientX, y: e.clientY, frameX: f.x, frameY: f.y };
      }
      frameEl.setPointerCapture(e.pointerId);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  function loadSavedPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_POSITION_KEY);
      if (raw) {
        const { x, y } = JSON.parse(raw);
        if (typeof x === 'number' && typeof y === 'number') {
          windowEl.style.left = x + 'px';
          windowEl.style.top = y + 'px';
          setAssistantPosition(state, x, y);
        }
      }
    } catch (_) {}
    if (!windowEl.style.left) {
      const margin = 16;
      const w = windowEl.getBoundingClientRect().width || 340;
      const x = Math.max(0, window.innerWidth - w - margin);
      const y = margin;
      windowEl.style.left = x + 'px';
      windowEl.style.top = y + 'px';
      setAssistantPosition(state, x, y);
    }
  }

  loadSavedPosition();

  const closeBtn = shadow.querySelector('[data-close]') as HTMLButtonElement;
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      root.style.display = 'none';
    });
  }

  let dragStartX = 0, dragStartY = 0, windowStartX = 0, windowStartY = 0;
  dragHandle.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest(DRAG_EXCLUDE)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = windowEl.getBoundingClientRect();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    windowStartX = rect.left;
    windowStartY = rect.top;
    const pid = e.pointerId;
    dragHandle.setPointerCapture(pid);
    let dragScheduled = false;
    let lastEv = { clientX: 0, clientY: 0 };
    const onMove = (ev: PointerEvent) => {
      lastEv = { clientX: ev.clientX, clientY: ev.clientY };
      if (dragScheduled) return;
      dragScheduled = true;
      requestAnimationFrame(() => {
        dragScheduled = false;
        const dx = lastEv.clientX - dragStartX;
        const dy = lastEv.clientY - dragStartY;
        const x = Math.max(0, windowStartX + dx);
        const y = Math.max(0, windowStartY + dy);
        windowEl.style.left = x + 'px';
        windowEl.style.top = y + 'px';
        setAssistantPosition(state, x, y);
        renderRopes();
      });
    };
    const onUp = () => {
      try {
        dragHandle.releasePointerCapture(pid);
      } catch (_) {}
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      try {
        const r = windowEl.getBoundingClientRect();
        localStorage.setItem(STORAGE_POSITION_KEY, JSON.stringify({ x: r.left, y: r.top }));
      } catch (_) {}
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

  let tempEnd: { x: number; y: number } | null = null;

  function setupSlotDrag(slotId: string) {
    const slotEl = slotsContainer?.querySelector(`[data-slot="${slotId}"]`);
    const port = slotEl?.querySelector('[data-port]') as HTMLElement | null;
    const titleInput = slotEl?.querySelector('[data-slot-title]') as HTMLInputElement | null;
    if (!port) return;
    if (titleInput) {
      titleInput.addEventListener('change', () => {
        setSlotTitle(state, slotId, titleInput.value);
        updateConnectionsList();
      });
      titleInput.addEventListener('blur', () => {
        setSlotTitle(state, slotId, titleInput.value);
        updateConnectionsList();
      });
    }
    port.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      tempDragSlot = slotId;
      const pid = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      port.setPointerCapture(pid);
      let moveScheduled = false;
      let lastMove = { x: 0, y: 0 };
      const onMove = (ev: PointerEvent) => {
        lastMove = { x: ev.clientX, y: ev.clientY };
        if (moveScheduled) return;
        moveScheduled = true;
        requestAnimationFrame(() => {
          moveScheduled = false;
          tempEnd = lastMove;
          renderRopes(tempEnd);
          if (state.mode === 'motion' && slotId === 'motion' && !state.observationFrame) {
            const dist = Math.sqrt((lastMove.x - startX) ** 2 + (lastMove.y - startY) ** 2);
            if (dist >= 8) {
              const sz = DEFAULT_ROI_SIZE;
              const x = Math.max(0, lastMove.x - sz / 2);
              const y = Math.max(0, lastMove.y - sz / 2);
              setObservationFrame(state, { x, y, width: sz, height: sz });
              renderRoiFrame();
              updateModeUI();
              callbacks.onStateChange?.(state);
            }
          }
          const el = document.elementFromPoint(lastMove.x, lastMove.y);
          if (el && !shadow.contains(el)) {
            highlightEl.style.display = 'block';
            const r = el.getBoundingClientRect();
            highlightEl.style.left = r.left + 'px';
            highlightEl.style.top = r.top + 'px';
            highlightEl.style.width = r.width + 'px';
            highlightEl.style.height = r.height + 'px';
          } else {
            highlightEl.style.display = 'none';
          }
        });
      };
      const cleanup = () => {
        highlightEl.style.display = 'none';
        tempEnd = null;
        tempDragSlot = null;
        try {
          port.releasePointerCapture(pid);
        } catch (_) {}
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        renderRopes();
      };
      const onUp = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const isValidTarget = el && !shadow.contains(el) && (() => {
          const tag = el.tagName?.toLowerCase();
          const isImg = el instanceof HTMLImageElement || el.querySelector('img');
          const isVideo = el instanceof HTMLVideoElement || el.querySelector('video');
          const isCanvas = el instanceof HTMLCanvasElement || el.querySelector('canvas');
          const isLink = el instanceof HTMLAnchorElement || el.closest('a');
          return !!(isImg || isVideo || isCanvas || isLink || tag === 'p' || tag === 'span' || tag === 'div');
        })();
        if (dist < 8) {
          const edge = getEdgeBySlot(state, slotId);
          if (edge) {
            removeEdge(state, edge.id);
            callbacks.onStateChange?.(state);
            updateConnectionsList();
            renderRopes();
          }
        } else if (isValidTarget && el) {
          const tag = el.tagName?.toLowerCase();
          const isImg = el instanceof HTMLImageElement || el.querySelector('img');
          const isVideo = el instanceof HTMLVideoElement || el.querySelector('video');
          const isCanvas = el instanceof HTMLCanvasElement || el.querySelector('canvas');
          const isLink = el instanceof HTMLAnchorElement || el.closest('a');
          if (isImg || isVideo || isCanvas || isLink || tag === 'p' || tag === 'span' || tag === 'div') {
            const targetEl = el instanceof HTMLVideoElement ? el
              : (el.querySelector('video') as HTMLVideoElement | null) ?? (el instanceof HTMLCanvasElement ? el
              : (el.querySelector('canvas') as HTMLCanvasElement | null) ?? (el instanceof HTMLImageElement ? el
              : (el.querySelector('img') || el)));
            const id = 'target_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
            const extracted = extractTarget(targetEl, id);
            addTarget(state, extracted);
            addEdge(state, id, slotId);
            const t = getTargetById(state, id);
            if (t) {
              const resolved = resolveTarget(t, document);
              if (resolved) {
                const r = resolved.getBoundingClientRect();
                updateTargetRect(state, id, {
                  x: r.left + window.scrollX,
                  y: r.top + window.scrollY,
                  width: r.width,
                  height: r.height,
                });
              }
            }
            callbacks.onStateChange?.(state);
            updateConnectionsList();
          }
        }
        cleanup();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }
  modeSwitcher?.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = (btn as HTMLElement).getAttribute('data-mode') as 'compile' | 'motion';
      if (m && m !== state.mode) {
        if (isRecording) stopRecording();
        setMode(state, m);
        renderSlots();
        updateConnectionsList();
        updateModeUI();
      }
    });
  });

  slotAddBtn?.addEventListener('click', () => {
    addSlot(state);
    renderSlots();
    updateConnectionsList();
  });

  recordBtn?.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    if (!state.observationFrame || state.mode !== 'motion') return;
    recordedFrames = [];
    isRecording = true;
    overlayRestore = hideOverlayForCapture();
    recordBtn.textContent = 'Stop';
    recordingStartTime = Date.now();
    recordingIntervalId = setInterval(async () => {
      if (recordedFrames.length >= RECORD_MAX_FRAMES) {
        stopRecording();
        return;
      }
      const frame = await captureSingleFrameRoi(state.observationFrame!);
      if (frame) recordedFrames.push(frame);
    }, RECORD_INTERVAL_MS);
    recordingMaxTimeoutId = setTimeout(stopRecording, RECORD_MAX_DURATION_MS);
    recordingStatusIntervalId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      if (statusEl) statusEl.textContent = `Recording… 0:${String(elapsed).padStart(2, '0')}`;
    }, 1000);
    if (statusEl) statusEl.textContent = 'Recording… 0:00';
  });

  sendBtn.addEventListener('click', async () => {
    const prompt = (promptInput?.value ?? '').trim();
    const hasConnections = state.slotIds.some((id) => getEdgeBySlot(state, id));
    if (state.mode === 'compile' && !prompt && !hasConnections) {
      if (statusEl) statusEl.textContent = 'Enter a prompt or connect images to slots';
      return;
    }
    if (state.mode === 'motion' && !hasConnections && !state.observationFrame && recordedFrames.length === 0) return;
    statusEl.textContent = 'Sending…';
    if (resultImageWrap) resultImageWrap.innerHTML = '';
    if (resultImageDescriptions) resultImageDescriptions.style.display = 'none';
    if (resultPromptToggle) resultPromptToggle.style.display = 'none';
    if (resultTextEl) resultTextEl.textContent = '';
    resultEl.style.display = 'none';
    sendBtn.disabled = true;

    const connections = state.slotIds.flatMap((slotId) => {
      const edge = getEdgeBySlot(state, slotId);
      if (!edge) return [];
      const t = getTargetById(state, edge.target);
      return t
        ? [{
            slotId,
            slotTitle: state.slotTitles[slotId] ?? slotId,
            targetType: t.targetType,
            meta: t.meta,
            id: t.id,
          }]
        : [];
    }) as Array<{
      slotId: ConnectionSlotId;
      slotTitle: string;
      targetType: string;
      meta: Record<string, unknown>;
      id: string;
    }>;

    let images: string[] | undefined;
    if (state.mode === 'motion') {
      if (recordedFrames.length > 0) {
        images = subsampleFrames(recordedFrames, RECORD_SUBSAMPLE_COUNT);
      } else {
        statusEl.textContent = 'Capturing frames…';
        const restoreOverlay = hideOverlayForCapture();
        await waitForPaint();
        const allFrames: string[] = [];
        try {
        const roiRect = state.observationFrame ?? undefined;
        if (connections.length > 0) {
          for (const conn of connections) {
            const t = getTargetById(state, conn.id);
            if (!t) continue;
            let el = resolveTarget(t, document);
            if (!el) continue;
            const video = el instanceof HTMLVideoElement ? el : el.querySelector('video');
            const canvas = el instanceof HTMLCanvasElement ? el : el.querySelector('canvas');
            const img = el instanceof HTMLImageElement ? el : el.querySelector('img');
            const captureEl = (video as HTMLVideoElement | null) ?? (canvas as HTMLCanvasElement | null) ?? (img as HTMLImageElement | null) ?? el;
            const frames = await captureElementFrames(captureEl, 10, roiRect);
            allFrames.push(...frames);
          }
        }
        if (allFrames.length === 0 && state.observationFrame) {
          const frames = await captureViewportRoiFrames(state.observationFrame, 10);
          allFrames.push(...frames);
        }
        } finally {
          restoreOverlay();
        }
        images = allFrames.length > 0 ? subsampleFrames(allFrames, MOTION_IMAGES_CAP) : undefined;
      }
      if (state.mode === 'motion' && images) images = filterValidImageUrls(images);
      if (!images || images.length === 0) {
        statusEl.textContent = 'No frames captured';
        sendBtn.disabled = false;
        return;
      }
      statusEl.textContent = 'Sending…';
    }

    const pageContext = state.mode === 'motion' ? detectPageUiContext() : undefined;
    const payload = {
      mode: state.mode,
      prompt: state.mode === 'compile' ? (prompt ?? '') : state.mode === 'motion' ? (prompt ?? '') : undefined,
      page: { url: window.location.href, title: document.title },
      slotIds: state.slotIds,
      connections,
      images,
      observationFrame: state.mode === 'motion' ? state.observationFrame ?? undefined : undefined,
      ...(pageContext && (pageContext.detectedLibraries.length > 0 || pageContext.detectedHints.length > 0)
        ? { pageContext: { detectedLibraries: pageContext.detectedLibraries, detectedHints: pageContext.detectedHints } }
        : {}),
    };

    // #region agent log
    if (state.mode === 'motion' && payload.images) {
      const logA = { sessionId: '62a955', location: 'assistant.ts:payload', message: 'content script sending motion payload', data: { mode: payload.mode, imagesLength: (payload.images as string[]).length, connectionsLength: payload.connections?.length ?? 0 }, hypothesisId: 'A', timestamp: Date.now() };
      console.log('[motion-debug]', JSON.stringify(logA));
      fetch('http://127.0.0.1:7912/ingest/44514764-7d00-4f93-8141-03f86e3272e2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '62a955' }, body: JSON.stringify(logA) }).catch(() => {});
    }
    // #endregion

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.ASSISTANT_SEND_REQUEST,
        payload,
      });
      if (response?.ok) {
        const r = response.result;
        resultEl.classList.remove('error');
        if (state.mode === 'motion' && (r.motionDescription || r.structured || r.text)) {
          recordedFrames = [];
          resultImageWrap.style.display = 'none';
          if (resultImageDescriptions) resultImageDescriptions.style.display = 'none';
          resultPromptToggle.style.display = 'none';
          resultTextEl.textContent = r.motionDescription ?? r.text ?? '';
          resultTextEl.style.display = resultTextEl.textContent ? 'block' : 'none';
          if (resultMotionStructured && resultMotionStructuredJson) {
            if (r.structured) {
              resultMotionStructured.style.display = 'block';
              resultMotionStructuredJson.textContent = JSON.stringify(r.structured, null, 2);
            } else {
              resultMotionStructured.style.display = 'none';
            }
          }
        } else if (r.imageUrl) {
          if (resultMotionStructured) resultMotionStructured.style.display = 'none';
          resultTextEl.style.display = 'none';
          resultImageWrap.innerHTML = '';
          const img = document.createElement('img');
          img.src = r.imageUrl;
          img.alt = 'Generated image';
          img.className = 'result-img';
          resultImageWrap.appendChild(img);
          resultImageWrap.style.display = 'block';
        } else {
          resultImageWrap.innerHTML = '';
          resultImageWrap.style.display = 'none';
        }
        if (state.mode !== 'motion' && resultImageDescriptions && resultImageDescriptionsList) {
          const orderedSlotIds = state.slotIds.filter((slotId) => getEdgeBySlot(state, slotId));
          const summaryEl = resultImageDescriptions.querySelector('summary');
          if (summaryEl) summaryEl.textContent = `Descriptions (${orderedSlotIds.length})`;
          resultImageDescriptionsList.innerHTML = '';
          orderedSlotIds.forEach((slotId, i) => {
            const block = document.createElement('div');
            block.className = 'result-image-desc-item';
            const slotTitle = state.slotTitles[slotId] ?? slotId;
            const h = document.createElement('strong');
            h.textContent = `${slotTitle}: `;
            block.appendChild(h);
            let text = r.imageDescriptions?.[i] ?? '—';
            if (text !== '—' && slotTitle) {
              const prefix = slotTitle + ': ';
              if (text.startsWith(prefix)) text = text.slice(prefix.length);
              else if (text.toLowerCase().startsWith(slotTitle.toLowerCase() + ': ')) {
                text = text.slice(slotTitle.length + 2);
              }
            }
            block.appendChild(document.createTextNode(text));
            resultImageDescriptionsList.appendChild(block);
          });
          resultImageDescriptions.style.display = 'block';
        }
        if (state.mode !== 'motion') {
          if (resultMotionStructured) resultMotionStructured.style.display = 'none';
        }
        if (r.generatedPrompt && state.mode !== 'motion') {
          resultPromptText.textContent = r.generatedPrompt;
          resultPromptToggle.style.display = 'block';
          resultPromptToggle.setAttribute('open', '');
        } else {
          resultPromptToggle.style.display = 'none';
        }
        if (state.mode !== 'motion') resultTextEl.style.display = 'none';
      } else {
        resultImageWrap.innerHTML = '';
        resultImageWrap.style.display = 'none';
        if (resultImageDescriptions) resultImageDescriptions.style.display = 'none';
        resultPromptToggle.style.display = 'none';
        if (resultMotionStructured) resultMotionStructured.style.display = 'none';
        resultTextEl.textContent = response?.error ?? 'Error';
        resultTextEl.style.display = 'block';
        resultEl.classList.add('error');
      }
      resultEl.style.display = 'block';
    } catch (err) {
      resultImageWrap.innerHTML = '';
      resultImageWrap.style.display = 'none';
      if (resultImageDescriptions) resultImageDescriptions.style.display = 'none';
      resultPromptToggle.style.display = 'none';
      resultTextEl.textContent = String(err);
      resultTextEl.style.display = 'block';
      resultEl.classList.add('error');
      resultEl.style.display = 'block';
    }
    statusEl.textContent = '';
    sendBtn.disabled = false;
  });

  const doScrollResizeWork = () => {
    updateSvgViewBox();
    if (state.edges.length === 0) return;
    revalidateTargets(state);
    state.targets.forEach((t) => {
      const el = resolveTargetEl(t);
      if (el) {
        const r = el.getBoundingClientRect();
        updateTargetRect(state, t.id, {
          x: r.left + window.scrollX,
          y: r.top + window.scrollY,
          width: r.width,
          height: r.height,
        });
      }
    });
    renderRopes();
  };
  let scrollResizeTimer: ReturnType<typeof setTimeout> | null = null;
  const SCROLL_DEBOUNCE_MS = 600;
  const scrollOrResize = () => {
    if (scrollResizeTimer) clearTimeout(scrollResizeTimer);
    scrollResizeTimer = setTimeout(() => {
      scrollResizeTimer = null;
      doScrollResizeWork();
    }, SCROLL_DEBOUNCE_MS);
  };
  window.addEventListener('scroll', scrollOrResize, { passive: true });
  window.addEventListener('resize', scrollOrResize);

  try {
    const scrollables = document.querySelectorAll('[data-pinterest-scroll], .mainContent, [role="main"], [data-test-id="pin-feed"], [data-test-id="scrollable-content"]');
    scrollables.forEach((el) => el.addEventListener('scroll', scrollOrResize, { passive: true }));
  } catch (_) {}

  setInterval(() => {
    if (state.edges.length === 0 || document.visibilityState !== 'visible') return;
    renderRopes();
  }, 32);

  /* MutationObserver отключён: на Pinterest DOM меняется постоянно (лента, lazy-load),
     наблюдение за body вызывает тяжёлую работу и зависания. Пересчёт позиций — только по scroll/resize. */

  const copyPromptBtn = shadow.querySelector('[data-copy-prompt]') as HTMLButtonElement;
  if (copyPromptBtn) {
    copyPromptBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = resultPromptText?.textContent?.trim();
      if (text && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          copyPromptBtn.textContent = 'Copied';
          setTimeout(() => { copyPromptBtn.textContent = 'Copy'; }, 1500);
        }).catch(() => {});
      }
    });
  }
  const copyMotionBtn = shadow.querySelector('[data-copy-motion]') as HTMLButtonElement;
  if (copyMotionBtn) {
    copyMotionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fullText = resultTextEl?.textContent?.trim();
      const jsonText = resultMotionStructuredJson?.textContent?.trim();
      const text = fullText || jsonText || '';
      if (text && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          copyMotionBtn.textContent = 'Copied';
          setTimeout(() => { copyMotionBtn.textContent = 'Copy'; }, 1500);
        }).catch(() => {});
      }
    });
  }

  updateModeUI();
  renderSlots();
  updateConnectionsList();

  return { root, shadow, getState, setState };
}
