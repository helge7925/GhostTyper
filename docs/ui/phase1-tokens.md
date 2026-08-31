# Phase 1 — Quiet Precision tokens

`openspec/changes/ui-sprezzatura-refresh` phase 1: design tokens, shared
primitives (Button/Card/Field), and the nav shell. No screen-by-screen
redesign — that's phase 2, with the product owner. This doc is the
reviewable artifact standing in for a screenshot gallery (headless CI
can't render one).

## Token table — old → new

### Light theme (`:root`)

| Token | Old | New | Notes |
|---|---|---|---|
| `--canvas` | `#FAFAFA` (250 250 250) | `#F7F6F4` (247 246 244) | warm paper, not cool grey |
| `--surface` | `#FFFFFF` | `#FFFFFF` | unchanged |
| `--surface-elevated` | `#F5F5F5` (245 245 245) | `#F1F0ED` (241 240 237) | warm-neutral |
| `--primary` (text) | `#181820` (24 24 32) | `#1C1C1E` (28 28 30) | warm-neutral near-black |
| `--secondary` (text) | `#52525B` (82 82 91) | `#55555A` (85 85 90) | warm-neutral grey |
| `--muted` | `#A1A1AA` (161 161 170, cool) | `#918F8B` (145 143 139, warm) | |
| `--accent` | `#FF5917` (255 89 23) | **`#E84E0F`** (232 78 15) | the decided A/B candidate — see below |
| `--accent-strong` | `#FF8C00` (255 140 0, *lighter*) | `#C94509` (201 69 9, *darker*) | now a darken-on-hover/AA-safe-fill step, not a brighten step — see "AA note" below |
| `--focus-ring` | `#FF8C00` (255 140 0) | `#C94509` (201 69 9) | opaque outline, sourced from `--accent-strong` — see note |
| `--border-subtle` | `rgba(0,0,0,0.08)` | `rgba(28,28,30,0.08)` | warm-tinted, same alpha |
| `--border-emphasis` | `rgba(0,0,0,0.16)` | `rgba(28,28,30,0.16)` | warm-tinted, same alpha |
| `--hover-subtle` / `--hover` / `--hover-strong` | `rgba(0,0,0, .04/.06/.10)` | `rgba(28,28,30, .04/.06/.10)` | warm-tinted, same alphas |
| `--success` / `--warning` / `--danger` / `--info` | unchanged | unchanged | **out of scope for phase 1** — design.md only says "desaturated, same lightness family" with no concrete hex; not touched to avoid unreviewed semantic-color drift |
| `--gradient-accent` / `--gradient-accent-hover` | gradient tokens | **deleted** | see "Gradients" below |

### Dark theme (`[data-theme='dark']`)

| Token | Old (deep glossy black) | New (warm anthracite) |
|---|---|---|
| `--canvas` | `#0A0A0F` (10 10 15) | `#1E1E21` (30 30 33) |
| `--surface` | `#16161F` (22 22 31) | `#26262A` (38 38 42) |
| `--surface-elevated` | `#1E1E2E` (30 30 46) | `#2D2D32` (45 45 50) |
| `--primary` (text) | `#E8E8ED` (232 232 237, cool) | `#E8E7E4` (232 231 228, warm) |
| `--secondary` (text) | `#8B8B9E` (139 139 158, cool blue-grey) | `#9E9C98` (158 156 152, warm grey) |
| `--muted` | `#71717A` (113 113 122, cool) | `#7A7875` (122 120 117, warm) |
| `--accent` / `--accent-strong` | `#FF5917` / `#FF8C00` | `#E84E0F` / `#C94509` — **same values as light theme**, not a separate dark override (matches design.md: "accent orange unchanged" across themes) |
| `--border-subtle` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.08)` | design.md specifies 0.08 explicitly for dark hairlines |
| `--border-emphasis` | `rgba(255,255,255,0.12)` | `rgba(255,255,255,0.14)` | proportional bump to keep the emphasis/subtle ratio |
| `--success` / `--warning` / `--danger` / `--info` | unchanged | unchanged | same "out of scope" note as light theme |

## The #E84E0F vs #FF5917 A/B note

design.md decided (2026-07-16) `#E84E0F` as the calmer candidate to
replace `#FF5917`. This is implemented as the literal `--accent` value
in both themes. One nuance for the product owner evaluating the A/B:
large **solid-fill CTAs with white text** (Button `primary`/`default`,
the `gradient-accent` utility's hover state) use `--accent-strong`
(`#C94509`), not raw `--accent`, because white-on-`#E84E0F` fails the
4.5:1 AA floor for normal text (see AA results below — this was *also*
true of the old `#FF5917`, just slightly worse: 3.14:1 vs 3.80:1).
`--accent` itself (the value being A/B'd) stays fully visible via
icons, links, focus rings, badges, and the `bg-accent/NN` washes — just
not as literal button fill color. This is a standard design-system
pattern (a "500" swatch for chrome, a "600" step for AA-safe fills),
not a deviation from the decided hue.

## Gradients — deleted as a design element

Per design.md, `--gradient-accent` / `--gradient-accent-hover` CSS
custom properties are deleted. The `.gradient-accent` /
`.gradient-accent-hover` **utility class names are kept** (so no
call-site edits were needed anywhere in the app) but now resolve to
solid fills:

```css
.gradient-accent       { background: rgb(var(--accent)); }        /* was a 135deg gradient */
.gradient-accent-hover { background: rgb(var(--accent-strong)); } /* was a lighter gradient; now a darkening companion */
```

The `.upload-progress` / `.mic-level-meter` progress-bar fills, which
referenced `var(--gradient-accent)` directly, were updated to
`rgb(var(--accent))` for the same reason (the CSS variable no longer
exists).

## Decorative glow removed

- `components/TopBar.js`: the profile-avatar-initials badge had
  `shadow-lg shadow-accent/20` (a colored glow) — removed.
- `components/ui/button.js`: the old `default` variant had
  `shadow-lg shadow-accent/20` and `active:scale-[0.98]` — both
  removed. Design.md: "no transform on hover, background shift only"
  and shadows reserved for genuinely floating layers (menus, dialogs).

## Primitives

- **`components/ui/button.js`** (existing file, extended in place —
  see the file-naming note below): added a `primary` variant (solid
  `--accent-strong` fill, `hover:brightness-90`, no scale-transform,
  no glow). `default` is now an alias of `primary` so the 3 existing
  consumers (`pages/settings/organization/preferences.js`,
  `pages/settings/organization/integrations.js`,
  `pages/invite/accept.js`) get the AA-safe fill and lose the
  scale-pop/glow automatically. `outline` is the pre-existing hairline
  style and now doubles as the "secondary hairline" variant design.md
  asks for. `secondary` (filled `bg-surface-elevated`) is left
  untouched — 3 pages depend on its current look and are out of
  phase-1 scope. `ghost`, `destructive`, `destructive-solid`, `link`
  unchanged.
- **`components/ui/card.js`** (new): `Card` / `CardHeader` /
  `CardBody` / `CardFooter` — surface + hairline border, no shadow.
- **`components/ui/field.js`** (new): `Field` (label 12px medium +
  help/error text below) + `FieldInput` (14px input, accent focus
  ring, danger border on error — no red fill).

### File-naming deviation: no `Button.js`/`Card.js`/`Field.js`

design.md's task list names the primitives `Button.js`, `Card.js`,
`Field.js`. This repo's working tree is on APFS (case-insensitive by
default — verified: `components/ui/BUTTON.js` resolves to the
existing `components/ui/button.js`). Creating `components/ui/Button.js`
next to the existing `components/ui/button.js` would collide on disk
and risked clobbering the widely-referenced existing component, so:

- `button.js` was extended in place (see above) instead of duplicated.
- `card.js` / `field.js` are new files, lowercase to match this
  directory's existing convention (`button.js`, `dialog.js`,
  `sheet.js`, `tooltip.js`, ...) and to avoid the same
  collision risk on any future addition. Exported symbols are
  PascalCase (`Card`, `Field`, ...), so call sites read exactly as
  design.md specifies (`<Card>`, `<Field>`).

