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

/**
 * Разрешает цель по locator. Поиск по src отключён — querySelectorAll('img') на Pinterest тормозит страницу.
 */
export function resolveTarget(target: GraphTarget, doc: Document): Element | null {
  return resolveByLocator(target.locator, doc);
}
