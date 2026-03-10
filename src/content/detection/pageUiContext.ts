/**
 * Lightweight detection of UI library / framework signals on the page.
 * Used in motion mode to tailor component naming and code prompt to the detected ecosystem.
 */

const MAX_NODES_TO_SCAN = 800;
const MAX_HINTS_PER_LIBRARY = 5;

const LIBRARY_SIGNALS: Array<{
  id: string;
  label: string;
  classPrefixes: RegExp[];
  dataAttrs: RegExp[];
}> = [
  {
    id: 'MUI',
    label: 'MUI (Material-UI)',
    classPrefixes: [/^Mui[A-Z]/, /^makeStyles-/, /^StyledBox/],
    dataAttrs: [/^data-mui/],
  },
  {
    id: 'Chakra',
    label: 'Chakra UI',
    classPrefixes: [/^chakra-/, /^css-/],
    dataAttrs: [],
  },
  {
    id: 'Ant',
    label: 'Ant Design',
    classPrefixes: [/^ant-/, /^antd/],
    dataAttrs: [],
  },
  {
    id: 'Radix',
    label: 'Radix UI',
    classPrefixes: [/^radix-/, /^rt-/],
    dataAttrs: [/^data-radix-/],
  },
  {
    id: 'Blueprint',
    label: 'Blueprint',
    classPrefixes: [/^bp3-/, /^bp4-/],
    dataAttrs: [],
  },
  {
    id: 'PrimeReact',
    label: 'PrimeReact',
    classPrefixes: [/^p-/, /^p-component/],
    dataAttrs: [],
  },
  {
    id: 'Element',
    label: 'Element UI',
    classPrefixes: [/^el-/, /^el-icon/],
    dataAttrs: [],
  },
];

export interface PageUiContextResult {
  detectedLibraries: string[];
  detectedHints: string[];
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(value));
}

export function detectPageUiContext(root?: Document | Element): PageUiContextResult {
  const doc = root && 'body' in root ? (root as Document) : document;
  const counts: Record<string, number> = {};
  const hintsByLib: Record<string, Set<string>> = {};

  for (const lib of LIBRARY_SIGNALS) {
    counts[lib.id] = 0;
    hintsByLib[lib.id] = new Set();
  }

  const walker = doc.createTreeWalker(
    doc.body ?? doc,
    NodeFilter.SHOW_ELEMENT,
    null,
    // @ts-expect-error legacy
    false
  );

  let nodesScanned = 0;
  let node: Element | null = walker.currentNode as Element | null;

  while (node && nodesScanned < MAX_NODES_TO_SCAN) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const className = el.className && typeof el.className === 'string' ? el.className : '';
      const classList = className.split(/\s+/).filter(Boolean);

      for (const lib of LIBRARY_SIGNALS) {
        for (const cls of classList) {
          if (matchesAny(cls, lib.classPrefixes)) {
            counts[lib.id] = (counts[lib.id] ?? 0) + 1;
            if (hintsByLib[lib.id].size < MAX_HINTS_PER_LIBRARY) {
              hintsByLib[lib.id].add(cls);
            }
            break;
          }
        }

        for (let i = 0; i < el.attributes.length; i++) {
          const name = el.attributes[i].name;
          if (matchesAny(name, lib.dataAttrs)) {
            counts[lib.id] = (counts[lib.id] ?? 0) + 1;
            if (hintsByLib[lib.id].size < MAX_HINTS_PER_LIBRARY) {
              hintsByLib[lib.id].add(name);
            }
            break;
          }
        }
      }
    }

    node = walker.nextNode() as Element | null;
    nodesScanned++;
  }

  const sorted = LIBRARY_SIGNALS.filter((lib) => (counts[lib.id] ?? 0) > 0)
    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
    .slice(0, 3)
    .map((lib) => lib.id);

  const allHints: string[] = [];
  for (const lib of LIBRARY_SIGNALS) {
    if ((counts[lib.id] ?? 0) > 0) {
      allHints.push(...Array.from(hintsByLib[lib.id]).slice(0, 3));
    }
  }

  return {
    detectedLibraries: sorted,
    detectedHints: allHints.slice(0, 10),
  };
}
