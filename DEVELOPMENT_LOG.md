# Development Log

Key release notes and insights for AgentBoard.

---

## 2026-07-19 — Subtasks & the agentboard-sync companion skill

Adds one level of task nesting to the board and publishes the long-promised companion skill in-repo.

### Subtasks (parser, board & write-back)

- **Format** — an indented `- [ ]` line (spaces or tabs) attaches to the nearest preceding top-level task; one level deep. Previously indented lines were silently ignored by the parser, so existing files are forward-compatible. Original indentation is preserved on every write so lines round-trip byte-identical.
- **Completion cascade** — completing the last open subtask completes the parent; toggling a parent cascades its state to all subtasks; unchecking a subtask under a completed parent reopens the parent. Cascade logic lives in `toggleTask`, applied at write time on a fresh parse.
- **Parent-aware lookups** — all mutations re-find tasks in a fresh parse by text + completed state; subtasks are found *under their parent* (`findFreshTask`) so duplicate texts across parents don't collide.
- **UI** — subtasks render indented with a guide line under the parent (both open and Completed sections), parents get an `n/m` progress pill, an "Add subtask" item in the three-dot menu (inserts a 4-space-indented line after the parent's last subtask), and an icon-only collapse chevron pinned to the card's bottom-right. Collapse state is in-memory per view (keyed `theme::task text`) — survives re-renders, resets on restart, keeps the file format untouched.
- **Subtasks are full tasks** — checkbox, inline edit, U/I/E menus, due-date picker, critical toggle, and delete all work; deleting a parent removes its subtask block; "+ Add task" now skips past subtask lines so it can't insert into another task's block.

### agentboard-sync skill

- **Decision: ship the skill at top-level `skills/agentboard-sync/SKILL.md`**, not `.claude/skills/` — it is a distributable artifact for users' own vaults (where their todo file lives), not a dev-time skill for this repo, and the README advertises it. Users copy it into their own `.claude/skills/`.
- The skill syncs vault notes → board file (`Todo(Category):` lines), scores missing attributes, ranks sections by T, and understands nested files (file → parent task, todos → subtasks) plus parent attribute derivation from subtasks.
- Sanitized before commit: real vault path, personal folder structure, and therapy-related aliases replaced with generic examples (numeric-prefix folder kept so the prefix-stripping rule stays illustrated).

**Outcome:** build + type-check clean; parser smoke-tested against `todolist_example.md` (4 parents, correct subtask counts). Started `CHANGELOG.md` (Keep a Changelog). Open: version bump/release for the subtask feature not yet cut; `Ideas.md` remains untracked scratch.

---

## 2026-07-05 — v2.0.2 (Community-review fixes, round 2)

Second review pass on 2.0.1. Cleared the one remaining error and the residual warnings.

- **`no-unsupported-api` (the last error)** — `Workspace.revealLeaf` returns `Promise<void>` only `@since 1.7.2`, so raised `minAppVersion` `1.5.0` → `1.7.2`.
- **CSS `text-decoration`** (partially supported at the scanner's 1.4.5 baseline) — swapped the dotted underline for `border-bottom: 1px dotted`.
- **Floating/misused promises** — `void`'d `openLinkText`; wrapped the calendar `commit(...)` click handlers so they return void.
- **`no-unsafe-*`** — rewrote the `pad` date helpers to a typed `(n) => n < 10 ? \`0${n}\` : \`${n}\`` (drops `String(n).padStart`, which the linter typed as unsafe).

Note: the scanner's CSS check is pinned to Obsidian 1.4.5 regardless of `minAppVersion`, so CSS features must clear that baseline.

---

## 2026-07-05 — v2.0.1 (Community-review fixes)

Addressed the Obsidian community plugin automated review (2.0.0 failed on three errors). No user-facing behavior change.

**Fixes:**

- **`no-unsupported-api`** — raised `minAppVersion` from `0.15.0` to `1.5.0` to match the APIs actually used (`getLeaf("tab")`, `setCssStyles`, etc.).
- **`no-static-styles-assignment`** — replaced direct `el.style.x = …` with `el.setCssStyles({ … })` for the calendar/dropdown positioning, and a `.todo-hidden` class for inline-edit show/hide.
- **Settings heading** — removed the `containerEl.createEl("h2", …)` top-level settings header.
- **Popout-window compatibility** — `document` → `activeDocument`, `setTimeout`/`requestAnimationFrame` → `window.*`.
- **Floating / misused promises** — event handlers no longer return promises; fire-and-forget calls marked with `void` (or extracted, e.g. `openSourceFile`).
- **Command id/name** — dropped the plugin prefix (`open-agent-board` → `open-board`, "Open AgentBoard" → "Open board").
- **Misc lint** — removed unnecessary type assertions; typed `loadData()`; CSS `text-decoration` shorthand and dropped a duplicate `color` (the `color-mix` fallback, no longer needed at minAppVersion 1.5.0).
- **README** — replaced the `<1-3>`-style angle-bracket notation (flagged as unfilled placeholder text) with a concrete example; the attribute table still documents the ranges.

**Note:**

- Still open (a *recommendation*, not an error): GitHub artifact attestations for release assets. Would require a CI release workflow using `actions/attest-build-provenance`; deferred.

---

## 2026-07-04 — v2.0.0 (Prioritization, on-board editing & agentic workflow)

A major release turning AgentBoard into the visual half of an agent-driven workflow: an external agentic skill scores tasks into the Markdown file, and the board renders, ranks, and round-trips them. Adds a prioritization attribute format, on-board editing of scores and due dates, a custom calendar, overdue highlighting, and a full docs pass.

### Prioritization metadata (new file format)

- **Attribute block per task** — each task carries a trailing `[U:_ I:_ T:_ E:_ Due:_ Crit:_ UsrEdit:_]` block: U (urgency 1–3), I (importance 1–3), T (total = U+I), E (effort S/M/L), Due (`DD-Mon-YYYY` / `DD-Mon` / `-`), Crit (Y/N), UsrEdit (Y). The block is parsed out and stripped from the displayed text.
- **Score box on cards** — a single `U | I | E` pill, each section colored by value: red (U/I = 3, E = L), amber (= 2, E = M), green (= 1, E = S).
- **Due date pill** — shown with a calendar icon; **overdue** open tasks get a red outline (completed tasks exempt).
- **Critical is derived** from `Crit:Y`/`Crit:y` (replaced the old ` (Critical)` suffix). Restyled to a muted red left stripe + faint row tint with desaturated, semibold text — no more `!` badge or bright red text.
- **Last-updated timestamp** — the board's file bar shows the file's `Last updated on: ...` line, right-aligned.

### On-board editing (writes back to the file)

- **Edit U / I / E** — click a score section to pick a new value from a menu; recolors on the next render.
- **Edit due date** — click the due pill (or the faint calendar icon on a date-less task) to open a **custom in-theme calendar popover** (month grid, prev/next nav, Today / Clear).
- **Derived fields recomputed on write** — changing U or I recomputes `T = U+I` and `Crit` (Y iff U≥2 AND I≥2).
- **`UsrEdit:Y` stamp** — any on-board edit to U/I/E/Due/Crit adds `UsrEdit:Y` so the generating agent leaves user-set values alone.

### Docs, examples & tooling

- **Rewrote `README.md`** as the public **ingestion contract** for the agent skill (full format table, derived-field rules, "rules for the agent skill", board behavior) and added a board screenshot (`assets/board.png`).
- **Added `AGENTS.md`** — architecture, the two-copy vault model, build/dev workflow, and load-bearing gotchas; points to the code as the source of truth for the format.
- **Updated `todolist_example.md`** to the new attribute format (validated: every `T = U+I`, every `Crit` matches the rule).
- **Build auto-sync** — `esbuild.config.mjs` now copies `main.js`/`manifest.json`/`styles.css` into `.obsidian/plugins/agent-board/` on every build, since the repo folder is itself the dev vault.
- The companion skill that generates the core todo file is intentionally **not in the repo yet** ("example skill coming soon").

### Insights

- **Attribute-block detection** matches a trailing bracket that is *entirely* known `Key:Value` tokens (U/I/T/E/Due/Crit/UsrEdit). An earlier "must contain `Crit:`" rule broke round-tripping once an edit could produce a block without `Crit` (e.g. adding only a due date); the stricter rule also ignores decoys like `[chapter 2: intro]` and leaves `[[wiki-links]]`/URLs untouched.
- Edits rewrite the block via an ordered key map serialized in a **canonical order** (U, I, T, E, Due, Crit, UsrEdit), keeping the file tidy and predictable for the agent.
- Year is inferred as the current year when a `DD-Mon` date lacks one — relevant to overdue checks on legacy dates until re-saved with a year.
- The native `<input type="date">` + `showPicker()` **does not work** inside Obsidian's Electron shell (picker never appeared, even after removing the blur-race and adding try/catch). Replaced with the self-contained calendar popover — no native date API dependency. **Don't reach for the native picker again.**

---

## 2026-05-26 — v1.0.1 (First release)

First public release. AgentBoard renders a Markdown todo file as a Google Tasks–style board, synced bidirectionally in real time.

**Key features:**

- **Board view** — each `#`, `##`, or `###` heading in the todo file becomes its own column
- **Real-time two-way sync** — edits to the Markdown file (including by external AI agents) appear on the board instantly, and board edits write straight back to the file
- **Add / edit / delete tasks** — add via `+ Add task`, double-click to edit inline, remove via the `⋯` menu
- **Complete tasks** — checkbox toggles a task; completed tasks collapse into a foldable section per column
- **Critical tasks** — mark via the `⋯` menu; text turns red with a `!` badge (stored as ` (Critical)` in the file)
- **Rename columns** — double-click a column heading; the rename writes back to the file
- **Reorder columns** — drag the `⠿` handle; order is stored in settings, leaving the file structure untouched
- **Wiki-links** — `[[note]]` links render as clickable, with autocomplete while typing `[[`
- **Hover descriptions** — `About:` lines under a heading become the column's tooltip
- **Source file link** — the active todo file is shown at the top of the board and opens on click
- **Configurable target file** — set the todo file path in Settings, with autocomplete over the vault's `.md` files

**Insights:**

- Task mutations re-read and re-parse the file fresh, then match by text + completion state rather than line number — keeps the board robust against concurrent external edits.
- Column order is intentionally decoupled from file order so reordering never rewrites the source Markdown.
