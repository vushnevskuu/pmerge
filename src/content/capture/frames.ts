/**
 * Capture frames from video, GIF, or canvas for motion analysis.
 * Used in motion mode to send frame sequence to vision API.
 * Fallback: captureVisibleTab for elements we can't draw (iframe, svg, div).
 */

import { MESSAGE_TYPES } from '../../shared/types';

const DEFAULT_FRAME_COUNT = 10;
const GIF_FRAME_COUNT = 8;
const JPEG_QUALITY = 0.85;

/**
 * Capture N evenly spaced frames from a video element.
 */
export async function captureVideoFrames(
  video: HTMLVideoElement,
  count: number = DEFAULT_FRAME_COUNT
): Promise<string[]> {
  const duration = video.duration;
  let w = video.videoWidth;
  let h = video.videoHeight;
  if (w <= 0 || h <= 0) {
    const rect = video.getBoundingClientRect();
    w = Math.round(rect.width) || 320;
    h = Math.round(rect.height) || 240;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    const single = drawFrameToDataUrl(video, w, h);
    return single ? [single] : [];
  }

  const frames: string[] = [];
  const step = count <= 1 ? 0 : duration / (count - 1);

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? duration / 2 : i * step;
    const dataUrl = await seekAndCapture(video, t);
    if (dataUrl) frames.push(dataUrl);
  }

  return frames;
}

function seekAndCapture(video: HTMLVideoElement, time: number): Promise<string | null> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      let w = video.videoWidth;
      let h = video.videoHeight;
      if (w <= 0 || h <= 0) {
        const rect = video.getBoundingClientRect();
        w = Math.round(rect.width) || 320;
        h = Math.round(rect.height) || 240;
      }
      const dataUrl = drawFrameToDataUrl(video, w, h);
      resolve(dataUrl);
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve(null);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = Math.max(0, Math.min(time, video.duration));
  });
}

function drawFrameToDataUrl(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  sw: number,
  sh: number
): string | null {
  if (sw <= 0 || sh <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(sw, 1024);
  canvas.height = Math.min(sh, 1024);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(source, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    return null;
  }
}

/**
 * Capture frames from a GIF image by drawing at small time offsets.
 * GIF animation cannot be precisely controlled; we use approximate frame sampling.
 */
export async function captureGifFrames(
  img: HTMLImageElement,
  count: number = GIF_FRAME_COUNT
): Promise<string[]> {
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (w <= 0 || h <= 0) {
    const single = drawFrameToDataUrl(img, img.width || 100, img.height || 100);
    return single ? [single] : [];
  }

  const frames: string[] = [];
  const delay = 150;
  for (let i = 0; i < count; i++) {
    await new Promise((r) => setTimeout(r, i * delay));
    const dataUrl = drawFrameToDataUrl(img, w, h);
    if (dataUrl) frames.push(dataUrl);
  }
  return frames;
}

/**
 * Capture frames from a canvas by copying its current state.
 */
export function captureCanvasFrames(canvas: HTMLCanvasElement, count: number = GIF_FRAME_COUNT): string[] {
  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return [];
  const dataUrl = drawFrameToDataUrl(canvas, w, h);
  if (!dataUrl) return [];
  return Array(count).fill(dataUrl);
}

function getFrameDimensions(el: Element): { w: number; h: number } {
  if (el instanceof HTMLVideoElement) {
    const w = el.videoWidth || el.getBoundingClientRect().width;
    const h = el.videoHeight || el.getBoundingClientRect().height;
    return { w: w || 320, h: h || 240 };
  }
  if (el instanceof HTMLImageElement) {
    return { w: el.naturalWidth || el.width || 100, h: el.naturalHeight || el.height || 100 };
  }
  if (el instanceof HTMLCanvasElement) {
    return { w: el.width, h: el.height };
  }
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width) || 320, h: Math.round(r.height) || 240 };
}

/**
 * Capture frames from an element: video → video frames, img (GIF) → GIF frames,
 * canvas → canvas copy; otherwise one static frame via drawImage.
 * If roiRect is provided, each frame is cropped to the ROI (viewport coords).
 */
