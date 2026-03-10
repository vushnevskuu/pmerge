/**
 * UI libraries / design systems reference for motion analysis.
 * Injected into the motion system prompt so the model uses precise component and pattern names.
 */

export const UI_LIBRARIES_REFERENCE = `
==================================================
UI LIBRARIES REFERENCE (use for precise naming)
==================================================

When describing the element and writing the code-generation prompt (#11), use terminology from this reference. If the page context indicates a detected library, prefer that ecosystem's names and patterns.

Material Design / MUI (Material-UI):
- IconButton, Button (contained/outlined/text), FAB (Floating Action Button), Chip, Badge
- Bottom navigation, Navigation bar, App bar, Back button (chevron left), Drawer, Snackbar, Dialog
- Ripple effect, elevation, filled/outlined icon (e.g. left-pointing chevron for "back")
- Motion: ripple on press, elevation change on hover, ~200ms transitions, ease-out

Apple HIG (Human Interface Guidelines):
- Navigation bar back button (chevron left), Tab bar, Toolbar
- SF Symbols–style chevrons and arrows (left, right, up, down)
- Buttons: bordered, filled, gray; subtle scale on press
- Motion: spring animations, ~0.3s, subtle opacity/scale

Radix UI:
- IconButton, Chevron (direction: left/right/up/down), Collapsible, Dropdown
- data-radix-* attributes; unstyled primitives, direction props on icons
- Motion: often delegated to CSS or Framer Motion; respect direction prop

Chakra UI:
- Button (variant: solid/outline/ghost), IconButton, direction props
- chakra-* class prefix; theme-aware colors
- Motion: transition prop, duration, easing (ease-in-out, etc.)

Ant Design:
- Button, Icon (arrow left/right/up/down), Breadcrumb, Back button pattern
- ant-* class prefix; Icon component with type/direction
- Motion: ~200ms ease, subtle hover scale/color

General motion patterns (use in descriptions and #11):
- Hover: background fill, scale 1.02–1.05, opacity, border/shadow change; ~120–200ms ease-out
- Press/active: scale 0.95–0.98, ~80–100ms ease-out
- Ripple: center expand, fade out ~400–600ms
- Back button / chevron: always state direction explicitly (left-pointing chevron, arrow left)
- Loop: if animation repeats, say "loop" or "repeat seamlessly" in the code prompt

Rule: Name the component type (e.g. IconButton, back button, FAB) and always give arrow/chevron direction (left, right, up, down) as visible in the first frame. Use these terms in section #2 and in #11.
`;
