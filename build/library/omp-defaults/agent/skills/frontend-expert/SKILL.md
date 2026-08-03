<!-- ported for oh-my-pi -->
---
name: frontend-expert
description: Comprehensive guidelines for Svelte 5, Design System, and modern UI/UX best practices.
---

# Frontend Expert Skill

Use this skill for all frontend development tasks. It integrates Svelte 5 best practices, premium design language, and robust API communication patterns.

## 🏗️ Architecture & Svelte 5 (Runes & Snippets)
- **Svelte 5 Runes**: Use `$state`, `$derived`, `$props`, and `$effect` exclusively.
- **Snippets**: Use `{#snippet}` for template composition.
- **shadcn/ui**: Replace deprecated `asChild` and `let:builder` patterns with the `child` snippet.
- **Client-Side Only**: Ensure `ssr = false` and `prerender = true`.

## 🎨 Design & UI
- **Visual Identity**: Follow the project's established branding, colors, and typography.
- **Icons**: Use **Lucide Svelte** with `1.75px` stroke width.
- **shadcn/ui**: Add components via `pnpm dlx shadcn@latest add <component>`.
- **Gradients**: Use `EmphasizedCard.svelte` for primary highlights.

## 🗺️ Navigation & UX
- **Breadcrumbs First**: Use `Breadcrumbs.svelte` on EVERY page where hierarchical context makes sense.
- **Deep Linking**: Prefer new pages over popups for complex tasks.
- **Confirmations**: Use `AlertDialog` for significant/destructive actions.
- **Feedback Loops**: Design for loading states (`{#await}`), error handling, and success notifications.

## 🔌 Backend Communication & API
- **Typed Services**: Create domain-specific service files in `$lib/services/`.
- **Centralized Client**: Use the base `api` client from `$lib/services/api.ts`.
- **Zod Validation**: Mandatory for all form inputs and API response parsing.

## 🧪 Testing & Quality
- **Data Tags**: Mandatory `data-testid` attributes on all interactive elements.
- **Accessibility (a11y)**: WCAG 2.1 compliance. Use semantic HTML.
- **Reuse & Extension**: Check `$lib/components` for existing logic before creating new ones.

## Checklist
- [ ] Using Svelte 5 Runes?
- [ ] Snippets used instead of `asChild`/`let:builder`?
- [ ] Breadcrumbs included?
- [ ] Data-testid tags added?
- [ ] API calls in a typed service?
- [ ] Zod validation implemented?
- [ ] Lucide icons have 1.75px stroke width?
- [ ] Mobile responsiveness verified?
- [ ] Using pnpm for package management?
