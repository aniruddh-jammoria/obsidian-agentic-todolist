import {
	App,
	ItemView,
	Menu,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_TODO_BOARD = "todo-board-view";

interface TodoTask {
	text: string;      // clean text, (Critical) stripped
	completed: boolean;
	critical: boolean;
	lineNumber: number;
}

interface TodoTheme {
	name: string;
	about?: string;
	headerLevel: number;
	headerLineNumber: number;
	tasks: TodoTask[];
}

interface TodoBoardSettings {
	todoFilePath: string;
	columnOrder: string[];
}

const DEFAULT_SETTINGS: TodoBoardSettings = {
	todoFilePath: "todo.md",
	columnOrder: [],
};

export default class TodoBoardPlugin extends Plugin {
	settings!: TodoBoardSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_TODO_BOARD,
			(leaf) => new TodoBoardView(leaf, this)
		);

		this.addRibbonIcon("check-square", "Open Todo Board", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-todo-board",
			name: "Open Todo Board",
			callback: () => {
				this.activateView();
			},
		});

		this.addSettingTab(new TodoBoardSettingTab(this.app, this));
	}

	async activateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TODO_BOARD);

		if (leaves.length > 0) {
			workspace.revealLeaf(leaves[0]);
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_TODO_BOARD, active: true });
		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TodoBoardView extends ItemView {
	plugin: TodoBoardPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: TodoBoardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TODO_BOARD;
	}

	getDisplayText(): string {
		return "Todo Board";
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
				const rawText = m[2];
				const critical = /\(Critical\)/i.test(rawText);
				const text = rawText.replace(/\s*\(Critical\)/gi, "").trim();
				current.tasks.push({
					text,
					completed: m[1] === "x",
					critical,
					lineNumber: i,
				});
			}
		}

		return themes;
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
				text: "Target MD file with todo list not found. Configure the path in Settings > ToDo list board",
				cls: "todo-board-error",
			});
			return;
		}

		const content = await this.app.vault.read(file);
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

		if (task.critical) {
			taskEl.createEl("span", {
				text: "!",
				cls: "todo-critical-badge",
				attr: { title: "Critical" },
			});
		}

		const textSpan = this.renderTaskText(taskEl, task);

		if (!task.completed) {
			textSpan.addClass("todo-task-text-editable");
			textSpan.addEventListener("dblclick", () => {
				this.showEditInput(taskEl, theme, task, textSpan);
			});
		}

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
		taskEl: HTMLElement,
		theme: TodoTheme,
		task: TodoTask,
		textSpan: HTMLElement
	) {
		if (taskEl.querySelector(".todo-edit-input")) return;
		textSpan.style.display = "none";

		const input = taskEl.createEl("input", {
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
		const newPrefix = wasCompleted ? "- [ ] " : "- [x] ";
		const criticalSuffix = task.critical ? " (Critical)" : "";
		lines[task.lineNumber] = newPrefix + task.text + criticalSuffix;
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
		const prefix = wasCompleted ? "- [x] " : "- [ ] ";
		// Preserve critical status from the fresh parse
		const criticalSuffix = task.critical ? " (Critical)" : "";
		lines[task.lineNumber] = prefix + newText + criticalSuffix;
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

		const lines = content.split("\n");
		const prefix = wasCompleted ? "- [x] " : "- [ ] ";
		lines[task.lineNumber] = wasCritical
			? prefix + task.text
			: prefix + task.text + " (Critical)";
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

class TodoBoardSettingTab extends PluginSettingTab {
	plugin: TodoBoardPlugin;

	constructor(app: App, plugin: TodoBoardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Todo List Board Settings" });

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
