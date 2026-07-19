---
name: agentboard-sync
description: Populate, score, and organize your AgentBoard markdown file from your notes vault. Use when the user asks to sync todos, update the to-do board, or run the AgentBoard sync.
---

Populate, score, and organize your AgentBoard markdown file from your notes vault.

Every run does three things:
1. **Sync** — scan notes for new todos and add them to the board file
2. **Score** — fill in missing attributes on todos (U, I, T, E, Due, Crit)
3. **Rank** — re-order todos within every section by total score (T) descending

---

## Configuration

All user-tunable values live here — edit this section to adapt the skill to your vault. The steps below reference these values and never hardcode paths.

- **VAULT_ROOT** — absolute path to your Obsidian vault, e.g.:
  `C:\Users\you\Documents\MyVault`
- **SCAN_FOLDERS** — folders (relative to VAULT_ROOT) scanned for todos, e.g.:
  - `Daily Notes`
  - `01-Career`
  - `02 - Health`
  - `03-Finance`
  - `04 - Travel`
- **NESTED_FOLDERS** — the subset of SCAN_FOLDERS whose files default to **nested mode** (see below). Put project/topic folders here, where a file represents one piece of work; leave out journal-style folders (daily notes), where each todo should stand alone:
  - `01-Career`
  - `02 - Health`
  - `03-Finance`
  - `04 - Travel`

The **section alias table** in Step 3 is also a customization point — see the note there.

The output file path is read from AgentBoard's plugin settings (Step 1) — not configured here.

---

## Todo syntax and file modes

A todo in a note is any line matching, case-insensitively, `Todo(Category): text` or `Todo: text`. Nothing else creates board entries — plain `- [ ]` checklists in notes are ignored.

Every scanned file is **regular** or **nested**:

- **Regular** — each todo becomes its own top-level item in a section.
- **Nested** — the file becomes one parent task, `- [ ] [[{filename without .md}]]`, and each todo becomes a subtask indented 4 spaces beneath it:

```
- [ ] [[PC Upgrade]] [U:2 I:2 T:4 E:L Due:15-Aug Crit:Y]
    - [ ] Order the GPU [U:2 I:2 T:4 E:S Due:15-Aug Crit:Y]
    - [ ] Compare PSU options [U:1 I:2 T:3 E:M Due:- Crit:N]
```

**Mode resolution**: a frontmatter property `todos: nested` or `todos: flat` wins; otherwise files in a NESTED_FOLDER are nested and everything else is regular.

**Subtask rule** (applies board-wide, not just to nested files — the user may manually indent a task under any parent): an indented todo belongs to the nearest non-indented todo above it. A parent and its subtasks are one block — they stay together through every step and subtasks never leave their parent.

---

## Attribute format

All attributes live in one bracket block per todo line, e.g. `- [ ] Task text [U:2 I:3 T:5 E:S Due:30-Jun Crit:Y]`:

- **U** — Urgency (1–3)
- **I** — Importance (1–3)
- **T** — Total score (U + I), used for ranking
- **E** — Effort (S / M / L)
- **Due** — Deadline (`DD-Mon`, or `-` if none)
- **Crit** — `Y` when U ≥ 2 AND I ≥ 2, else `N`
- **UsrEdit:Y** — user-edited lock. Every attribute on a locked line is final: never overwrite, recompute, or remove it, and always keep the tag itself. The only allowed change is adding an attribute that is entirely absent (so ranking works). Applies to parents and subtasks alike.

A todo is **fully scored** when its block has all six of U, I, T, E, Due, Crit. Only ever fill in missing attributes — never re-score ones already present. (`UsrEdit` is a lock flag, not a scoring attribute.)

---

## Step 1 — Resolve the output file

Read `{VAULT_ROOT}/.obsidian/plugins/agent-board/data.json` and extract `todoFilePath` (relative to VAULT_ROOT). `OUTPUT_FILE = {VAULT_ROOT}/{todoFilePath}`. If the settings file is missing or the path is empty, stop and tell the user to configure it in AgentBoard's settings in Obsidian.

Read OUTPUT_FILE and extract:
- The `Last updated on: ...` timestamp, parsed as a datetime. If missing, treat all files as new.
- All todo lines (`- [ ]` / `- [x]`, including indented subtasks). For deduplication, store each line's clean task text (bracket block and checkbox prefix stripped). For `[[...]]` parents, also record the linked file and existing subtasks.
- All `## ` headings, in order — the live list of sections a todo can be assigned to. Never rely on a hardcoded section list. `Miscellaneous` is always available (created in Step 5 if needed).

---

## Step 2 — Find files modified since last run

List every `.md` file under each SCAN_FOLDER whose last-modified time is after the Step 1 timestamp. On Windows:

```powershell
$vault   = "{VAULT_ROOT}"
$folders = @({SCAN_FOLDERS, comma-separated quoted strings})
$folders | ForEach-Object {
    Get-ChildItem -Path (Join-Path $vault $_) -Recurse -Filter "*.md" |
      Where-Object { $_.LastWriteTime -gt [datetime]"{LAST_TIMESTAMP}" }
} | Select-Object FullName, LastWriteTime
```

