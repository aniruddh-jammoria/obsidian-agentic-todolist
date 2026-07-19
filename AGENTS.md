# AGENTS.md

Guidance for AI agents working on **AgentBoard**, an Obsidian plugin that renders a Markdown todo file as a Kanban board with bidirectional real-time sync.

## What this plugin is

- Each `#`/`##`/`###` heading in a target `.md` file becomes a board **column**; `- [ ]`/`- [x]` lines become **task cards**.
- Edits on the board write straight back to the Markdown file; edits to the file (including by an external AI agent) re-render the board live via a `vault.on("modify")` listener.
- Distinguishing angle: the Markdown file is treated as the source of truth an agent maintains, while the user interacts through the board.

## Repo layout & the two-copy vault model (important)

**This repo folder is itself an Obsidian vault.** There are two copies of the plugin, and only one is what Obsidian runs:

| Location | Role |
|---|---|
| Repo root (`main.ts`, `main.js`, `styles.css`, `manifest.json`) | Source + build output. What you edit. Obsidian never reads these. |
| `.obsidian/plugins/agent-board/` | The **installed copy** Obsidian actually loads. |

`main.js` is a **gitignored build artifact** (bundled from `main.ts` by esbuild) — don't hand-edit it; edit `main.ts` and rebuild.

## Build / dev workflow

- `npm run build` — typechecks (`tsc -noEmit`) + production bundle.
- `npm run dev` — esbuild watch mode; rebuilds on every `.ts` save.
- Both automatically **copy `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/agent-board/`** (an `onEnd` hook in [esbuild.config.mjs](esbuild.config.mjs) prints `sync: copied ...`). So there is no manual copy step.
- **After any change you still must reload the plugin in Obsidian** (toggle off/on in Community plugins, or "Reload app without saving") — Obsidian only reads plugin code at load time.
- CSS-only edits during `npm run dev` won't auto-copy (esbuild watches only the TS import graph). Save a `.ts` file or run `npm run build` to push a CSS change.
- **Always run `npm run build` after editing `main.ts` or `styles.css`** so the installed copy stays current, and verify the `sync: copied` line appears.

## Releasing

AgentBoard is an **approved Obsidian community plugin**. Releases are automated by [.github/workflows/release.yml](.github/workflows/release.yml) — do **not** hand-build and drag assets into a release anymore.

Release flow:

1. Bump the version in **`manifest.json`, `package.json`, and `versions.json`** (all three must agree; `versions.json` maps the new version → its `minAppVersion`). Add a dated `DEVELOPMENT_LOG.md` entry.
2. Commit to `main`, then tag with the **bare version number, no `v` prefix** (e.g. `git tag 2.0.3 && git push origin 2.0.3`).
3. On the tag push, CI **builds → attests → creates a draft release** with `main.js`, `manifest.json`, `styles.css` attached (and build-provenance attestations, via `actions/attest-build-provenance`).
4. Add release notes to the draft and **Publish**. Obsidian then offers the update to users automatically (no more submission PRs — that was one-time).

Gotchas:
- **Let CI own the release.** Don't also create a release manually for the same tag — `gh release create` fails on a duplicate.
- **`minAppVersion` must cover every API used.** The `no-unsupported-api` review check compares against it; e.g. `Workspace.revealLeaf` returns a Promise only `@since 1.7.2`, which set the current floor. Check an API's `@since` in `node_modules/obsidian/obsidian.d.ts` before using it.
- **The community review's CSS check is pinned to Obsidian 1.4.5**, independent of `minAppVersion` — CSS features must clear that baseline (e.g. avoid `text-decoration` shorthand; `color-mix` is fine).
- **DOM creation must use Obsidian's helpers** — the review flags `document.createElement` *and* `createEl("div"|"span")`: use `createDiv`/`createSpan` (methods on any element, or the globals for detached nodes) and `createEl` only for other tags.
- **No `Array.prototype.includes`** — tsconfig `lib` is `["ES6", "DOM"]`, so it's error-typed and trips `no-unsafe-call`; use `indexOf(...) === -1`. (String `.includes` is ES2015 and fine.)
- **Deferred review warning**: the declarative settings API (`getSettingDefinitions` on `PluginSettingTab`, Obsidian 1.13+) is not adopted — it isn't in the installed typings and would raise `minAppVersion` to 1.13.0. Revisit when bumping the obsidian package.
- Release assets are the **three files at the repo root** (`main.js` is gitignored but built in CI); never the auto-generated source zip.

## Todo file format

> **The format is expected to evolve.** To avoid stale duplication, this file does **not** restate the literal spec (keys, ranges, date shape). Read it from the authoritative sources instead:
> - **Canonical parser** — `parseTaskMeta` and the attribute-block regex in [main.ts](main.ts). This is the source of truth for what is valid; `serializeAttr` defines the canonical key order.
> - **Human-readable spec** — [README.md](README.md) documents the format as the public ingestion contract for the agent skill that generates the file. Keep it in sync when the format changes.
> - **Live example** — `todolist_example_internal.md` (gitignored), the real working file in the current format.
>
> When the format changes, update the code and that example; do not re-document the key list here.

Shape at a glance (for orientation only — verify against the code): each task is `- [ ] <text> [<Key:Value ...>]`, where the bracketed block holds prioritization attributes (urgency, importance, a derived total, effort, due date, a critical flag, and a user-edit flag).

