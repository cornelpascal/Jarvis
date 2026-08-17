# Project Registry

## Purpose

The Project Registry converts configured filesystem roots into stable, persisted project records. It does not execute project commands and does not infer commands without repository evidence.

## Discovery

`services/projects` performs a bounded breadth-first scan of enabled roots. The default root remains `C:\Documents`, supplied by typed configuration. Scans inspect at most 10,000 directories and descend four levels by default. Symbolic links/junctions and dependency/build directories are not traversed.

A directory is a candidate when it contains supported signals such as Git metadata, package/build manifests, solution/project files, Docker files, `AGENTS.md`, or a README. Canonical real paths are de-duplicated case-insensitively when deriving stable project IDs. Missing and inaccessible roots are counted and do not prevent Core startup. Nested candidates remain independent records.

## Metadata and commands

Each record contains its canonical path, stable ID, enabled state, discovery signals, detected stack, Git evidence, and install/dev/lint/typecheck/test/build command evidence.

Package commands are recorded only from `package.json` scripts. The install command is selected only after inspecting the manifest and lockfile. Missing scripts remain `null`; the registry never invents them.

## Persistence and API

Roots live in `project_roots`, canonical records in `projects`, analysis in `project_metadata`, and current selection in `settings`. State survives restart.

Authenticated localhost endpoints:

- `GET /projects` — registry snapshot;
- `POST /projects/scan` — rescan enabled roots;
- `POST /projects/register` — manually analyze/register a directory;
- `POST /projects/select` — select an enabled project;
- `POST /projects/{id}/enabled` — enable or disable;
- `DELETE /projects/{id}` — remove registry metadata.

All mutations emit typed `project.*` events. Removal never deletes source files.

## Current limitations

- Root management is config/database-backed but has no dedicated settings editor yet.
- Analysis is top-level and deterministic; deep framework inspection belongs to Phase 10.
- Reparse points are skipped even when they intentionally point to a project.
- Scans are startup/manual operations; filesystem watching begins with indexing.

## Project index and retrieval

Phase 10 adds `SqliteProjectSearch`. Indexing walks the canonical enabled project without following symlinks, skips dependency/build/VCS directories, ignores secret-key/environment filenames and binary/oversized content, and persists text plus symbols in SQLite/FTS5. Reindexing replaces changed content and removes deleted files.

Retrieval combines exact path, filename, extracted symbols, bounded `rg --json` lexical matches, and SQLite FTS5. Results contain relative paths, optional lines/symbols, bounded snippets, an explicit retrieval layer, score, and index timestamp. The authenticated `/projects/index` and `/projects/search` APIs expose this contract. A routed project question with a selected project starts the search asynchronously and adds the highest-ranked evidence to the conversation.