On macOS/Linux, use the equivalent (e.g. `find "$VAULT_ROOT/$folder" -name "*.md" -newermt "$LAST_TIMESTAMP"`). The requirement is only: all `.md` files under each SCAN_FOLDER modified after LAST_TIMESTAMP.

Resolve each file's mode per **Todo syntax and file modes**. Files containing no todo lines are skipped entirely.

---

## Step 3 — Resolving a name to a section

Used for category tags (regular files) and folder names (nested files). Match the name against the live heading list, first rule that hits wins:

1. **Exact match** — compare case-insensitively, ignoring surrounding whitespace and `/`, `-`, `&` separators.
2. **Word-overlap match** — split name and heading into words (on space, `/`, `-`, `&`); any shared word is a match (`Finance` → `Finance/Investments`, `Work` → `Work / Learning`, `AI` → `AI project ideas`). If several headings tie, take the earliest in file order.
3. **Synonym match** — resolve the name through the alias table, then match the target words against headings. It is a convenience layer, not a source of truth: if no matching heading exists, fall through.

   > **Customization point** — this table maps *your* shorthand tags and folder names to *your* board's sections. Edit the rows to match the sections on your own board; the left column is free-form aliases, the right column should contain words that appear in your headings.

   | Alias | Resolves toward a heading containing |
   |---|---|
   | Medical, Dental, Doctor, Fitness | Health |
   | Investing, Money, Tax, Banking, Insurance | Finance / Investments |
   | Learning, Career, Job, Course, Certification | Work / Learning |
   | Side project, ML, LLM, Agent | AI |
   | Buy, Shopping, Order | Purchases |
   | Trip, Flight, Vacation, Hotel | Travel |

4. **Fallback** — `Miscellaneous`.

---

## Step 4 — Parse todos

**Regular files**: each todo becomes `- [ ] {text}` (no attributes yet). Its section is the category tag resolved via Step 3; untagged todos go to `Miscellaneous`.

**Nested files**: the parent is `- [ ] [[{filename without .md}]]`; each todo becomes a subtask `- [ ] {text}` indented 4 spaces under it. The parent's section is the file's SCAN_FOLDER name, numeric prefix stripped (`02 - Health` → `Health`), resolved via Step 3 (so `03-Finance` → Finance / Investments, `01-Career` → Work / Learning). Category tags on the todos themselves never affect placement — the whole file lives under one parent. If a parent link for the file already exists on the board (checked or unchecked), don't create a second one; new subtasks are appended under it.

---

## Step 5 — Deduplicate and add

Skip any new item whose clean task text already exists on the board (case-insensitive; checked or unchecked; anywhere on the board for subtasks). Parents dedupe on the `[[filename]]` target.

Insert survivors:
- **Regular todos** — append at the bottom of the target section (create the section at the end of the file if needed).
- **New parents** — append the parent at the bottom of its section, its subtasks immediately below.
- **New subtasks of an existing parent** — append at the bottom of that parent's subtask block.

---

## Step 6 — Score missing attributes

For every unlocked todo line (checked or unchecked, any level) missing any of U, I, T, E, Due — fill in only what's absent (respecting the UsrEdit rules above):

**Urgency (U)**
- **3**: explicit deadline or date; booking/claiming/renewing something time-sensitive; overdue or blocking; insurance claims, tax, legal filings, appointment scheduling
- **2**: should happen within weeks or months; pending routine admin; setup tasks for currently active goals
- **1**: no time pressure; exploratory ideas; long-term learning; nice-to-haves

**Importance (I)**
- **3**: directly affects health, legal standing, financial security, career trajectory, or key relationships
- **2**: meaningful for professional growth, active personal projects, quality-of-life, or mid-tier financial tasks
- **1**: low-stakes; curiosity-driven; minor purchases; tangential ideas

**T** = U + I

**Effort (E)** — **S**: under 30 min; **M**: 30 min–2 h; **L**: over 2 h or multi-session

**Due** — earliest date it must be done by, `DD-Mon` (e.g. `30-Jun`); `-` if none exists or can be inferred

**Crit** — `Y` if U ≥ 2 AND I ≥ 2, else `N`

Use the task text, section, date mentions, and keywords. When genuinely uncertain on U or I, default to 2.

**Parents with subtasks are derived, not assessed** — re-derive every unlocked parent each run, after its subtasks are scored:
- **U** / **I** / **T** — copied from its highest-T unchecked subtask (first on tie; use all subtasks if all are checked)
- **E** = `L`
- **Due** — earliest Due among unchecked subtasks, else `-`
- **Crit** — from the derived U and I

---

## Step 7 — Re-order within each section

Top-level items are single todos and parent blocks (a block sorts by its parent's T and moves whole). In every section: unchecked items sorted by T descending, then checked items sorted the same way; ties keep existing relative order. Apply the same ordering to subtasks within each parent block. Preserve all non-todo lines (headings, `About:` lines, blank lines).

---

## Step 8 — Write

Set the timestamp line to `Last updated on: {DD-MMM-YYYY HH:MM}` (current local time) and write the full updated file.

---

## Step 9 — Report

Brief summary: files scanned; new todos added by section (noting parents created and subtasks nested); duplicates skipped; todos scored this run; total re-ranked.
