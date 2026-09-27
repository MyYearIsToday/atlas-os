# SPEC-001 — Brand & Design System

> **Status:** Locked — Active
> **Owner:** CEO (Kofi Asare)
> **Last Updated:** 2026-09-15
> **Related Documents:** [../../ATLAS.md](../../ATLAS.md#design-language) · [../../src/index.css](../../src/index.css) · [../../components.json](../../components.json)

This spec is the implementation-level detail behind [ATLAS.md § Design Language](../../ATLAS.md#design-language). The Constitution states the rule; this document shows where it lives in code and how to apply it consistently. **Locked** means this spec does not change without CEO approval, same as the Constitution section it expands on.

## Colors

| Role | Hex | Usage in code |
|---|---|---|
| Primary | `#0B1F3A` | Sidebar, panel backgrounds, `bg-[#0b1f3a]` |
| Accent | `#D4AF37` | Primary buttons, active nav state, highlights — `bg-[#d4af37]` |
| Secondary | `#16A085` | Success/positive states, "Won" pipeline stage — `text-[#42c7a8]` family |
| Background | Dark | App shell background `#07111f`, card surfaces `#0d1a2b` / `#101f31` |

Colors are currently applied as literal Tailwind arbitrary values (e.g. `bg-[#d4af37]`) throughout `src/components/` and `src/pages/`, rather than as CSS custom properties. This is consistent with the existing codebase and should not be refactored into design tokens without a CEO-approved decision, since it touches every screen.

## Typography

| Use | Font | Where |
|---|---|---|
| Headings | Sora | `font-display` utility class |
| Body | Inter | Default body text |
| Data | JetBrains Mono | `font-mono` utility class — used for labels, stats, timestamps, status badges |

## Style principles

- **Premium** — generous spacing, subtle shadows (`card-glow`), no cluttered density.
- **Futuristic** — dark backgrounds, glassmorphism (`backdrop-blur`) on overlays and the sticky header.
- **Clean** — one accent color used sparingly, not decoratively.
- **Glassmorphism where appropriate** — modals, drawers, and the sticky header use `backdrop-blur`; card surfaces do not.
- **Mobile-first** — every layout starts at a single-column mobile state and adds columns at `sm:` / `md:` / `xl:` breakpoints. See `src/components/atlas-shell.tsx` for the reference implementation (collapsible sidebar, hamburger nav on mobile).

## Reference implementation

- `src/index.css` — global tokens and base styles.
- `src/components/atlas-shell.tsx` — the shell every page renders inside; the definitive example of the responsive and visual rules above.
- `src/components/crm/` — Sprint 2's application of this spec to CRM screens.

## Change control

Any change to color values, font choices, or the mobile-first requirement is a Constitution-level change and requires the same CEO approval as editing [ATLAS.md](../../ATLAS.md) directly. Log proposed changes in [DECISION_LOG.md](../../DECISION_LOG.md).
