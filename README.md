# Todo List Board

An Obsidian plugin that turns your Markdown to-do list into a visual, column-based board — one column per theme. The board and the Markdown file stay in sync in real time, so you can edit either one and see the change reflected immediately. Designed to work alongside AI agents that append tasks to the file.

## Features

- **Board view** — each `##` / `#` / `###` section in your todo file becomes its own column
- **Real-time sync** — changes made in the Markdown file (including by external agents) instantly appear on the board, and vice versa
- **Critical tasks** — mark a task as critical via the `⋯` menu; text turns red and a `!` badge appears
- **Inline editing** — double-click any task to edit its text directly on the board
- **Rename columns** — double-click a column heading to rename it; the change writes back to the MD file
- **Reorder columns** — drag columns by the `⠿` handle without affecting the MD file structure
- **Completed tasks** — completed tasks collapse into a foldable section at the bottom of each column
- **Add tasks** — type directly on the board; new tasks are appended to the correct section in the MD file
- **Delete tasks** — remove a task from the board via the `⋯` menu
- **Obsidian wiki-links** — `[[note_name]]` links in task text render as clickable links; autocomplete shows while you type `[[`
- **Hover descriptions** — `About:` lines under section headings appear as tooltips on the column title
- **Source file link** — the active todo file is shown at the top of the board and is clickable

## Todo file format

The plugin reads any Markdown file that uses this structure:

```markdown
## Health
About: Physical and mental health items.

- [ ] Book dentist appointment
- [x] Start stretching routine (Critical)

## Finance
- [ ] Open savings account
- [ ] Review pension status (Critical)
```

- `##`, `#`, or `###` headings become columns
- `About:` (optional) provides hover tooltip text for the column
- `- [ ]` open tasks, `- [x]` completed tasks
- Append ` (Critical)` to a task line to mark it as critical

## Installation

### From the Obsidian community plugins directory

1. Open **Settings → Community plugins → Browse**
2. Search for **Todo List Board**
3. Click **Install**, then **Enable**

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/aniruddh-jammoria/obsidian-agentic-todolist/releases/latest)
2. Copy them into `<your vault>/.obsidian/plugins/todo-list-board/`
3. Enable the plugin in **Settings → Community plugins**

## Configuration

Open **Settings → Todo List Board** and set the path to your todo Markdown file (relative to the vault root, e.g. `todo.md` or `notes/todos.md`). The path field autocompletes from all `.md` files in your vault.

## Usage

- Open the board via the **checkbox icon** in the left ribbon, or run **Open Todo Board** from the command palette
- **Add a task** — click `+ Add task` at the bottom of any column, type, and press Enter
- **Complete a task** — click the checkbox; the task moves to the Completed section
- **Edit a task** — double-click the task text, edit, then press Enter or click elsewhere
- **Critical / Delete** — hover over a task, click the `⋯` button, and choose from the menu
- **Rename a column** — double-click the column title, edit, press Enter
- **Reorder columns** — drag the `⠿` handle on any column header to a new position
- **Open source file** — click the filename link at the top of the board

## Development

```bash
git clone https://github.com/aniruddh-jammoria/obsidian-agentic-todolist
cd obsidian-todo-list-board
npm install
npm run dev   # watch mode
npm run build # production build
```

Copy `main.js`, `manifest.json`, and `styles.css` into your vault's plugin folder to test.

## License

[MIT](LICENSE)
