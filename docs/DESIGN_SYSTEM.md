# Lectern Design System

Lectern adheres to a strict **Functional Minimalism ("Anti-Slop")** design philosophy. The interface is the product; it must feel like a premium, quiet, and focused space—not a cluttered developer tool.

## Core Principles

1. **User Only Sees What They Need**
   Hide technical noise (like terminal logs, byte counts, and raw data) behind sensible defaults or collapsible menus.

2. **Borderless by Default**
   Avoid nested boxes, rigid structural lines, and heavy outlines. Rely on negative space, subtle background fills (e.g., `bg-surface/50`), and deep insets for layout structure. If a container can exist without a border, remove the border.

3. **Typographic Hierarchy over Badges**
   Avoid heavily colored pills, badges, or backgrounds for metadata (e.g., flashcard tags). Use bold typography, distinct text colors, and subtle separators (like bullets `•`) to establish hierarchy.

4. **Quiet UI**
   De-emphasize secondary metrics (like generation cost) to elevate primary actions. The interface should feel like a "quiet room" where the user's content is the only loud element.

## Design Tokens

- **Fonts:** Manrope (sans) for UI headers and body, JetBrains Mono (mono) for code/logs and specific data points.
- **Palette:** Zinc (deep, moody surfaces) + Lime (vibrant, distinct accents). Dark mode is the default and only mode.
- **CSS Custom Properties:** Mapped to Tailwind variables in `gui/frontend/src/index.css` (`--background`, `--surface`, `--primary`, `--text-main`, `--text-muted`).

## Component Guidelines

- **Inputs & Controls:** Deep, borderless inputs that rely on `focus:ring-1 focus:ring-primary/50` for active states.
- **Motion:** Use Framer Motion for staggered entries, smooth collapses (`AnimatePresence`), and micro-interactions. Elements should enter with intention and never "snap" aggressively.
- **Banned Elements:**
  - Bootstrap blue (`#007bff`)
  - Default Tailwind color palettes (use the customized Zinc/Lime theme)
  - Flat/dead components without hover or active states. Every interactive element must provide feedback.