## Nav/shell migration (the only screens touched)

- **`pages/login.js`** (single showcase): SSO + submit buttons →
  `<Button variant="primary" size="lg">`; email/password inputs →
  `<Field><FieldInput/></Field>`.
- **`components/TopBar.js`**: the 4 plain icon/text buttons (hamburger,
  sidebar-collapse toggle, desktop search trigger, mobile search icon)
  now render through `<Button variant="ghost|outline">`. The profile
  avatar's glow shadow was removed (see above); the `ProfileMenu`
  trigger itself stays a plain `<button>` since it wraps Radix's
  `DropdownMenuTrigger asChild` with bespoke avatar-image/initials
  content that doesn't map onto the 3 generic variants.
- **`components/Sidebar.js`** / **`components/BottomNav.js`**: *not*
  migrated onto the generic `Button` — `NavRow`/`FooterButton`/the
  bottom-tab links combine active-state background wash, tooltip
  wrapping (collapsed sidebar), `aria-current`, and `Link`-vs-`button`
  duality that the 3-variant primitive doesn't model. They inherit the
  new tokens automatically (that's the point of centralizing the
  tokens). Both got one direct fix: the active-state text color
  changed from `text-accent` to `text-primary` — see AA finding below.
  This is a token-driven fix, not a redesign of the components.

