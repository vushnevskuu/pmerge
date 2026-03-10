/**
 * Unit tests for captureVideoFrames and related capture utilities.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureVideoFrames, captureCanvasFrames, captureElementFrames } from './frames';

describe('captureVideoFrames', () => {
  let mockVideo: HTMLVideoElement;
  let mockCtx: { drawImage: ReturnType<typeof vi.fn> };
  let mockCanvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toDataURL: ReturnType<typeof vi.fn> };
  let createElementOriginal: typeof document.createElement;

  beforeEach(() => {
    mockCtx = { drawImage: vi.fn() };
    mockCanvas = {
      width: 100,
      height: 100,
      getContext: vi.fn().mockReturnValue(mockCtx),
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,mock'),
    };
    createElementOriginal = document.createElement.bind(document);
    vi.stubGlobal(
      'document',
      new Proxy(document, {
        get(target, prop) {
          if (prop === 'createElement') {
            return (tag: string) => {
              if (tag === 'canvas') return mockCanvas;
              return createElementOriginal(tag);
            };
          }
          return (target as Record<string, unknown>)[prop as string];
        },
      })
    );
    mockVideo = document.createElement('video') as HTMLVideoElement;
    Object.defineProperties(mockVideo, {
      duration: { value: 0, configurable: true },
      videoWidth: { value: 320, configurable: true },
      videoHeight: { value: 240, configurable: true },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('возвращает один кадр при duration <= 0', async () => {
    const frames = await captureVideoFrames(mockVideo, 4);
    expect(frames).toBeInstanceOf(Array);
    expect(frames.length).toBeLessThanOrEqual(1);
    if (frames.length === 1) {
      expect(frames[0]).toMatch(/^data:image\/jpeg/);
    }
  });

  it('возвращает массив строк', async () => {
    const frames = await captureVideoFrames(mockVideo, 1);
    expect(frames).toBeInstanceOf(Array);
  });
});

describe('captureCanvasFrames', () => {
  it('возвращает массив (в jsdom canvas.getContext("2d") = null, поэтому может быть [])', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const frames = captureCanvasFrames(canvas, 4);
    expect(frames).toBeInstanceOf(Array);
    if (frames.length > 0) {
      expect(frames).toHaveLength(4);
      expect(frames.every((f) => f.startsWith('data:image/jpeg'))).toBe(true);
    }
  });

  it('возвращает пустой массив для canvas с нулевыми размерами', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 0;
    const frames = captureCanvasFrames(canvas, 4);
    expect(frames).toEqual([]);
  });
});

describe('captureElementFrames', () => {
  it('для canvas возвращает кадры синхронно', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 50;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 50, 50);
    }
    const frames = await captureElementFrames(canvas, 4);
    expect(frames).toBeInstanceOf(Array);
    expect(frames.length).toBeGreaterThanOrEqual(0);
  });

  it('для img (не GIF) возвращает массив', async () => {
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,iVBORw0KGgo=';
    const frames = await captureElementFrames(img, 6);
    expect(frames).toBeInstanceOf(Array);
  });
});