export async function captureElementFrames(
  el: Element,
  count: number = DEFAULT_FRAME_COUNT,
  roiRect?: ViewportRect | null
): Promise<string[]> {
  let frames: string[];
  if (el instanceof HTMLVideoElement) {
    frames = await captureVideoFrames(el, count);
  } else if (el instanceof HTMLImageElement) {
    const isGif = /\.gif$/i.test(el.src || '') || (el.src || '').toLowerCase().includes('gif');
    if (isGif) frames = await captureGifFrames(el, Math.min(count, GIF_FRAME_COUNT));
    else {
      const single = drawFrameToDataUrl(el, el.naturalWidth || el.width, el.naturalHeight || el.height);
      frames = single ? [single] : [];
    }
  } else if (el instanceof HTMLCanvasElement) {
    frames = captureCanvasFrames(el, Math.min(count, GIF_FRAME_COUNT));
  } else {
    const staticResult = await captureStaticFrame(el);
    frames = staticResult.length > 0 ? staticResult : await captureByScreenshot(el, count, roiRect);
  }
  if (!roiRect || frames.length === 0) return frames;
  const elementRect = el.getBoundingClientRect();
  const { w: fw, h: fh } = getFrameDimensions(el);
  const cropped: string[] = [];
  for (const frame of frames) {
    const c = await cropFrameByRoi(frame, roiRect, elementRect, fw, fh);
    if (c) cropped.push(c);
  }
  return cropped.length > 0 ? cropped : frames;
}

/**
 * Fallback: capture via chrome.tabs.captureVisibleTab. Works for iframes, SVG, divs, any visible element.
 * Captures more frames over ~1.5s to catch micro-animations; caller should subsample to API limit (5).
 */
const MOTION_CAPTURE_FRAMES = 10;
const MOTION_CAPTURE_DELAY_MS = 160;

async function captureByScreenshot(
  el: Element,
  count: number = MOTION_CAPTURE_FRAMES,
  roiRect?: ViewportRect | null
): Promise<string[]> {
  const elementRect = el.getBoundingClientRect();
  if (elementRect.width <= 0 || elementRect.height <= 0) return [];
  const rect = roiRect
    ? (() => {
        const isectLeft = Math.max(roiRect.x, elementRect.left);
        const isectTop = Math.max(roiRect.y, elementRect.top);
        const isectRight = Math.min(roiRect.x + roiRect.width, elementRect.right);
        const isectBottom = Math.min(roiRect.y + roiRect.height, elementRect.bottom);
        const w = isectRight - isectLeft;
        const h = isectBottom - isectTop;
        if (w <= 0 || h <= 0) return elementRect;
        return new DOMRect(isectLeft, isectTop, w, h);
      })()
    : elementRect;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const frames: string[] = [];
  const delay = MOTION_CAPTURE_DELAY_MS;
  for (let i = 0; i < count; i++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB });
      if (resp?.dataUrl) {
        const cropped = await cropScreenshotToRect(resp.dataUrl, rect, dpr);
        if (cropped) frames.push(cropped);
      }
    } catch {
      break;
    }
    if (i < count - 1) await new Promise((r) => setTimeout(r, delay));
  }
  return frames;
}

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crop a full-frame data URL to the ROI region.
 * roiRect and elementRect are in viewport coordinates.
 * frameWidth/frameHeight are the pixel dimensions of the source image.
 */