## AA finding fixed in this phase: active-nav text color

Auditing the *changed* accent value surfaced a pre-existing issue that
got slightly better but still failed: `NavRow` (`Sidebar.js`) and the
bottom-tab links (`BottomNav.js`) colored **both** the icon and the
14px/10px label text `text-accent` when active. Text at that size
needs 4.5:1; `--accent` on canvas/surface only clears the 3:1
"UI-component" floor (3.52–4.38:1, see table below) — this was already
true of the old `#FF5917` and is marginally better with `#E84E0F`, but
still a fail. Fixed by splitting the treatment: the icon keeps
`text-accent` (icons only need 3:1, and it's the more legible
"you are here" signal at a glance), the label switches to
`text-primary` (full contrast), and the `bg-accent/10` background wash
is unchanged. Both components already sit in phase-1's explicit scope,
so this was fixed rather than just flagged.

## Known gap — deferred to phase 2 (not fixed, flagged only)

`pages/index.js`'s hero CTA (`gradient-accent text-white ... text-base
font-medium`) and any other page still using `gradient-accent
text-white` as body-sized button text inherit the same white-on-accent
contrast shortfall noted above (3.80:1 vs the 4.5:1 floor for 16px/500
text). This is **not** a regression introduced by this phase — the old
gradient's *average* color was worse (effectively ~3.14:1) — but it
isn't fixed either, per the phase-1 rule against sweeping screens
outside nav/shell/login. Phase 2's screen passes should either route
these through the `Button` `primary` variant (which already resolves
this) or bump the type size/weight into the AA large-text exception.

## `--focus-ring`: opaque, not literal 40% alpha

design.md's shorthand is "`--focus-ring`: accent @ 40%". The existing
implementation (`outline: 2px solid rgb(var(--focus-ring))`) is a
solid 2px outline, not an alpha-composited one — a 40%-alpha outline
would be too faint to reliably read as a focus indicator against
arbitrary page content (the accessibility floor in proposal.md
requires "visible focus ring on the new accent"). Implemented as
`--focus-ring: 201 69 9` (i.e. `--accent-strong`, opaque), preserving
the pre-existing pattern where the ring used the punchier of the two
accent tones — before it was the *lighter* `#FF8C00`, now it's the
*darker* `#C94509`, which is the AA-safer choice and consistent with
the accent-strong role change described above.

## Consistency guard — hardcoded literals fixed

Grepped `pages/` and `components/` for hex/`rgb()` literals duplicating
the old accent tokens (`#FF5917`, `#FF8C00`, and their RGB triplets).
Three hits, all fixed:

| File | Before | After | Why not just a var reference |
|---|---|---|---|
| `pages/share/[token]/overlay.js` (bot-camera language badge) | `background: '#FF5917'` | `background: 'rgb(var(--accent))'` | same document as the rest of the app (`_app.js` loads `globals.css`) — a real token reference works |
| `components/DocumentEditor.js` (PDF-preview popup toolbar, `.action` button) | `border: rgba(255,89,23,.45)`, `background: rgba(255,89,23,.2)`, `color: #ff8b63` | `rgba(232,78,15,.45)`, `rgba(232,78,15,.2)`, `color: #ef8357` | this HTML is built via `document.write()` into a **separate window/document** that never loads `globals.css` — CSS custom properties don't cross documents, so this had to become an updated literal, not a var reference (documented inline in the source) |
| `components/DocumentEditor.js` (in-editor "Ink" focus-theme heading color) | `.prose h2 { color: #ff5917 }` | `.prose h2 { color: rgb(var(--accent)) }` | inside a `<style jsx global>` block, same document as the app — a real token reference works |

