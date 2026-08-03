<!-- ported for oh-my-pi -->
---
name: ui-ux-design-language
description: Enforces the ExpenseHub design system defined in docs/design-language.md — colour tokens, typography, spacing, component conventions, accessibility, and motion rules for all frontend work.
---

# UI/UX Design Language Skill

Use this skill whenever writing or reviewing frontend UI code (Svelte components, Tailwind classes, layout). It enforces the authoritative design contract in `docs/design-language.md`. If a rule here and the doc ever diverge, the doc wins — re-read it.

## 1. Colour Tokens

Never hardcode hex values. Always reference the CSS custom properties (dark theme is default):

- `--background` — page background (zinc-950 `#09090b`)
- `--surface` — cards, panels, sidebars (zinc-900 `#18181b`)
- `--surface-raised` — elevated surfaces, dropdowns, row hover (zinc-800 `#27272a`)
- `--border` — borders, dividers (zinc-700 `#3f3f46`)
- `--border-subtle` — subtle internal borders (zinc-800 `#27272a`)
- `--text-primary` — headings, primary content (zinc-50 `#fafafa`)
- `--text-secondary` — descriptions, labels (zinc-400 `#a1a1aa`)
- `--text-muted` — placeholders, disabled states (zinc-500 `#71717a`)
- `--accent-primary` — primary actions, links, active states (`#4f8cff`)
- `--accent-primary-hover` — hover state on primary accent (`#3b7ff5`)
- `--accent-secondary` — secondary accent, tags, highlights (violet-500 `#8b5cf6`)
- `--destructive` — delete, error, danger (red-500 `#ef4444`)
- `--success` — matched, approved, confirmed (green-500 `#22c55e`)
- `--warning` — on hold, pending, suggested match (amber-500 `#f59e0b`)
- `--info` — informational, awaiting (sky-400 `#38bdf8`)

Light theme overrides the same token names under `html.light` — never introduce new token names for light mode. Colour is used sparingly: accents appear only on interactive elements and status indicators, never as decoration.

## 2. Typography

Font stack: `Inter` (primary, via `@fontsource/inter`, no CDN), falling back to `system-ui`, `-apple-system`, `sans-serif`. Monospace: `JetBrains Mono` (via `@fontsource/jetbrains-mono`) for IBANs, document numbers, amounts, code.

| Scale | Size | Weight | Usage |
|---|---|---|---|
| `display` | 2rem (32px) | 600 | Page titles (rare) |
| `heading-1` | 1.5rem (24px) | 600 | Section headings |
| `heading-2` | 1.25rem (20px) | 600 | Card headings, sub-sections |
| `heading-3` | 1rem (16px) | 500 | Table headers, group labels |
| `body` | 0.875rem (14px) | 400 | Primary body text |
| `small` | 0.75rem (12px) | 400 | Meta text, timestamps, captions |
| `label` | 0.75rem (12px) | 500 | Form labels, tags, badges |
| `mono` | 0.8125rem (13px) | 400 | IBANs, document numbers, amounts, code |

Line heights: 1.5 for body text, 1.25 for headings. Tight tracking (`-0.01em`) on headings. Font weight and size carry hierarchy — never colour.

## 3. Spacing & Radius

4px base unit. All spacing values are multiples of 4px.

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Micro gaps (icon-to-text) |
| `space-2` | 8px | Tight component padding |
| `space-3` | 12px | Default internal padding |
| `space-4` | 16px | Standard component padding |
| `space-6` | 24px | Section padding, card padding |
| `space-8` | 32px | Page section gaps |
| `space-12` | 48px | Major layout breaks |

Border radius:
- `radius-sm`: 4px — tags, badges, small chips
- `radius-md`: 6px — buttons, inputs, cards
- `radius-lg`: 8px — modal dialogs, popovers, larger containers
- `radius-full`: 9999px — pill badges, avatars

## 4. Buttons

Four variants (shadcn conventions):

| Variant | Usage |
|---|---|
| `default` (filled) | Primary CTA — Upload, Approve, Run Reconciliation |
| `outline` | Secondary actions — Export, Reprocess, Cancel |
| `ghost` | Inline actions — Edit, Dismiss, icon-only buttons |
| `destructive` | Irreversible actions — Delete (always behind confirmation dialog) |

