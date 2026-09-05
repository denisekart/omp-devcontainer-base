---
name: svelte5
description: Svelte 5 Runes, snippets, shadcn/ui, design language, and modern frontend best practices for the project.
---
# Svelte 5

Formerly: svelte-code-writer, svelte-core-bestpractices, frontend-expert, ui-ux-design-language

## When to use

- Writing or modifying .svelte files or .svelte.ts modules (svelte-code-writer)
- Writing fast, robust Svelte 5 code (svelte-core-bestpractices)
- All frontend development tasks (frontend-expert)
- Writing or reviewing frontend UI code, Tailwind classes, layout (ui-ux-design-language)

## Rules

1. **Svelte 5 Runes only**: `$state`, `$derived`, `$props`, `$effect`. Never Options API.
2. **Prefer `$derived` over `$effect`** for computed values.
3. **Snippets**: Use `{#snippet}` for template composition. Replace deprecated `asChild`/`let:builder` with the `child` snippet.
4. **TypeScript**: All component scripts use TypeScript.
5. **Client-side only**: `ssr = false`, `prerender = true`.
6. **Keep components small and composable**.
7. **No hardcoded hex colours**: Use CSS custom properties (`--background`, `--surface`, `--accent-primary`, etc.).
8. **Typography**: Inter font stack (`@fontsource/inter`), JetBrains Mono for monospace. Use defined scale (display → mono).
9. **Spacing**: 4px base unit, multiples of 4. Use named tokens (`space-1`…`space-12`).
10. **Border radius**: `radius-sm`(4px), `radius-md`(6px), `radius-lg`(8px), `radius-full`(9999px) per component.
11. **Icons**: Lucide Svelte, 1.75px stroke. Sizes: 16px inline, 20px nav/form, 24px standalone.
12. **Accessibility**: WCAG 2.1 AA (4.5:1 body, 3:1 large). Keyboard nav, visible focus, `aria-label`/`aria-hidden`, `data-testid` on all interactive elements.
13. **Motion**: Minimal, purposeful, fast. No bounce/spring.
14. **shadcn/ui**: Add via `pnpm dlx shadcn@latest add <component>`.

### Design Tokens (dark theme default)

- `--background` zinc-950, `--surface` zinc-900, `--surface-raised` zinc-800, `--border` zinc-700, `--text-primary` zinc-50, `--text-secondary` zinc-400, `--text-muted` zinc-500, `--accent-primary` #4f8cff, `--destructive` red-500, `--success` green-500, `--warning` amber-500, `--info` sky-400.

### Navigation & UX

- Breadcrumbs on every page with hierarchical context. Deep linking over popups. `AlertDialog` for destructive actions. Loading states (`{#await}`), error handling, success notifications.

### Backend Communication

- Domain-specific services in `$lib/services/`. Centralized `api` client. Zod validation for all form inputs and API responses.

## Pattern

```svelte
<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>

<div class="card p-6" data-testid="counter-card">
  <h2 class="heading-2">Counter</h2>
  <p class="body">{doubled}</p>
  <button class="btn-default" onclick={() => count++}>Increment</button>
</div>
```

## Checklist

- [ ] Svelte 5 Runes used?
- [ ] Snippets instead of `asChild`/`let:builder`?
- [ ] Breadcrumbs included?
- [ ] `data-testid` on interactive elements?
- [ ] API calls in typed service?
- [ ] Zod validation implemented?
- [ ] Lucide icons at 1.75px stroke?
- [ ] Mobile responsive?
- [ ] Design tokens (colour, typography, spacing) correct?
- [ ] Accessibility (contrast, keyboard, aria) present?