export function cropFrameByRoi(
  dataUrl: string,
  roiRect: ViewportRect,
  elementRect: DOMRect,
  frameWidth: number,
  frameHeight: number
): Promise<string | null> {
  const roi = { left: roiRect.x, top: roiRect.y, right: roiRect.x + roiRect.width, bottom: roiRect.y + roiRect.height };
  const el = { left: elementRect.left, top: elementRect.top, right: elementRect.right, bottom: elementRect.bottom };
  const isectLeft = Math.max(roi.left, el.left);
  const isectTop = Math.max(roi.top, el.top);
  const isectRight = Math.min(roi.right, el.right);
  const isectBottom = Math.min(roi.bottom, el.bottom);
  const isectW = isectRight - isectLeft;
  const isectH = isectBottom - isectTop;
  if (isectW <= 0 || isectH <= 0 || elementRect.width <= 0 || elementRect.height <= 0) return Promise.resolve(null);
  const relX = (isectLeft - elementRect.left) / elementRect.width;
  const relY = (isectTop - elementRect.top) / elementRect.height;
  const relW = isectW / elementRect.width;
  const relH = isectH / elementRect.height;
  const sx = Math.max(0, Math.floor(relX * frameWidth));
  const sy = Math.max(0, Math.floor(relY * frameHeight));
  const sw = Math.max(1, Math.min(Math.ceil(relW * frameWidth), frameWidth - sx));
  const sh = Math.max(1, Math.min(Math.ceil(relH * frameHeight), frameHeight - sy));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSize = 1024;
      const scale = Math.min(1, maxSize / sw, maxSize / sh);
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      try {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Capture a single frame from the visible tab cropped to the ROI.
 * Used during recording to capture one frame per tick.
 */
export async function captureSingleFrameRoi(roiRect: ViewportRect): Promise<string | null> {
  if (roiRect.width <= 0 || roiRect.height <= 0) return null;
  const rect = new DOMRect(roiRect.x, roiRect.y, roiRect.width, roiRect.height);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  try {
    const resp = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB });
    if (!resp?.dataUrl) return null;
    return await cropScreenshotToRect(resp.dataUrl, rect, dpr);
  } catch {
    return null;
  }
}

/**
 * Capture frames from the visible tab cropped to the ROI (viewport rect).
 * Use when motion mode has only ROI and no linked video/canvas.
 */
export async function captureViewportRoiFrames(
  roiRect: ViewportRect,
  count: number = MOTION_CAPTURE_FRAMES
): Promise<string[]> {
  if (roiRect.width <= 0 || roiRect.height <= 0) return [];
  const rect = new DOMRect(roiRect.x, roiRect.y, roiRect.width, roiRect.height);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB });
      if (resp?.dataUrl) {
        const cropped = await cropScreenshotToRect(resp.dataUrl, rect, dpr);
        if (cropped) frames.push(cropped);
      }
    } catch {
      break;
    }
    if (i < count - 1) await new Promise((r) => setTimeout(r, MOTION_CAPTURE_DELAY_MS));
  }
  return frames;
}

/** Pick n evenly spaced frames from arr (for API limit). */
export function subsampleFrames(frames: string[], maxCount: number): string[] {
  if (frames.length === 0) return [];
  if (frames.length <= maxCount) return frames;
  if (maxCount <= 1) return [frames[0]];
  const step = (frames.length - 1) / (maxCount - 1);
  return Array.from({ length: maxCount }, (_, i) => frames[Math.round(i * step)]!);
}

function cropScreenshotToRect(
  dataUrl: string,
  rect: DOMRect,
  dpr: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.max(0, Math.min(rect.left * dpr, img.naturalWidth - 1));
      const sy = Math.max(0, Math.min(rect.top * dpr, img.naturalHeight - 1));
      const sw = Math.min(rect.width * dpr, img.naturalWidth - sx);
      const sh = Math.min(rect.height * dpr, img.naturalHeight - sy);
      if (sw <= 0 || sh <= 0) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      const maxSize = 1024;
      const scale = Math.min(1, maxSize / sw, maxSize / sh);
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      try {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function captureStaticFrame(el: Element): Promise<string[]> {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];
  const canvas = document.createElement('canvas');
  const maxSize = 1024;
  const scale = Math.min(1, maxSize / rect.width, maxSize / rect.height);
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  try {
    ctx.drawImage(el as CanvasImageSource, 0, 0, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    return dataUrl ? [dataUrl] : [];
  } catch {
    return [];
  }
}