**Durable rationale worth knowing (this is why AGENTS.md still covers the format at all):**
- **Derived fields** — the total and the critical flag are *computed* (from urgency + importance), not independently authored. Any edit that changes their inputs must recompute them. See `updateAttributes`.
- **`UsrEdit` exists to arbitrate human vs. agent** — it is set when the user edits a task on the board and tells the generating agent **not to overwrite** that task's values. Preserve this flag through every mutation.
- **Manual critical toggle overrides the derived rule** and also sets `UsrEdit` — explicit user action wins.
- **The attribute block must be distinguishable from `[[wiki-links]]`, `[bracketed text]`, and URLs** in the task text. The detection regex matches a trailing bracket made up *entirely* of known `Key:Value` tokens. Don't loosen it to "must contain a specific key" — that broke round-tripping once an edit could produce a block without that key.

- **Subtasks are one level deep** — an indented task line attaches to the nearest preceding top-level task (`parseContent`). Completion cascades both ways at write time in `toggleTask` (last subtask done ⇢ parent done; parent toggled ⇢ all subtasks follow; subtask reopened ⇢ completed parent reopens). Every mutation resolves subtasks *under their parent* via `findFreshTask`, and each line's original indentation is preserved on write.

Other file conventions:
- `About:` line under a heading → column tooltip.
- `Last updated on: <text>` line anywhere → shown right-aligned in the board's file bar (display only; the plugin never writes it).

## Architecture (all in [main.ts](main.ts))

Three classes:
- **`AgentBoardPlugin`** — entry point: registers the view, ribbon icon, command, settings tab; persists settings (`todoFilePath`, `columnOrder`).
- **`AgentBoardView`** (`ItemView`) — the core: parse → render → interactions → file mutations.
- **`AgentBoardSettingTab`** — single setting: the todo file path (with `.md` datalist autocomplete).

Key methods in `AgentBoardView`:
- `parseContent` → `TodoTheme[]`; `parseTaskMeta` splits a line into clean text + parsed attributes.
- Attribute block detection uses a regex that matches a **trailing bracket made up entirely of known `Key:Value` tokens** (`U|I|T|E|Due|Crit|UsrEdit`). This is what keeps `[[wiki-links]]`, `[chapter 2: intro]`, and URLs from being misread as attributes. Don't loosen it back to "must contain `Crit:`" — that broke round-tripping once an edit could produce a block without `Crit` (e.g. add-due-only).
- Rendering: `renderColumn` → `renderTask` → `renderTaskText` (wiki-links) + `renderTaskMeta` (score box + due pill).
- Editing UI: `showScoreMenu` (Obsidian `Menu` for U/I/E), `showDatePicker` (a **custom in-house calendar popover** — don't switch back to a native `<input type="date">`/`showPicker()`, which doesn't work in Obsidian's Electron shell), inline double-click text/title edits.
- File mutations: **every mutation re-reads and re-parses the file fresh, matches the task by `(text, completed)` — scoped under its parent for subtasks, via `findFreshTask` — edits the affected line(s), writes back.** This is deliberate — it survives concurrent external edits. Helpers: `buildTaskLine`, `parseAttrMap`, `serializeAttr` (canonical order), `updateAttributes` (applies U/I/E/Due edits, recomputes T + Crit, stamps `UsrEdit:Y`). `toggleCritical` uses the same map path.
- `columnOrder` lives in settings, **decoupled from file order** — reordering columns never rewrites the Markdown.
- Overdue: `isOverdue` + `dueToISO`/`isoToDue` convert between `DD-Mon[-YYYY]` and ISO; open tasks past due get a red outline (completed exempt).

## Privacy — keep private info out of committed files

The real working file, `todolist_example_internal.md` (gitignored), contains the user's **actual private tasks** (health, finances, personal matters). It is the best reference for the current format, but its contents must **never** be copied verbatim into anything committed to the repo.

- When creating or updating a **committed** example (`todolist_example.md`, the README example block, docs, screenshots), use **fictional, sanitized tasks** — generic placeholders like "Book dentist appointment", "Set up a recurring ETF investment account". Do not carry over personal specifics (medical conditions, account names, real names, real dates tied to the user).
- Before committing any file that shows example tasks, **scan it for anything that reads as real personal data** and replace it.
- If asked to "take examples from the todo file", pull the *shape* and *phrasing style* from the internal file but rewrite the content as neutral placeholders.
- Screenshots (`assets/*.png`) must show the sanitized `todolist_example.md`, never the internal file.

## Conventions & gotchas

- **Match-by-text is ambiguous for duplicates**: two identical task texts in the same column + completion state resolve to the first match. Known limitation.
- **Year inference**: year-less `DD-Mon` dates assume the current year for overdue checks until re-saved with a year via the picker.
- **`showPicker()`** isn't in the configured DOM lib types — it's cast inline; desktop-only API, degrades to focus-open on mobile.
- **Critical styling** is intentionally muted (left stripe + faint tint + desaturated semibold text via `color-mix`, with a solid fallback color) — not bright red. Don't reintroduce the neon `var(--color-red)` text or the `!` badge.
- **`README.md` is current** and doubles as the public ingestion contract for the companion agent skill, which ships in this repo at [skills/agentboard-sync/SKILL.md](skills/agentboard-sync/SKILL.md). The committed skill is a **sanitized template** (placeholder vault path and generic folder names in its Configuration section) — keep personal paths/folders out of it. **`todolist_example.md`** (the committed public sample) is in the current attribute-block format with sanitized, fictional tasks — keep it that way (see [Privacy](#privacy--keep-private-info-out-of-committed-files)).
- `todolist_example_internal.md` is the real working file (gitignored for privacy) and the best reference for the current format — but its contents are private; never copy them into committed files verbatim.
- manifest id: `agent-board`; package name: `obsidian-agent-board`. **Approved and listed in the Obsidian community plugin directory** — updates ship via tagged GitHub releases (see [Releasing](#releasing)).

## Development log

Keep [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) updated with a dated entry (key changes + insights) whenever you make a meaningful change — it's the running record of release notes and design decisions.
