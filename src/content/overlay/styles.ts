/**
 * Isolated styles for overlay. Applied inside Shadow DOM.
 */

export const overlayStyles = `
  :host, * { box-sizing: border-box; }
  .root {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
  }
  .svg-layer {
    position: fixed;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    width: 100%;
    height: 100%;
  }
  .svg-layer path {
    pointer-events: none;
    fill: none;
    stroke: #2563eb;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .svg-layer path.temp { stroke: #64748b; stroke-dasharray: 6 4; stroke-width: 2; }
  .svg-layer path.active { stroke: #2563eb; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1)); }
  .svg-layer path.broken { stroke: #dc2626; stroke-dasharray: 6 3; }
  .assistant-wrap {
    position: fixed;
    z-index: 2;
    pointer-events: auto;
    min-width: 320px;
    max-width: 420px;
    background: rgba(255, 255, 255, 0.65);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.6) inset;
    border: 1px solid rgba(255, 255, 255, 0.5);
    overflow: hidden;
    isolation: isolate;
  }
  .assistant-header {
    padding: 10px 14px;
    background: rgba(249, 250, 251, 0.6);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(229, 231, 235, 0.8);
    cursor: grab;
    user-select: none;
    touch-action: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .assistant-header:active { cursor: grabbing; }
  .assistant-header::before {
    content: "⋮⋮";
    font-size: 14px;
    color: #9ca3af;
    letter-spacing: -2px;
  }
  .assistant-title { font-weight: 600; color: #111; flex: 1; }
  .assistant-header .drag-hint { font-size: 11px; color: #9ca3af; }
  .assistant-body { padding: 14px; }
  .assistant-body textarea {
    width: 100%;
    min-height: 80px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid rgba(229, 231, 235, 0.9);
    border-radius: 8px;
    resize: vertical;
    font: inherit;
  }
  .assistant-body textarea:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37,99,235,0.2);
  }
  .send-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .send-btn {
    padding: 8px 16px;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 8px;
    font: inherit;
    cursor: pointer;
  }
  .send-btn:hover { background: #1d4ed8; }
  .send-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .slots {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    margin-top: 10px;
  }
  .slot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(243, 244, 246, 0.6);
    border-radius: 8px;
    border: 1px solid rgba(229, 231, 235, 0.8);
    width: 100%;
    max-width: 100%;
  }
  .slot-add-btn {
    margin-top: 6px;
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 18px;
    line-height: 1;
    border: 1px dashed rgba(156, 163, 175, 0.8);
    border-radius: 6px;
    background: rgba(243, 244, 246, 0.6);
    color: #6b7280;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .slot-add-btn:hover {
    background: rgba(229, 231, 235, 0.8);
    color: #374151;
  }
  .port-dot {
    width: 16px;
    height: 16px;
    min-width: 16px;
    min-height: 16px;
    border-radius: 50%;
    background: #2563eb;
    border: 2px solid #1d4ed8;
    cursor: crosshair;
    flex-shrink: 0;
  }
  .port-dot:hover { background: #1d4ed8; }
  .slot-title {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    font-size: 12px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    font: inherit;
  }
  .slot-title:hover, .slot-title:focus {
    border-color: rgba(229, 231, 235, 0.9);
    outline: none;
  }
  .connections-list { margin-top: 8px; font-size: 12px; }
  .connections-list summary { cursor: pointer; color: #6b7280; }
  .connection-slot {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }
  .connection-slot-title { color: #6b7280; font-weight: 500; }
  .connection-slot-label { flex: 1; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
  .connection-slot button { padding: 2px 6px; font-size: 11px; cursor: pointer; color: #dc2626; background: rgba(255,255,255,0.5); border: 1px solid rgba(229, 231, 235, 0.9); border-radius: 4px; flex-shrink: 0; }
  .connection-slot button:hover { background: #fef2f2; }
  .status { margin-top: 10px; font-size: 12px; color: #6b7280; min-height: 1.2em; }
  .result {
    margin-top: 10px;
    padding: 10px 12px;
    background: rgba(243, 244, 246, 0.6);
    border-radius: 8px;
    font-size: 13px;
  }
  .result-img {
    width: 100%;
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    display: block;
  }
  .result-image-wrap { margin-bottom: 8px; }
  .result-image-descriptions {
    margin-top: 8px;
    font-size: 12px;
  }
  .result-image-descriptions summary {
    cursor: pointer;
    color: #6b7280;
    user-select: none;
  }
  .result-image-desc-item {
    margin-top: 8px;
    padding: 8px;
    background: rgba(229, 231, 235, 0.8);
    border-radius: 6px;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .result-image-desc-item:first-child { margin-top: 6px; }
  .result-prompt-toggle {
    margin-top: 8px;
    font-size: 12px;
  }
  .result-prompt-toggle summary {
    cursor: pointer;
    color: #6b7280;
    user-select: none;
  }
  .result-prompt-text {
    margin: 6px 0 0;
    padding: 8px;
    background: rgba(229, 231, 235, 0.8);
    border-radius: 6px;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
  }
  .result-text {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .result.error { background: rgba(254, 242, 242, 0.9); color: #991b1b; }
  .highlight-box {
    position: fixed;
    border: 2px solid #2563eb;
    border-radius: 4px;
    pointer-events: none;
    z-index: 0;
  }
`;