Height: `h-9` (36px) standard, `h-8` (32px) compact (data tables).

## 5. Data Tables

- Sticky header with `--surface` background
- Row hover: `--surface-raised`
- Selected row: subtle left border in `--accent-primary`, very faint background tint
- Status columns: always right-aligned
- Amount columns: always right-aligned, monospace font
- Action columns (Edit/View): ghost icon buttons, visible on row hover only
- Empty state: centred illustration placeholder + descriptive message + primary CTA

## 6. Status Badges

Small pill badges (`radius-full` or `radius-sm`) with a coloured dot:

| Status | Colour | Dot |
|---|---|---|
| Matched | `--success` | ● green |
| Approved | `--success` | ● green |
| Unmatched | `--warning` | ● amber |
| Pending Review | `--warning` | ● amber |
| Dispositioned | `--info` | ● sky |
| Rejected | `--destructive` | ● red |
| Draft | `--text-muted` | ● zinc |
| On Hold | `--text-secondary` | ● zinc |

## 7. Forms

- Label above input, always
- Labels: `label` scale, `--text-secondary`
- Error messages: `small` scale, `--destructive`, below the field
- Helper text: `small` scale, `--text-muted`, below the field
- Input height: `h-9` (36px)
- Focus ring: 2px `--accent-primary` with 2px offset
- Form inputs always associated with labels via `for`/`id` or `aria-label`

## 8. Navigation

**Sidebar (left, fixed):**
- Width: 240px collapsed content, 64px icon-only mode (icon-only below 1024px viewport)
- Background: `--surface`
- Active item: left border accent + `--accent-primary` text + faint background tint
- Group separators with `small`-scale labels in `--text-muted`

**Top bar:**
- Background: `--surface`, bottom border `--border-subtle`
- Left: Logo + tenant name / switcher
- Right: Theme toggle, user avatar + dropdown

**Cards:**
- Background: `--surface`, border 1px `--border`, radius `radius-md`, padding `space-6`
- No drop shadow in dark mode; very subtle shadow in light mode (`shadow-sm`)

## 9. Icons

- Library: **Lucide Svelte** (`lucide-svelte`)
- Stroke width: `1.75px` — consistent across all icons
- Size defaults: `16px` inline text icons / table action buttons, `20px` navigation icons / form field prefix icons, `24px` standalone feature icons / empty state illustrations
- Never use filled icon variants unless the design explicitly calls for a state change (e.g. bookmark filled = saved)

## 10. Accessibility

- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text and UI components (WCAG 2.1 AA)
- All interactive elements keyboard navigable with a visible focus indicator
- All icons that carry meaning have `aria-label`; decorative icons have `aria-hidden="true"`
- `data-testid` required on all interactive elements (E2E testing)
- Form inputs always associated with labels via `for`/`id` or `aria-label`

## 11. Motion

Minimal. Purposeful. Fast.

- Page transitions: none (instant)
- Sidebar collapse: `150ms ease` width transition
- Dropdowns and popovers: `100ms ease-out` opacity + slight translateY
- Toast notifications: `200ms ease-out` slide-in from bottom-right
- Loading skeletons: `1.5s` pulse animation in `--surface-raised`
- No bouncing, no spring physics, no decorative animations

## MUST NOT

- No hardcoded hex colours — always use the CSS custom properties
- No rounded-everything — follow the specific `radius-sm`/`md`/`lg`/`full` per component
- No gradients on backgrounds
- No decorative animations (motion is minimal, purposeful, fast only)
- No filled icons unless representing an explicit state change

## Checklist

- [ ] All colours reference `--token` custom properties, never hex literals?
- [ ] Typography uses one of the 7 defined scales?
- [ ] Spacing values are multiples of 4px using named tokens?
- [ ] Correct border-radius per component type?
- [ ] Button variant and height match the convention table?
- [ ] Data table follows sticky header / hover / selected-row / alignment rules?
- [ ] Status badge colour+dot matches the status table?
- [ ] Form follows label-above, error/helper text, focus ring rules?
- [ ] Sidebar/top bar/card structure matches navigation spec?
- [ ] Lucide icons at 1.75px stroke, correct size default?
- [ ] Contrast, keyboard nav, aria-label/aria-hidden, `data-testid` all present?
- [ ] Motion (if any) is minimal/purposeful/fast, no bounce/spring?