No other `pages/`/`components/` files matched.

## WCAG AA verification (computed)

Ran a small Node script (WCAG relative-luminance formula), checked in
at `docs/ui/contrast-check.mjs` — run with `node
docs/ui/contrast-check.mjs` to reproduce — against every changed pair.
Full output:

```
=== LIGHT THEME ===
PASS  primary text / canvas              15.75:1  (need 4.5:1)
PASS  primary text / surface             17.01:1  (need 4.5:1)
PASS  primary text / surface-elevated    14.93:1  (need 4.5:1)
PASS  secondary text / canvas             6.86:1  (need 4.5:1)
PASS  secondary text / surface            7.41:1  (need 4.5:1)
PASS  muted text / surface (3:1 floor)    3.23:1  (need 3:1)
PASS  accent / canvas (UI, 3:1)           3.52:1  (need 3:1)
PASS  accent / surface (UI, 3:1)          3.80:1  (need 3:1)
FAIL  white text / accent (button label)  3.80:1  (need 4.5:1)  → button fill uses accent-strong instead, see above
PASS  white text / accent-strong (hover)  4.84:1  (need 4.5:1)
PASS  accent-strong / surface (ring 3:1)  4.84:1  (need 3:1)
PASS  accent-strong / canvas (ring 3:1)   4.48:1  (need 3:1)

=== DARK THEME (warm anthracite) ===
PASS  primary text / canvas              13.45:1  (need 4.5:1)
PASS  primary text / surface             12.19:1  (need 4.5:1)
PASS  primary text / surface-elevated    11.08:1  (need 4.5:1)
PASS  secondary text / canvas             6.07:1  (need 4.5:1)
PASS  secondary text / surface            5.50:1  (need 4.5:1)
PASS  muted text / surface (3:1 floor)    3.42:1  (need 3:1)
PASS  accent / canvas (UI, 3:1)           4.38:1  (need 3:1)
PASS  accent / surface (UI, 3:1)          3.97:1  (need 3:1)
PASS  accent / surface-elevated (UI,3:1)  3.61:1  (need 3:1)
FAIL  white text / accent (button label)  3.80:1  (need 4.5:1)  → same mitigation as light theme
PASS  white text / accent-strong (hover)  4.84:1  (need 4.5:1)
PASS  accent-strong / surface (ring 3:1)  3.11:1  (need 3:1)
PASS  accent-strong / canvas (ring 3:1)   3.44:1  (need 3:1)

=== OLD (for reference) ===
PASS  old accent #FF5917 / old dark surface #16161F   5.73:1  (need 3:1)
FAIL  old accent #FF5917 white text (button label)    3.14:1  (need 4.5:1)
```

Every pair that's actually rendered as static text/UI passes its
threshold. The two `FAIL` rows are the raw-accent-as-button-fill case
discussed above, which is why `Button`'s solid variants use
`--accent-strong` rather than `--accent`.

## Verification run

- `npm test` — see PR/commit for the actual run; no test touches
  `pages/login.js`, `components/TopBar.js`, `components/Sidebar.js`,
  `components/BottomNav.js`, or `components/ui/*` directly (confirmed
  via `find`/`grep` before editing — only `tests/*.test.mjs` exist,
  none of them render these components).
- `npm run lint`
- `npm run build`

## Open points for phase 2 / product owner

1. `#E84E0F` vs `#FF5917` A/B — implemented as described above; the
   product owner should review live (both themes) before phase 2
   screen passes lock it in.
2. `--success`/`--warning`/`--danger`/`--info` are unchanged — design.md
   only gestures at "desaturated, same lightness family" without
   concrete values; needs a follow-up decision.
3. `pages/index.js`'s hero CTA and any other raw
   `gradient-accent text-white` body-text button carries the
   white-on-accent AA shortfall forward (flagged above, not fixed).
4. `ProcessStatusCard.js`'s `text-accent` ETA line and other
   `text-accent`-as-body-text usages outside nav/shell were not
   audited/fixed — same reasoning (out of the nav/shell/login scope
   for phase 1).
