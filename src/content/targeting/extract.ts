/**
 * Extract metadata from DOM elements for linked targets.
 */

import type { TargetMeta, TargetType, Rect } from '../../shared/types';
import { buildLocator } from './locators';

function getRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return {
    x: r.left + window.scrollX,
    y: r.top + window.scrollY,
    width: r.width,
    height: r.height,
  };
}

function getImageMeta(img: HTMLImageElement): TargetMeta {
  const meta: TargetMeta = {
    tagName: img.tagName,
    src: img.currentSrc || img.src || undefined,
    alt: img.alt || undefined,
    title: img.title || undefined,
    naturalWidth: img.naturalWidth || undefined,
    naturalHeight: img.naturalHeight || undefined,
  };
  if (img.srcset) meta.srcset = img.srcset;
  const anchor = img.closest('a');
  if (anchor?.href) meta.href = anchor.href;
  return meta;
}

function getAnchorMeta(a: HTMLAnchorElement): TargetMeta {
  const meta: TargetMeta = {
    tagName: a.tagName,
    href: a.href || undefined,
    title: a.title || undefined,
    textContent: a.textContent?.slice(0, 500)?.trim() || undefined,
  };
  const img = a.querySelector('img');
  if (img) {
    meta.src = img.currentSrc || img.src || undefined;
    meta.alt = img.alt || undefined;
  }
  return meta;
}

function getGenericMeta(el: Element): TargetMeta {
  const meta: TargetMeta = {
    tagName: el.tagName,
    textContent: el.textContent?.slice(0, 500)?.trim() || undefined,
  };
  const anchor = el.closest('a');
  if (anchor?.href) meta.href = anchor.href;
  return meta;
}

export function inferTargetType(el: Element): TargetType {
  if (el instanceof HTMLImageElement) return 'image';
  if (el instanceof HTMLAnchorElement) return 'link';
  const img = el.querySelector('img');
  if (img) return 'image';
  if (el.closest('a')) return 'link';
  const text = el.textContent?.trim();
  if (text && text.length < 2000) return 'text';
  return 'element';
}

export function extractTargetMeta(el: Element): TargetMeta {
  if (el instanceof HTMLImageElement) return getImageMeta(el);
  if (el instanceof HTMLAnchorElement) return getAnchorMeta(el);
  const img = el.querySelector('img');
  if (img) return getImageMeta(img);
  return getGenericMeta(el);
}

export interface ExtractedTarget {
  id: string;
  targetType: TargetType;
  pageUrl: string;
  locator: ReturnType<typeof buildLocator>;
  meta: TargetMeta;
  rect: Rect;
  timestamp: number;
}

export function extractTarget(el: Element, id: string): ExtractedTarget {
  return {
    id,
    targetType: inferTargetType(el),
    pageUrl: window.location.href,
    locator: buildLocator(el),
    meta: extractTargetMeta(el),
    rect: getRect(el),
    timestamp: Date.now(),
  };
}
