/**
 * Build and resolve locators for DOM elements. Used for re-validation after mutations.
 * На Pinterest DOM переиспользуется при скролле — привязка по контенту (src) надёжнее селекторов.
 */

import type { Locator, GraphTarget } from '../../shared/types';

export function getCssSelector(el: Element): string | undefined {
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`;
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    let part = current.tagName.toLowerCase();
    if (current.id && /^[a-zA-Z][\w-]*$/.test(current.id)) {
      path.unshift(`#${current.id}`);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0 && classes.length <= 3) {
        part += '.' + classes.slice(0, 2).join('.');
      }
    }
    let idx = 0;
    let sib: Element | null = current;
    while (sib?.previousElementSibling) {
      sib = sib.previousElementSibling;
      if (sib.tagName === current.tagName) idx++;
    }
    if (idx > 0) part += `:nth-of-type(${idx + 1})`;
    path.unshift(part);
    current = current.parentElement;
  }
  return path.length ? path.join(' > ') : undefined;
}

export function getXPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let idx = 1;
    let sib: Element | null = current.previousElementSibling;
    while (sib) {
      if (sib.tagName === current.tagName) idx++;
      sib = sib.previousElementSibling;
    }
    const tag = current.tagName.toLowerCase();
    parts.unshift(`${tag}[${idx}]`);
    current = current.parentElement;
  }
  return '/' + parts.join('/');
}

export function buildLocator(el: Element): Locator {
  const css = getCssSelector(el);
  const xpath = getXPath(el);
  const primary = css ?? xpath;
  return { primary, css, xpath };
}

export function resolveByLocator(locator: Locator, doc: Document): Element | null {
  try {
    const trySelector = (s: string): Element | null => {
      try {
        return doc.querySelector(s);
      } catch {
        return null;
      }
    };
    if (locator.primary && !locator.primary.startsWith('/')) {
      const el = trySelector(locator.primary);
      if (el) return el;
    }
    if (locator.css) {
      const el = trySelector(locator.css);
      if (el) return el;
    }
    if (locator.xpath) {
      try {
        const result = doc.evaluate(
          locator.xpath,
          doc,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue as Element | null;
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function matchesTargetMeta(el: Element, target: GraphTarget): boolean {
  const { meta } = target;
  if (el instanceof HTMLImageElement) {
    const src = el.currentSrc || el.src;
    if (meta.src && src) {
      try {
        const a = new URL(meta.src);
        const b = new URL(src);
        if (a.pathname === b.pathname || a.href === b.href) return true;
      } catch {
        if (src === meta.src) return true;
      }
    }
    const anchor = el.closest('a');
    if (meta.href && anchor?.href === meta.href) return true;
  }
  const anchor = el.closest('a');
  if (anchor && meta.href && anchor.href === meta.href) return true;
  return !meta.src && !meta.href;
}

function resolveByHref(target: GraphTarget, doc: Document): Element | null {
  const href = target.meta?.href;
  if (!href) return null;
  const anchors = doc.querySelectorAll('a[href]');
  for (const a of anchors) {
    if (a.href !== href) continue;
    const img = a.querySelector('img');
    if (img && target.targetType === 'image') return img;
    if (target.targetType === 'link') return a;
    if (img) return img;
    return a;
  }
  return null;
}

function resolveByRect(target: GraphTarget, doc: Document): Element | null {
  const { rect } = target;
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const cx = rect.x + rect.width / 2 - (typeof window !== 'undefined' ? window.scrollX : 0);
  const cy = rect.y + rect.height / 2 - (typeof window !== 'undefined' ? window.scrollY : 0);
  const el = doc.elementFromPoint(cx, cy);
  if (!el || el === doc.body) return null;
  const img = el instanceof HTMLImageElement ? el : el.querySelector('img');
  if (img && target.targetType === 'image' && matchesTargetMeta(img, target)) return img;
  if (el.closest('a') && target.meta?.href) {
    const a = el.closest('a')!;
    if (a.href === target.meta.href) return a.querySelector('img') || a;
  }
  return img || el;
}

/**
 * Разрешает цель: locator → проверка по meta → fallback по href → fallback по rect.
 * На Pinterest DOM переиспользуется — querySelector часто возвращает не тот пин.
 */
export function resolveTarget(target: GraphTarget, doc: Document): Element | null {
  const byLocator = resolveByLocator(target.locator, doc);
  if (byLocator && matchesTargetMeta(byLocator, target)) return byLocator;

  const byHref = resolveByHref(target, doc);
  if (byHref) return byHref;

  const byRect = resolveByRect(target, doc);
  if (byRect && matchesTargetMeta(byRect, target)) return byRect;

  return null;
}
