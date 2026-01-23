# Palette's Journal

This journal tracks critical UX and accessibility learnings.

## 2024-05-22 - [Accessiblity: Toggle Buttons]
**Learning:** Toggle buttons (theme switchers) often lack semantic roles, confusing screen reader users who don't know the current state.
**Action:** Always use `role="switch"` and `aria-checked` for binary toggle states instead of generic buttons.
