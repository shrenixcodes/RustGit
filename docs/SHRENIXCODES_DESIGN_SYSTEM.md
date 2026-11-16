# RustGit · ShrenixCodes design system

Supersedes the "Orbital Instrumentation" tokens. Philosophy: Kanso (remove),
Shizen (behave naturally), Yūgen (depth revealed gradually), Ma (meaningful
space), Wabi-sabi (restraint, material). These are rules for decisions, not
decoration: no Japanese motifs, characters or textures appear in the UI.

## 1. How each principle becomes a rule

| Principle | Rule in RustGit |
| --------- | --------------- |
| Kanso     | No boxes around lists; no page headers repeating what the rail already says; one primary action per area; labels of one or two words. |
| Shizen    | Layout follows Git's own model (working tree → index → commit, ancestry top to bottom); an action happens where its object is; transitions only confirm a change of state (≤ 140 ms). |
| Yūgen     | Metadata appears on selection or hover (full SHA, emails, upstream details), never all at once; depth comes from three surface tones, not shadows. |
| Ma        | Space separates groups instead of borders; quiet workspace rows are 30 px; the diff canvas gets the widest column; asymmetry: navigators are narrow, canvases wide. |
| Wabi-sabi | Muted natural palette and restraint. No textures, grain, wallpaper or illustrations anywhere: depth comes from tone and space. |

## 2. Color

Dark is the default theme. Values are lightness-adjusted from the brief only
where contrast required it; `src/styles/tokens.test.ts` enforces text ≥ 4.5:1
and graphics/controls ≥ 3:1 on every surface of every theme and workspace.

### Dark (quiet workspace)

| Token            | Value     | Use |
| ---------------- | --------- | --- |
| bg               | `#151715` | window |
| canvas           | `#1B1E1A` | diff and graph canvases |
| surface          | `#20231F` | navigators, ridge |
| elevated         | `#292D27` | popovers, focused rows |
| border           | `#383C34` | hairlines (decorative, not the only cue) |
| border-control   | `#79806F` | input and splitter edges (brief had none; ≥ 3:1) |
| text             | `#E5E2D8` | |
| text-secondary   | `#B3B5A8` | |
| text-muted       | `#969B8D` | brief `#858A7C` was 3.95:1 |
| sage             | `#A4AA91` | primary accent: current branch, selection mark, primary button |
| moss             | `#727C65` | graphics only (3.19:1): graph lane, dividers of emphasis |
| clay             | `#B66C50` | graphics only (3.50:1): HEAD ring, tag lane |
| clay-text        | `#CF8A6F` | clay as text (tags, incoming) |
| indigo           | `#8581A5` | graphics only (3.79:1): remote lanes |
| indigo-text      | `#9894B8` | indigo as text (remote branches) |
| success          | `#76A786` | |
| warning          | `#D3AD72` | |
| danger           | `#D18A85` | brief `#C77B76` was 4.35:1 |

### Deep workspace (dark)

Same hues, darker surfaces for history and debugging: bg `#0F110F`, canvas
`#141613`, surface `#191B18`, elevated `#22251F`, border `#2E322B`.

### Light

Warm off-white and bone, charcoal text, sage and clay used sparingly:
bg `#F3F0E8`, canvas `#ECE8DE`, surface `#FAF8F3`, elevated `#FFFFFF`,
border `#D9D4C7`, border-control `#7A7D71`, text `#24261F`, secondary
`#4F5347`, muted `#63675B`, sage `#5A6248`, moss `#4E5843`, clay `#9A4E32`,
indigo `#565184`, success `#3A6B4A`, warning `#7F5A1C`, danger `#9E423B`.

### Role rules

- Sage marks *where you are*: current branch, selection, primary action.
- Clay marks *the present moment*: HEAD and tags (points in time).
- Indigo marks *elsewhere*: remote branches.
- Moss is *structure*: secondary lanes and emphasis lines.
- Status colors only for status. No color without a text, shape or icon twin.

## 3. Typography

- Inter for interface text; JetBrains Mono for paths, hashes, branch names,
  diffs, counts and Git output. Both self-hosted (OFL).
- Sizes: 11 / 12 / 13 (base) / 15 / 18. Weight 400 and 500 only; 600 for the
  repository name.
- **Signature label** (`.sc-label`): JetBrains Mono, 11 px, lowercase,
  muted, preceded by a 10 px hairline: `— staged`. Replaces uppercase,
  letter-spaced labels, which every dashboard uses.
- Numbers are tabular. Hashes show 7 characters; the full id is revealed in
  the inspector.

## 4. Space and density

4 px grid. Two workspace personalities change spacing, not structure:

| Personality | Row  | Control | Ridge | Surfaces | Intended for |
| ----------- | ---- | ------- | ----- | -------- | ------------ |
| Quiet       | 30 px| 30 px   | 52 px | dark/light standard | daily changes and commits |
| Deep        | 24 px| 26 px   | 44 px | deep (darker) in dark theme | history, debugging, large repositories |

## 5. Geometry

- Hairlines (1 px) only where space alone cannot separate.
- Corner radius: 2 px controls, 4 px popovers; no rounded cards.
- No shadows except popovers (one soft shadow) and none in light theme rows.
- Icons: Lucide at 14–16 px, stroke 1.5, muted until hovered or active.

## 6. Signature

- **The mark:** a single path that forks and rejoins, with an open node at
  its head (`src/components/Mark.tsx`). Shown once, at the top of the rail,
  and in empty states. Never as a watermark.
- **The open node:** HEAD is drawn as a ring with a small gap (an
  unfinished circle) around a filled point. It is the only open shape in the
  graph, so the present moment is recognisable at any zoom.
- **Graph nodes:** commits are small solid points; merges are two touching
  points (one per parent side); root commits a short bar. Lines are 1.25 px.
- **Branch-path motif:** the current branch is written as a short path
  `● main ─ 2↑ 1↓` in the ridge, the same path language as the graph.

## 7. Motion

Only state changes animate: selection colour (100 ms), panel open/close
(140 ms), graph emphasis (120 ms). Nothing loops. Reduced motion (OS or in-app)
removes all transitions.
