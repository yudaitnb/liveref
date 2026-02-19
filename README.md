# LiveRef

LiveRef is a browser-based JavaScript execution playground that visualizes how object references change over time.
You can run code, capture a trace, and inspect heap relationships step by step.

## Features

- Monaco editor with `Run` / `Stop` controls.
- Execution in a Web Worker (isolated from the UI thread).
- Babel-based instrumentation for:
  - variable root tracking,
  - object/array construction tracking,
  - property writes and deletes,
  - per-statement trace points.
- Step-based heap replay with snapshots.
- Interactive heap graph (`vis-network`) with:
  - timeline slider and prev/next controls,
  - draggable node positions,
  - edge-click jump to the write step/location.
- Console log capture (`log`, `info`, `warn`, `error`) and runtime error display.

## Tech Stack

- React 19 + TypeScript + Vite
- Zustand (state)
- Monaco Editor
- Web Workers + Comlink
- Babel Standalone (runtime instrumentation)
- vis-network / vis-data (graph rendering)
- Radix UI Tabs + react-resizable-panels

## Getting Started

### Prerequisites

- Node.js 20+ (recommended)
- pnpm

### Install

```bash
pnpm install
```

### Run in dev mode

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

### Preview build

```bash
pnpm preview
```

### Lint

```bash
pnpm lint
```

## Deploy to GitHub Pages

### One-command deploy (push `dist/` to `gh-pages`)

```bash
pnpm run deploy:pages
```

This project includes:

- `pnpm run build:pages` (`vite build --base=./`)
- `pnpm run deploy:pages` (publishes `dist/` to `gh-pages` branch)

### GitHub repository settings

1. Push your main branch to GitHub first.
2. Run `pnpm run deploy:pages` locally once (this creates/updates `gh-pages` branch).
3. Open GitHub: `Settings` -> `Pages`.
4. Set:
   - `Source`: `Deploy from a branch`
   - `Branch`: `gh-pages`
   - `Folder`: `/ (root)`
5. Save, then wait for Pages build/deploy to finish.

Your site URL will be:

- `https://<your-user>.github.io/<your-repo>/`

## How to Use

1. Open the app and edit JavaScript in the left `Editor` tab.
2. Open the left `Samples` tab to load short syntax-focused programs (about 5-10 lines each).
3. Click `Run` to execute code and generate a trace.
4. Use the right `Heap Graph` timeline controls (buttons/slider or arrow keys) to move between steps.
5. Check the `Console` tab for logs and runtime errors.
6. Click graph edges to jump to the corresponding source location and step.

## Sample Catalog

- Simple samples include focused snippets for:
  - variable declarations,
  - assignments,
  - function calls,
  - if/else branches,
  - for loops,
  - array/object data-structure mutations,
  - delete operations.
- Complex samples include:
  - `Doubly Linked List`
  - `AVL Tree`

## Current Limitations

- Instrumentation targets script-style JavaScript (`sourceType: "script"`).
- Some JavaScript syntax patterns are still MVP-level and may not be transformed/replayed correctly in edge cases.
- Cursor-to-step inference is still heuristic (when loop/call context is ambiguous, it picks the first matching execution).
- Structural execution context IDs (loop iteration / function call frame linkage) are not implemented yet.
- Direct graph editing (creating references by drag-and-drop with field inference) is not implemented yet.
- `Details` tab content is still a placeholder.

## Project Structure

```text
src/
  panes/        # Editor / Heap Graph / Console UI
  runner/       # Worker runner, instrumentation, trace recorder
  trace/        # Trace types and replay logic
  state/        # Zustand stores
  monaco/       # Monaco worker setup
```

## Task List

- [x] Auto-run on init/edit with cursor/step synchronization between Editor and Heap Graph.
- [x] Two-pane layout with tab sets (`Editor/Samples` and `Heap Graph/Call Graph/Console`).
- [x] Persistent editor settings UI (theme, font, wrap, minimap, rulers, etc.).
- [x] Sample catalog expansion (short syntax-focused samples + data-structure samples) and category filtering.
- [x] Checkpoint markers/highlighting in editor and execution-order jump integration.
- [x] Object-reference visualization with legacy-style layout migration, redraw control, and drag behavior tuning.
- [x] Collapsible/filterable `Call Graph` pane with step jump back to graph/editor.
- [x] Null/undefined/NaN controls and class/variable visibility controls in graph sub-pane.
- [ ] Improve structural execution context accuracy (loop iteration linkage and call-frame precision for repeated checkpoints).
- [ ] Add robust built-in/library mutation modeling (e.g. `Array.prototype.push`/method internals) without recursion/stack overflow regressions.
- [ ] Add direct graph editing workflow (create/update references from UI with inferred field mapping).
- [ ] Improve scalability for large traces (indexing + virtualization/partial rendering).
- [ ] Strengthen runtime contract (timeouts, cancellation semantics, deterministic replay guarantees).
- [ ] Add automated tests for instrumentation, replay correctness, and pane synchronization.
