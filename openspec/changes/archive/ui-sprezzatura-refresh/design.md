# Design: Quiet Precision Token System

## Token palette (proposal — to be tuned with the product owner)

```
--canvas:            #F7F6F4   (warm paper)
--surface:           #FFFFFF
--surface-elevated:  #F1F0ED
--primary (text):    #1C1C1E
--secondary (text):  #55555A
--accent:            #E84E0F   (GhostTyper orange, one step calmer than
                                the current #FF5917 — DECIDED 2026-07-16:
                                brand stays black + orange; the refresh
                                quiets HOW both are used)
--accent-contrast:   #FFFFFF
--success/warning/danger: desaturated, same lightness family
--border-subtle:     rgba(28,28,30,0.08)
--focus-ring:        accent @ 40%
dark theme: NOT deep glossy black (product-owner note) — soft warm
            anthracite instead: canvas #1E1E21, surfaces #26262A /
            #2D2D32, hairlines rgba(255,255,255,0.08); no glow/gloss
            effects; accent orange unchanged (AA holds on anthracite)
```

Gradient tokens are deleted; `gradient-accent` usages become solid
accent buttons.

## Component rules

- Button: 3 variants (primary solid accent / secondary hairline /
  ghost); one radius; no transform on hover, background shift only.
- Card: surface + hairline; shadow removed except overlay layers.
- Field: label 12px medium, input 14px, help text below — never inside
  placeholders; error state uses text + border, no red fills.
- Tables (costs, glossary): tabular numerals, right-aligned numbers,
  zebra-free (hairline row dividers).
- Status: dot + word, no filled pill badges except danger.

## Sprezzatura checklist per screen

1. What does a first-time user need to see? Everything else folds.
2. Every visible control has a sensible default already applied.
3. One primary action per view; it is obvious and singular.
4. Jargon → plain language (model names get characterizations,
   technical toggles get consequences: "Speichert Audio 30 Tage").

## Rollout

- Phase 1: tokens + Button/Card/Field extraction + nav.
- Phase 2: screen passes (upload → translate → transcription detail →
  settings → rest).
- Phase 3: dark theme parity + a11y audit + screenshot diff gallery.
- Port to Romaco as one change after phase 3. Accent decision (final,
  2026-07-16): GhostTyper keeps its black + orange brand — orange gets
  quieter (solid, primary action + focus only, gradient deleted,
  slightly desaturated candidate #E84E0F to be A/B'd against #FF5917),
  and the dark theme softens from deep glossy black to warm anthracite.
  Romaco keeps its corporate blue (#1E5BC1 / #4A82DC, already in its
  globals.css) — only the usage rules port, never the hue.
