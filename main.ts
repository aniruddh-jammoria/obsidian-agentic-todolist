import {
	App,
	ItemView,
	Menu,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_AGENT_BOARD = "agent-board-view";

type Effort = "S" | "M" | "L";
type Level = "red" | "amber" | "green";

interface TodoTask {
	text: string;      // clean text, attribute block stripped
	completed: boolean;
	critical: boolean;     // from Crit:Y / Crit:y
	urgency: number | null;     // U (1–3)
	importance: number | null;  // I (1–3)
	total: number | null;       // T (U + I)
	effort: Effort | null;      // E (S / M / L)
	due: string | null;         // Due (DD-Mon), null when "-" or absent
	attr: string;      // raw trailing attribute block incl. [], "" if none
	lineNumber: number;
}

interface TodoTheme {
	name: string;
	about?: string;
	headerLevel: number;
	headerLineNumber: number;
	tasks: TodoTask[];
}

interface AgentBoardSettings {
	todoFilePath: string;
	columnOrder: string[];
}

const DEFAULT_SETTINGS: AgentBoardSettings = {
	todoFilePath: "todo.md",
	columnOrder: [],
};

export default class AgentBoardPlugin extends Plugin {
	settings!: AgentBoardSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_AGENT_BOARD,
			(leaf) => new AgentBoardView(leaf, this)
		);

		this.addRibbonIcon("check-square", "Open AgentBoard", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-agent-board",
			name: "Open AgentBoard",
			callback: () => {
				this.activateView();
			},
		});

		this.addSettingTab(new AgentBoardSettingTab(this.app, this));
	}

	async activateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_AGENT_BOARD);

		if (leaves.length > 0) {
			workspace.revealLeaf(leaves[0]);
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_AGENT_BOARD, active: true });
		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AgentBoardView extends ItemView {
	plugin: AgentBoardPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: AgentBoardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT_BOARD;
	}

	getDisplayText(): string {
		return "AgentBoard";
	}

	getIcon(): string {
		return "check-square";
	}

	async onOpen() {
		await this.render();

		this.registerEvent(
			this.app.vault.on("modify", async (file: TAbstractFile) => {
				if (
					file instanceof TFile &&
					file.path === this.plugin.settings.todoFilePath
				) {
					await this.render();
				}
			})
		);
	}

	private async getTodoFile(): Promise<TFile | null> {
		const f = this.app.vault.getAbstractFileByPath(
			this.plugin.settings.todoFilePath
		);
		return f instanceof TFile ? f : null;
	}

	// Pulls the "Last updated on: ..." line, if present, from anywhere
	// in the file. Returns the trimmed timestamp text or null.
	private parseLastUpdated(content: string): string | null {
		const m = content.match(/^Last updated on:\s*(.+)$/m);
		return m ? m[1].trim() : null;
	}

	private parseContent(content: string): TodoTheme[] {
		const lines = content.split("\n");
		const themes: TodoTheme[] = [];
		let current: TodoTheme | null = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Match H1, H2, or H3 only
			const headerMatch = line.match(/^(#{1,3}) (.+)$/);
			if (headerMatch) {
				current = {
					name: headerMatch[2].trim(),
					headerLevel: headerMatch[1].length,
					headerLineNumber: i,
					tasks: [],
				};
				themes.push(current);
				continue;
			}

			if (current && line.startsWith("About:")) {
				current.about = line.slice(6).trim();
				continue;
			}

			const m = line.match(/^- \[([ x])\] (.+)$/);
			if (m && current) {
				const meta = this.parseTaskMeta(m[2]);
				current.tasks.push({
					text: meta.text,
					completed: m[1] === "x",
					critical: meta.critical,
					urgency: meta.urgency,
					importance: meta.importance,
					total: meta.total,
					effort: meta.effort,
					due: meta.due,
					attr: meta.attr,
					lineNumber: i,
				});
			}
		}

		return themes;
	}

	// Splits a task's raw text into clean text + its trailing attribute
	// block, e.g. "Do thing [U:3 I:2 T:5 E:M Due:30-Jun Crit:Y]".
	// The block is matched only at end-of-line and must contain Crit:, so
	// [[wiki-links]] and bracketed URLs in the text are left untouched.
	private parseTaskMeta(rawText: string): {
		text: string;
		attr: string;
		critical: boolean;
		urgency: number | null;
		importance: number | null;
		total: number | null;
		effort: Effort | null;
		due: string | null;
	} {
		// Match a trailing bracket made up entirely of known Key:Value
		// attribute tokens. This distinguishes the attribute block from
		// [[wiki-links]] and bracketed URLs/text elsewhere in the line.
		const attrMatch = rawText.match(
			/\s*(\[(?:U|I|T|E|Due|Crit|UsrEdit):[^\s\]]+(?:\s+(?:U|I|T|E|Due|Crit|UsrEdit):[^\s\]]+)*\])\s*$/
		);

		if (!attrMatch) {
			return {
				text: rawText.trim(),
				attr: "",
				critical: false,
				urgency: null,
				importance: null,
				total: null,
				effort: null,
				due: null,
			};
		}

		const attr = attrMatch[1];
		const text = rawText.slice(0, attrMatch.index).trim();

		const num = (re: RegExp): number | null => {
			const mm = attr.match(re);
			return mm ? parseInt(mm[1], 10) : null;
		};

		const effortMatch = attr.match(/\bE:\s*([SMLsml])\b/);
		const dueMatch = attr.match(/\bDue:\s*([^\s\]]+)/i);
		const critMatch = attr.match(/\bCrit:\s*([YyNn])\b/);

		return {
			text,
			attr,
			critical: critMatch ? /y/i.test(critMatch[1]) : false,
			urgency: num(/\bU:\s*(\d)/i),
			importance: num(/\bI:\s*(\d)/i),
			total: num(/\bT:\s*(\d)/i),
			effort: effortMatch
				? (effortMatch[1].toUpperCase() as Effort)
				: null,
			due: dueMatch && dueMatch[1] !== "-" ? dueMatch[1] : null,
		};
	}

	private getOrderedThemes(themes: TodoTheme[]): TodoTheme[] {
		const order = this.plugin.settings.columnOrder;
		if (!order || order.length === 0) return [...themes];

		const ordered: TodoTheme[] = [];
		for (const name of order) {
			const t = themes.find((t) => t.name === name);
			if (t) ordered.push(t);
		}
		// Append any themes not yet in saved order (newly added sections)
		for (const t of themes) {
			if (!order.includes(t.name)) ordered.push(t);
		}
		return ordered;
	}

	async render() {
		const container = this.contentEl;

		// Preserve horizontal scroll position across re-renders
		const existingBoard = container.querySelector(
			".todo-board"
		) as HTMLElement | null;
		const savedScrollLeft = existingBoard ? existingBoard.scrollLeft : 0;

		container.empty();
		container.addClass("todo-board-container");

		// ── File bar ────────────────────────────────────────────────
		const filePath = this.plugin.settings.todoFilePath;
		const baseName = filePath.split(/[/\\]/).pop() ?? filePath;
		const fileBar = container.createEl("div", { cls: "todo-board-file-bar" });
		fileBar.createEl("span", {
			text: "Source: ",
			cls: "todo-board-file-label",
		});
		const fileLink = fileBar.createEl("a", {
			text: baseName,
			cls: "todo-board-file-link",
			attr: { title: filePath },
		});
		fileLink.addEventListener("click", async () => {
			const f = await this.getTodoFile();
			if (f) await this.app.workspace.getLeaf(false).openFile(f);
		});

		// ── Board ────────────────────────────────────────────────────
		const file = await this.getTodoFile();
		if (!file) {
			container.createEl("div", {
				text: "Target MD file with todo list not found. Configure the path in Settings > AgentBoard",
				cls: "todo-board-error",
			});
			return;
		}

		const content = await this.app.vault.read(file);

		// Show the file's "Last updated on: ..." line, if it has one
		const lastUpdated = this.parseLastUpdated(content);
		if (lastUpdated) {
			fileBar.createEl("span", {
				text: `Last updated: ${lastUpdated}`,
				cls: "todo-board-file-updated",
			});
		}

		const themes = this.parseContent(content);
		const orderedThemes = this.getOrderedThemes(themes);

		const board = container.createEl("div", { cls: "todo-board" });
		for (const theme of orderedThemes) {
			this.renderColumn(board, theme, orderedThemes);
		}

		// Restore scroll after layout is painted
		requestAnimationFrame(() => {
			board.scrollLeft = savedScrollLeft;
		});
	}

	// ── Column ───────────────────────────────────────────────────────

	private renderColumn(
		board: HTMLElement,
		theme: TodoTheme,
		orderedThemes: TodoTheme[]
	) {
		const column = board.createEl("div", { cls: "todo-column" });

		const openTasks = theme.tasks.filter((t) => !t.completed);
		const completedTasks = theme.tasks.filter((t) => t.completed);

		// Header row: drag handle + title
		const header = column.createEl("div", { cls: "todo-column-header" });

		const dragHandle = header.createEl("span", {
			text: "⠿",
			cls: "todo-column-drag-handle",
			attr: { title: "Drag to reorder" },
		});

		const titleEl = header.createEl("h3", {
			text: `${theme.name} (${openTasks.length})`,
			cls: "todo-column-title",
		});
		if (theme.about) {
			titleEl.title = theme.about;
			titleEl.addClass("todo-column-title-has-about");
		}
		titleEl.addEventListener("dblclick", () => {
			this.showEditThemeTitle(titleEl, theme, openTasks.length);
		});

		// Drag-and-drop: only the drag handle initiates a drag
		dragHandle.setAttribute("draggable", "true");
		dragHandle.addEventListener("dragstart", (e) => {
			e.dataTransfer?.setData("text/plain", theme.name);
			// Tiny delay so the drag ghost captures the unmodified column
			setTimeout(() => column.addClass("todo-column-dragging"), 0);
		});
		dragHandle.addEventListener("dragend", () => {
			column.removeClass("todo-column-dragging");
		});

		column.addEventListener("dragenter", (e) => {
			e.preventDefault();
			column.addClass("todo-column-drag-over");
		});
		column.addEventListener("dragover", (e) => {
			e.preventDefault();
		});
		column.addEventListener("dragleave", (e) => {
			const related = e.relatedTarget as Node | null;
			if (!related || !column.contains(related)) {
				column.removeClass("todo-column-drag-over");
			}
		});
		column.addEventListener("drop", async (e) => {
			e.preventDefault();
			column.classList.remove("todo-column-drag-over");

			const draggedName = e.dataTransfer?.getData("text/plain");
			if (!draggedName || draggedName === theme.name) return;

			const currentOrder = orderedThemes.map((t) => t.name);
			const fromIdx = currentOrder.indexOf(draggedName);
			const toIdx = currentOrder.indexOf(theme.name);
			if (fromIdx < 0 || toIdx < 0) return;

			currentOrder.splice(fromIdx, 1);
			// Adjust target index after removal
			const adjustedToIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
			currentOrder.splice(adjustedToIdx, 0, draggedName);

			this.plugin.settings.columnOrder = currentOrder;
			await this.plugin.saveSettings();
			await this.render();
		});

		// Open tasks
		const taskList = column.createEl("div", { cls: "todo-task-list" });
		for (const task of openTasks) {
			this.renderTask(taskList, theme, task);
		}

		// Add task button — sits between open tasks and completed
		const addBtn = column.createEl("button", {
			text: "+ Add task",
			cls: "todo-add-btn",
		});
		addBtn.addEventListener("click", () => {
			this.showAddTaskInput(theme, taskList);
		});

		// Completed section (collapsed by default via <details>)
		if (completedTasks.length > 0) {
			const details = column.createEl("details", {
				cls: "todo-completed-section",
			});
			details.createEl("summary", {
				text: `Completed (${completedTasks.length})`,
				cls: "todo-completed-summary",
			});
			for (const task of completedTasks) {
				this.renderTask(details, theme, task);
			}
		}
	}

	// ── Task row ─────────────────────────────────────────────────────

	private renderTask(
		container: HTMLElement,
		theme: TodoTheme,
		task: TodoTask
	) {
		const taskEl = container.createEl("div", {
			cls: `todo-task${task.completed ? " todo-task-completed" : ""}${task.critical ? " todo-task-critical" : ""}`,
		});

		const checkbox = taskEl.createEl("input", {
			cls: "todo-checkbox",
		}) as HTMLInputElement;
		checkbox.type = "checkbox";
		checkbox.checked = task.completed;
		checkbox.addEventListener("change", async () => {
			await this.toggleTask(theme.name, task.text, task.completed);
		});

		// Body holds the text line and the metadata row (scores + due date)
		const body = taskEl.createEl("div", { cls: "todo-task-body" });

		const textLine = body.createEl("div", { cls: "todo-task-text-line" });

		const textSpan = this.renderTaskText(textLine, task);

		if (!task.completed) {
			textSpan.addClass("todo-task-text-editable");
			textSpan.addEventListener("dblclick", () => {
				this.showEditInput(textLine, theme, task, textSpan);
			});
		}

		this.renderTaskMeta(body, theme, task);

		// Three-dot menu button — shown only on row hover via CSS
		const menuBtn = taskEl.createEl("button", {
			text: "⋯",
			cls: "todo-task-menu-btn",
			attr: { title: "More options" },
		});
		menuBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.showTaskMenu(e, theme, task);
		});
	}

	// Renders task text with wiki-links as clickable spans
	private renderTaskText(container: HTMLElement, task: TodoTask): HTMLElement {
		const span = container.createEl("span", {
			cls: `todo-task-text${task.critical ? " todo-task-text-critical" : ""}`,
		});

		const wikiPattern = /\[\[([^\]]+)\]\]/g;
		let lastIdx = 0;
		let m: RegExpExecArray | null;

		while ((m = wikiPattern.exec(task.text)) !== null) {
			if (m.index > lastIdx) {
				span.appendText(task.text.slice(lastIdx, m.index));
			}
			const noteName = m[1];
			const link = span.createEl("a", {
				text: noteName,
				cls: "todo-wikilink",
			});
			link.addEventListener("click", (e) => {
				e.stopPropagation();
				this.app.workspace.openLinkText(
					noteName,
					this.plugin.settings.todoFilePath,
					false
				);
			});
			lastIdx = m.index + m[0].length;
		}

		if (lastIdx < task.text.length) {
			span.appendText(task.text.slice(lastIdx));
		}

		return span;
	}

	// ── Metadata row (U | I | E score box + due date) ────────────────

	private renderTaskMeta(
		body: HTMLElement,
		theme: TodoTheme,
		task: TodoTask
	) {
		const hasScores =
			task.urgency !== null ||
			task.importance !== null ||
			task.effort !== null;

		const meta = body.createEl("div", { cls: "todo-meta" });

		if (hasScores) {
			const box = meta.createEl("div", {
				cls: "todo-score-box",
				attr: { title: "Urgency | Importance | Effort — click to change" },
			});
			if (task.urgency !== null) {
				this.renderScoreSeg(
					box, "U", String(task.urgency),
					this.levelForValue(task.urgency),
					(e) => this.showScoreMenu(e, theme, task, "U")
				);
			}
			if (task.importance !== null) {
				this.renderScoreSeg(
					box, "I", String(task.importance),
					this.levelForValue(task.importance),
					(e) => this.showScoreMenu(e, theme, task, "I")
				);
			}
			if (task.effort !== null) {
				this.renderScoreSeg(
					box, "E", task.effort,
					this.levelForEffort(task.effort),
					(e) => this.showScoreMenu(e, theme, task, "E")
				);
			}
		}

		if (task.due) {
			// Overdue dates on still-open tasks get a red outline
			const overdue = !task.completed && this.isOverdue(task.due);
			const duePill = meta.createEl("span", {
				cls: `todo-due todo-due-editable${overdue ? " todo-due-overdue" : ""}`,
				attr: {
					title: overdue
						? `Overdue — due ${task.due} (click to change)`
						: `Due ${task.due} (click to change)`,
				},
			});
			const icon = duePill.createEl("span", { cls: "todo-due-icon" });
			setIcon(icon, "calendar");
			duePill.createEl("span", { text: task.due, cls: "todo-due-text" });
			duePill.addEventListener("click", (e) => {
				e.stopPropagation();
				this.showDatePicker(duePill, theme, task);
			});
		} else {
			// No due date yet — a faint calendar icon (visible on hover) to add one
			const addDue = meta.createEl("span", {
				cls: "todo-due todo-due-editable todo-due-empty",
				attr: { title: "Add due date" },
			});
			const icon = addDue.createEl("span", { cls: "todo-due-icon" });
			setIcon(icon, "calendar");
			addDue.addEventListener("click", (e) => {
				e.stopPropagation();
				this.showDatePicker(addDue, theme, task);
			});
		}
	}

	// Parses a "DD-Mon" or "DD-Mon-YYYY" due date against today.
	// Year is inferred as the current year when absent.
	private isOverdue(due: string): boolean {
		const iso = this.dueToISO(due);
		if (!iso) return false;
		const [y, mo, d] = iso.split("-").map(Number);
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		return new Date(y, mo - 1, d) < today;
	}

	private static readonly MONTHS = [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun",
		"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
	];

	// "DD-Mon" / "DD-Mon-YYYY" → "YYYY-MM-DD" for the native date input.
	private dueToISO(due: string): string | null {
		const m = due.match(/^(\d{1,2})-([A-Za-z]{3,})(?:-(\d{4}))?$/);
		if (!m) return null;
		const monthIdx = AgentBoardView.MONTHS.findIndex(
			(mo) => mo.toLowerCase() === m[2].slice(0, 3).toLowerCase()
		);
		if (monthIdx < 0) return null;
		const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${year}-${pad(monthIdx + 1)}-${pad(parseInt(m[1], 10))}`;
	}

	// "YYYY-MM-DD" (native input) → "DD-Mon-YYYY" for the MD file.
	private isoToDue(iso: string): string {
		const [y, mo, d] = iso.split("-").map(Number);
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${pad(d)}-${AgentBoardView.MONTHS[mo - 1]}-${y}`;
	}

	private renderScoreSeg(
		box: HTMLElement,
		label: string,
		value: string,
		level: Level,
		onClick: (e: MouseEvent) => void
	) {
		const seg = box.createEl("span", {
			text: `${label}:${value}`,
			cls: `todo-score todo-score-${level} todo-score-editable`,
		});
		seg.addEventListener("click", (e) => {
			e.stopPropagation();
			onClick(e);
		});
	}

	// ── Score / due editors ──────────────────────────────────────────

	private showScoreMenu(
		event: MouseEvent,
		theme: TodoTheme,
		task: TodoTask,
		field: "U" | "I" | "E"
	) {
		const menu = new Menu();
		const options =
			field === "E"
				? [
					{ value: "S", label: "S — small" },
					{ value: "M", label: "M — medium" },
					{ value: "L", label: "L — large" },
				]
				: [
					{ value: "1", label: "1 — low" },
					{ value: "2", label: "2 — medium" },
					{ value: "3", label: "3 — high" },
				];
		const current =
			field === "U"
				? String(task.urgency ?? "")
				: field === "I"
				? String(task.importance ?? "")
				: task.effort ?? "";

		for (const opt of options) {
			menu.addItem((item) =>
				item
					.setTitle(opt.label)
					.setChecked(opt.value === current)
					.onClick(async () => {
						if (opt.value === current) return;
						const update =
							field === "U"
								? { u: parseInt(opt.value, 10) }
								: field === "I"
								? { i: parseInt(opt.value, 10) }
								: { e: opt.value as Effort };
						await this.updateAttributes(theme, task, update);
					})
			);
		}
		menu.showAtMouseEvent(event);
	}

	// A custom, theme-matched calendar popover. Built in-house rather than
	// using a native <input type="date">, whose showPicker() is unreliable
	// inside Obsidian's Electron shell.
	private showDatePicker(
		anchor: HTMLElement,
		theme: TodoTheme,
		task: TodoTask
	) {
		// Only one picker at a time
		document.querySelectorAll(".todo-cal-popover").forEach((el) => el.remove());

		const popover = document.createElement("div");
		popover.className = "todo-cal-popover";
		document.body.appendChild(popover);

		const today = new Date();
		const iso = task.due ? this.dueToISO(task.due) : null;
		const sel = iso
			? (() => {
				const [y, m, d] = iso.split("-").map(Number);
				return { y, m: m - 1, d };
			})()
			: null;

		let viewYear = sel ? sel.y : today.getFullYear();
		let viewMonth = sel ? sel.m : today.getMonth(); // 0-based

		let done = false;
		const close = () => {
			if (done) return;
			done = true;
			document.removeEventListener("mousedown", onOutside, true);
			document.removeEventListener("keydown", onKey, true);
			popover.remove();
		};
		const commit = async (due: string) => {
			close();
			await this.updateAttributes(theme, task, { due });
		};
		const onOutside = (e: MouseEvent) => {
			if (!popover.contains(e.target as Node)) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};

		const el = (tag: string, cls?: string, text?: string): HTMLElement => {
			const e = document.createElement(tag);
			if (cls) e.className = cls;
			if (text != null) e.textContent = text;
			return e;
		};
		const pad = (n: number) => String(n).padStart(2, "0");

		const render = () => {
			popover.textContent = "";

			// Header: ‹  Month YYYY  ›
			const header = el("div", "todo-cal-header");
			const prev = el("button", "todo-cal-nav", "‹");
			const label = el(
				"span",
				"todo-cal-label",
				`${AgentBoardView.MONTHS[viewMonth]} ${viewYear}`
			);
			const next = el("button", "todo-cal-nav", "›");
			prev.addEventListener("click", () => {
				if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
				render();
			});
			next.addEventListener("click", () => {
				if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
				render();
			});
			header.append(prev, label, next);
			popover.append(header);

			// Weekday row (Monday-first)
			const dow = el("div", "todo-cal-grid todo-cal-dow");
			for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
				dow.append(el("span", "todo-cal-dowcell", d));
			}
			popover.append(dow);

			// Day grid
			const grid = el("div", "todo-cal-grid");
			const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
			const offset = (firstDow + 6) % 7; // blanks before day 1 (Mon-first)
			const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

			for (let i = 0; i < offset; i++) {
				grid.append(el("span", "todo-cal-cell todo-cal-empty"));
			}
			for (let day = 1; day <= daysInMonth; day++) {
				const cell = el("button", "todo-cal-cell", String(day));
				const isToday =
					viewYear === today.getFullYear() &&
					viewMonth === today.getMonth() &&
					day === today.getDate();
				const isSel =
					sel && sel.y === viewYear && sel.m === viewMonth && sel.d === day;
				if (isToday) cell.addClass("todo-cal-today");
				if (isSel) cell.addClass("todo-cal-selected");
				cell.addEventListener("click", () =>
					commit(`${pad(day)}-${AgentBoardView.MONTHS[viewMonth]}-${viewYear}`)
				);
				grid.append(cell);
			}
			popover.append(grid);

			// Footer: Today + Clear
			const footer = el("div", "todo-cal-footer");
			const todayBtn = el("button", "todo-cal-action", "Today");
			todayBtn.addEventListener("click", () =>
				commit(
					`${pad(today.getDate())}-${AgentBoardView.MONTHS[today.getMonth()]}-${today.getFullYear()}`
				)
			);
			footer.append(todayBtn);
			if (task.due) {
				const clearBtn = el("button", "todo-cal-action", "Clear");
				clearBtn.addEventListener("click", () => commit("-"));
				footer.append(clearBtn);
			}
			popover.append(footer);
		};

		render();

		// Position under the anchor, nudged on-screen if it overflows
		const rect = anchor.getBoundingClientRect();
		popover.style.top = `${rect.bottom + 4}px`;
		popover.style.left = `${rect.left}px`;
		requestAnimationFrame(() => {
			const pr = popover.getBoundingClientRect();
			if (pr.right > window.innerWidth - 4) {
				popover.style.left = `${Math.max(4, window.innerWidth - pr.width - 4)}px`;
			}
			if (pr.bottom > window.innerHeight - 4) {
				popover.style.top = `${Math.max(4, rect.top - pr.height - 4)}px`;
			}
		});

		// Defer global listeners so the opening click doesn't dismiss it
		setTimeout(() => {
			document.addEventListener("mousedown", onOutside, true);
			document.addEventListener("keydown", onKey, true);
		}, 0);
	}

	// Higher urgency/importance = more attention → red
	private levelForValue(value: number): Level {
		if (value >= 3) return "red";
		if (value === 2) return "amber";
		return "green";
	}

	// More effort = harder → red
	private levelForEffort(effort: Effort): Level {
		if (effort === "L") return "red";
		if (effort === "M") return "amber";
		return "green";
	}

	// ── Context menu ─────────────────────────────────────────────────

	private showTaskMenu(event: MouseEvent, theme: TodoTheme, task: TodoTask) {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle(task.critical ? "Remove critical" : "Mark as critical")
				.setIcon(task.critical ? "circle" : "alert-circle")
				.onClick(async () => {
					await this.toggleCritical(
						theme.name,
						task.text,
						task.completed,
						task.critical
					);
				})
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Delete task")
				.setIcon("trash")
				.onClick(async () => {
					await this.deleteTask(theme.name, task.text, task.completed);
				})
		);

		menu.showAtMouseEvent(event);
	}

	// ── Inline edits ─────────────────────────────────────────────────

	private showEditThemeTitle(
		titleEl: HTMLElement,
		theme: TodoTheme,
		openCount: number
	) {
		if (titleEl.querySelector(".todo-edit-theme-input")) return;
		titleEl.empty();

		const input = titleEl.createEl("input", {
			cls: "todo-edit-theme-input",
		}) as HTMLInputElement;
		input.type = "text";
		input.value = theme.name;

		const restore = () => {
			titleEl.empty();
			titleEl.textContent = `${theme.name} (${openCount})`;
			if (theme.about) {
				titleEl.title = theme.about;
				titleEl.addClass("todo-column-title-has-about");
			}
		};

		let committed = false;
		const commit = async () => {
			if (committed) return;
			committed = true;
			const newName = input.value.trim();
			if (newName && newName !== theme.name) {
				await this.editThemeTitle(theme, newName);
			} else {
				restore();
			}
		};
		const cancel = () => {
			if (committed) return;
			committed = true;
			restore();
		};

		input.addEventListener("keydown", async (e) => {
			if (e.key === "Enter") await commit();
			else if (e.key === "Escape") cancel();
		});
		input.addEventListener("blur", commit);
		input.focus();
		input.select();
	}

	private showAddTaskInput(theme: TodoTheme, taskList: HTMLElement) {
		if (taskList.querySelector(".todo-new-task-input")) return;

		const input = taskList.createEl("input", {
			cls: "todo-new-task-input",
		}) as HTMLInputElement;
		input.type = "text";
		input.placeholder = "Type task and press Enter… (use [[ for note links)";

		const closeWikiDropdown = this.setupWikiLinkAutocomplete(input);

		let committed = false;
		const commit = async () => {
			if (committed) return;
			committed = true;
			const text = input.value.trim();
			input.remove();
			if (text) await this.addTask(theme.name, text);
		};

		input.addEventListener("keydown", async (e) => {
			if (e.key === "Enter") {
				await commit();
			} else if (e.key === "Escape") {
				const wasOpen = closeWikiDropdown();
				if (!wasOpen) {
					committed = true;
					input.remove();
				}
			}
		});
		input.addEventListener("blur", commit);
		input.focus();
	}

	private showEditInput(
		host: HTMLElement,
		theme: TodoTheme,
		task: TodoTask,
		textSpan: HTMLElement
	) {
		if (host.querySelector(".todo-edit-input")) return;
		textSpan.style.display = "none";

		const input = host.createEl("input", {
			cls: "todo-edit-input",
		}) as HTMLInputElement;
		input.type = "text";
		input.value = task.text;

		const closeWikiDropdown = this.setupWikiLinkAutocomplete(input);

		let committed = false;
		const commit = async () => {
			if (committed) return;
			committed = true;
			const newText = input.value.trim();
			input.remove();
			textSpan.style.display = "";
			if (newText && newText !== task.text) {
				await this.editTask(theme.name, task.text, task.completed, newText);
			}
		};
		const cancel = () => {
			if (committed) return;
			committed = true;
			input.remove();
			textSpan.style.display = "";
		};

		input.addEventListener("keydown", async (e) => {
			if (e.key === "Enter") {
				await commit();
			} else if (e.key === "Escape") {
				const wasOpen = closeWikiDropdown();
				if (!wasOpen) cancel();
			}
		});
		input.addEventListener("blur", commit);
		input.focus();
		input.select();
	}

	// ── Wiki-link autocomplete ────────────────────────────────────────
	// Returns a function that closes the dropdown; the return value is
	// true if a dropdown was open, false if nothing was open.
	private setupWikiLinkAutocomplete(input: HTMLInputElement): () => boolean {
		let dropdown: HTMLElement | null = null;

		const closeDropdown = (): boolean => {
			if (dropdown) {
				dropdown.remove();
				dropdown = null;
				return true;
			}
			return false;
		};

		const updateDropdown = () => {
			const value = input.value;
			const cursorPos = input.selectionStart ?? value.length;
			const textBefore = value.slice(0, cursorPos);

			// Find the innermost unclosed [[
			const bracketIdx = textBefore.lastIndexOf("[[");
			if (bracketIdx < 0) {
				closeDropdown();
				return;
			}
			const afterBracket = textBefore.slice(bracketIdx + 2);
			if (afterBracket.includes("]]")) {
				closeDropdown();
				return;
			}

			const query = afterBracket.toLowerCase();
			const files = this.app.vault
				.getFiles()
				.filter(
					(f) =>
						f.extension === "md" &&
						(query === "" || f.basename.toLowerCase().includes(query))
				)
				.slice(0, 8);

			if (files.length === 0) {
				closeDropdown();
				return;
			}

			const rect = input.getBoundingClientRect();

			// Recreate dropdown each update to avoid stale item listeners
			if (dropdown) dropdown.remove();
			dropdown = document.createElement("div");
			dropdown.className = "todo-wikilink-dropdown";
			document.body.appendChild(dropdown);
			dropdown.style.top = `${rect.bottom}px`;
			dropdown.style.left = `${rect.left}px`;
			dropdown.style.width = `${rect.width}px`;

			for (const file of files) {
				const item = document.createElement("div");
				item.className = "todo-wikilink-dropdown-item";
				item.textContent = file.basename;
				item.addEventListener("mousedown", (e) => {
					// Prevent input blur so we can update the value first
					e.preventDefault();
					const before = value.slice(0, bracketIdx);
					const after = value.slice(cursorPos);
					input.value = before + "[[" + file.basename + "]]" + after;
					const newPos = before.length + file.basename.length + 4;
					input.setSelectionRange(newPos, newPos);
					closeDropdown();
					// Re-trigger so any further [[ after this one gets picked up
					input.dispatchEvent(new Event("input"));
				});
				dropdown.appendChild(item);
			}
		};

		input.addEventListener("input", updateDropdown);
		input.addEventListener("blur", () => closeDropdown());

		return closeDropdown;
	}

	// ── File mutations ────────────────────────────────────────────────

	// Rebuilds a task line, re-appending its attribute block if present.
	private buildTaskLine(
		completed: boolean,
		text: string,
		attr: string
	): string {
		const prefix = completed ? "- [x] " : "- [ ] ";
		return prefix + text + (attr ? " " + attr : "");
	}

	// Parses "[U:3 I:2 T:5 E:M Due:30-Jun Crit:Y]" into an ordered key→value map.
	private parseAttrMap(attr: string): Map<string, string> {
		const map = new Map<string, string>();
		const inner = attr.replace(/^\[|\]$/g, "").trim();
		for (const token of inner.split(/\s+/)) {
			const idx = token.indexOf(":");
			if (idx > 0) map.set(token.slice(0, idx), token.slice(idx + 1));
		}
		return map;
	}

	// Serializes an attribute map back to "[...]" in a canonical key order.
	private serializeAttr(map: Map<string, string>): string {
		const order = ["U", "I", "T", "E", "Due", "Crit", "UsrEdit"];
		const keys = [
			...order.filter((k) => map.has(k)),
			...[...map.keys()].filter((k) => !order.includes(k)),
		];
		return "[" + keys.map((k) => `${k}:${map.get(k)}`).join(" ") + "]";
	}

	// Applies user edits to U/I/E/Due, recomputes T and Crit, and stamps
	// UsrEdit:Y so the agent leaves user-set values alone.
	private async updateAttributes(
		theme: TodoTheme,
		task: TodoTask,
		updates: { u?: number; i?: number; e?: Effort; due?: string }
	) {
		const file = await this.getTodoFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const freshThemes = this.parseContent(content);
		const freshTheme = freshThemes.find((t) => t.name === theme.name);
		if (!freshTheme) return;

		const fresh = freshTheme.tasks.find(
			(t) => t.text === task.text && t.completed === task.completed
		);
		if (!fresh) return;

		const map = this.parseAttrMap(fresh.attr);

		if (updates.u !== undefined) map.set("U", String(updates.u));
		if (updates.i !== undefined) map.set("I", String(updates.i));
		if (updates.e !== undefined) map.set("E", updates.e);
		if (updates.due !== undefined) map.set("Due", updates.due);

		// Recompute Total and Critical whenever both U and I are known
		const u = parseInt(map.get("U") ?? "", 10);
		const i = parseInt(map.get("I") ?? "", 10);
		if (!isNaN(u) && !isNaN(i)) {
			map.set("T", String(u + i));
			map.set("Crit", u >= 2 && i >= 2 ? "Y" : "N");
		}

		// Mark as user-edited so the generating agent won't overwrite it
		map.set("UsrEdit", "Y");

		const lines = content.split("\n");
		lines[fresh.lineNumber] = this.buildTaskLine(
			fresh.completed,
			fresh.text,
			this.serializeAttr(map)
		);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	private async toggleTask(
		themeName: string,
		taskText: string,
		wasCompleted: boolean
	) {
		const file = await this.getTodoFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const freshThemes = this.parseContent(content);
		const theme = freshThemes.find((t) => t.name === themeName);
		if (!theme) return;

		const task = theme.tasks.find(
			(t) => t.text === taskText && t.completed === wasCompleted
		);
		if (!task) return;

		const lines = content.split("\n");
		lines[task.lineNumber] = this.buildTaskLine(
			!wasCompleted,
			task.text,
			task.attr
		);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	private async editTask(
		themeName: string,
		oldText: string,
		wasCompleted: boolean,
		newText: string
	) {
		const file = await this.getTodoFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const freshThemes = this.parseContent(content);
		const theme = freshThemes.find((t) => t.name === themeName);
		if (!theme) return;

		const task = theme.tasks.find(
			(t) => t.text === oldText && t.completed === wasCompleted
		);
		if (!task) return;

		const lines = content.split("\n");
		// Preserve the attribute block from the fresh parse
		lines[task.lineNumber] = this.buildTaskLine(
			wasCompleted,
			newText,
			task.attr
		);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	private async editThemeTitle(theme: TodoTheme, newName: string) {
		const file = await this.getTodoFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const freshThemes = this.parseContent(content);
		const freshTheme = freshThemes.find(
			(t) => t.name === theme.name && t.headerLevel === theme.headerLevel
		);
		if (!freshTheme) return;

		const lines = content.split("\n");
		lines[freshTheme.headerLineNumber] =
			"#".repeat(freshTheme.headerLevel) + " " + newName;
		await this.app.vault.modify(file, lines.join("\n"));

		// Keep column order in sync with the rename
		const order = this.plugin.settings.columnOrder;
		const idx = order.indexOf(theme.name);
		if (idx >= 0) {
			order[idx] = newName;
			await this.plugin.saveSettings();
		}
	}

	private async toggleCritical(
		themeName: string,
		taskText: string,
		wasCompleted: boolean,
		wasCritical: boolean
	) {
		const file = await this.getTodoFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const freshThemes = this.parseContent(content);
		const theme = freshThemes.find((t) => t.name === themeName);
		if (!theme) return;

		const task = theme.tasks.find(
			(t) => t.text === taskText && t.completed === wasCompleted
		);
		if (!task) return;

		// Flip Crit and stamp UsrEdit:Y so the agent won't recompute it
		const map = this.parseAttrMap(task.attr);
		map.set("Crit", wasCritical ? "N" : "Y");
		map.set("UsrEdit", "Y");

		const lines = content.split("\n");
		lines[task.lineNumber] = this.buildTaskLine(
			wasCompleted,
			task.text,
			this.serializeAttr(map)
		);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	private async deleteTask(
		themeName: string,
		taskText: string,
		wasCompleted: boolean
	) {
		const file = await this.getTodoFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const freshThemes = this.parseContent(content);
		const theme = freshThemes.find((t) => t.name === themeName);
		if (!theme) return;

		const task = theme.tasks.find(
			(t) => t.text === taskText && t.completed === wasCompleted
		);
		if (!task) return;

		const lines = content.split("\n");
		lines.splice(task.lineNumber, 1);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	private async addTask(themeName: string, text: string) {
		const file = await this.getTodoFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const freshThemes = this.parseContent(content);

		const themeIdx = freshThemes.findIndex((t) => t.name === themeName);
		if (themeIdx < 0) return;

		const theme = freshThemes[themeIdx];
		const nextTheme = freshThemes[themeIdx + 1];
		const sectionEnd = nextTheme ? nextTheme.headerLineNumber : lines.length;

		let insertAfter = theme.headerLineNumber;
		for (let i = theme.headerLineNumber + 1; i < sectionEnd; i++) {
			if (lines[i].match(/^- \[[ x]\] /)) {
				insertAfter = i;
			} else if (
				lines[i].startsWith("About:") &&
				insertAfter === theme.headerLineNumber
			) {
				insertAfter = i;
			}
		}

		lines.splice(insertAfter + 1, 0, `- [ ] ${text}`);
		await this.app.vault.modify(file, lines.join("\n"));
	}
}

class AgentBoardSettingTab extends PluginSettingTab {
	plugin: AgentBoardPlugin;

	constructor(app: App, plugin: AgentBoardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "AgentBoard Settings" });

		const datalistId = "todo-board-file-suggestions";
		const datalist = containerEl.createEl("datalist") as HTMLDataListElement;
		datalist.id = datalistId;
		for (const file of this.app.vault.getFiles()) {
			if (file.extension === "md") {
				const opt = document.createElement("option");
				opt.value = file.path;
				datalist.appendChild(opt);
			}
		}

		const statusEl = containerEl.createEl("div", {
			cls: "todo-settings-status",
		});

		let currentPath = this.plugin.settings.todoFilePath;

		new Setting(containerEl)
			.setName("Todo file path")
			.setDesc(
				'Path to the todo list file relative to the vault root (e.g. "todo.md" or "notes/todos.md")'
			)
			.addText((text) => {
				text.setPlaceholder("todo.md").setValue(currentPath);
				text.inputEl.setAttribute("list", datalistId);
				text.inputEl.addEventListener("input", () => {
					currentPath = text.getValue();
				});
			})
			.addButton((btn) => {
				btn.setButtonText("Save").setCta().onClick(async () => {
					const path = currentPath.trim();
					const vaultFile = this.app.vault.getAbstractFileByPath(path);
					this.plugin.settings.todoFilePath = path;
					await this.plugin.saveSettings();

					if (vaultFile instanceof TFile) {
						statusEl.textContent = "✓ Saved";
						statusEl.className = "todo-settings-status todo-status-success";
					} else {
						statusEl.textContent =
							"✓ Saved — file not found at this path, please check it";
						statusEl.className = "todo-settings-status todo-status-warning";
					}
					setTimeout(() => {
						statusEl.textContent = "";
						statusEl.className = "todo-settings-status";
					}, 3000);
				});
			});

		containerEl.appendChild(statusEl);
	}
}
