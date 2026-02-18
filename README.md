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
2. Click `Run` to execute code and generate a trace.
3. Use the right `Heap Graph` timeline controls (buttons/slider or arrow keys) to move between steps.
4. Check the `Console` tab for logs and runtime errors.
5. Click graph edges to jump to the corresponding source location and step.

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

- [x] Deliver live feedback on app init and editor changes (auto-run), plus cursor-driven step synchronization (MVP inference).
- [x] Build a two-pane full-screen layout: editor on the left, visualization on the right.
- [x] Support tabbed panes on both sides (Editor/Samples, Heap Graph/Details/Console).
- [x] Add user-configurable editor preferences (font size, theme, tab size, minimap, line numbers) with persistence.
- [x] Implement a sample JavaScript program picker with instant load/edit flow.
- [x] Visualize runtime state as an object-reference graph (objects as nodes, references as edges).
- [x] Use JavaScript source-to-source instrumentation to inject special tracing calls.
- [x] Record runtime heap-related events at injected points and replay them by step.
- [x] Provide source-location IDs and execution-order IDs for trace steps (`checkpointId` + `stepId`).
- [x] Visualize checkpoint insertion points in the editor and show checkpoint/execution-order info on gutter hover.
- [x] Clear function-local variables from the visible environment when function scope exits.
- [ ] Extend execution IDs with structural context (same loop iteration, same function invocation frame, call tree linkage).
- [ ] Optimize trace indexing for O(1)-class lookup by location ID and execution-order ID at scale.
- [ ] Enable direct manipulation in the graph pane (drag from node to node to create a reference edge).
- [ ] Add field-name inference for graph-created references and generate/apply the corresponding mutation.
- [x] Show editor overlays for checkpoints (glyph/column markers) and selected execution location highlighting.
- [ ] Add reverse-link highlighting from graph interactions to concrete assignment statements in the editor (beyond current jump/sync behavior).
- [ ] Introduce a stable analysis runtime contract (timeouts, cancellation, isolation, deterministic snapshots).
- [ ] Add automated test coverage for instrumentation correctness, trace replay, and graph/editor synchronization.
- [ ] Evaluate and document modern/stable technology choices for each subsystem (editor, graph engine, parser/transform, execution sandbox).
