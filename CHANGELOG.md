# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.1.0] - 2026-07-19

### Added

- Subtasks: indented `- [ ]` lines under a task now render as nested subtasks on the board, under their parent
- Completing all subtasks automatically completes the parent task; completing the parent marks all its subtasks done (and reopening works the same way in reverse)
- "Add subtask" option in a task's three-dot menu, with an inline input under the parent
- Collapse/expand chevron on the bottom-right of tasks that have subtasks
- Progress indicator (e.g. `1/3`) on parent tasks showing completed vs total subtasks
- Companion agent skill `agentboard-sync` (in `skills/agentboard-sync/`) that populates, scores, and ranks the board file from your vault notes

## [2.0.2] and earlier

Released before this changelog existed: the prioritized board view, attribute
scoring (urgency/importance/effort/due/critical), on-board editing, and the
agentic file format. See `DEVELOPMENT_LOG.md` and the git history for details.
