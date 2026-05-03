# Word Finder — Feature Reference

This document describes the working state of the app from the player's perspective. It is the source of truth that the e2e suite (`docs/TESTING.md`) verifies. If you change behavior, update this file *and* the matching spec. Architecture-level companion: [`INTELLIGENT_GENERATION.md`](./INTELLIGENT_GENERATION.md).

Every observable surface here has a stable `data-testid` hook so tests don't depend on layout, copy, or color.

---

## Layout overview

When you load `/`, the page is server-rendered with a randomly generated 5×5 board for the user-agent's form factor (350px wide on mobile, 400px on desktop). From top to bottom you see:

1. **Top bar** — `Word Finder` title, `Open Controls`, `Reset Board`, and an `Answers: N` count.
2. **Stats panel** — `Level: N` row with a stepped level bar, then a `Progress: x / total - p%` row with a horizontal fill bar.
3. **Board** — the letter grid.
4. **Word lists** — `Open Found Words` and `Open Answers` buttons at the bottom that slide up panels.

| Region | Test hook |
| --- | --- |
| Title | `[data-testid="app-title"]` |
| Controls toggle | `[data-testid="controls-toggle"]`, `data-controls-open` reflects state |
| Reset Board | `[data-testid="reset-board"]` |
| Answers count | `[data-testid="answers-count"]`, `data-answers-count` is the numeric value |
| Controls form (when open) | `[data-testid="controls-panel"]` |
| Stats panel | `[data-testid="stats-panel"]` |
| Board | `[data-testid="board"]` |
| Found Words toggle / panel | `[data-testid="words-list-toggle-foundWords"]` / `[data-testid="words-list-foundWords"]` |
| Answers toggle / panel | `[data-testid="words-list-toggle-answers"]` / `[data-testid="words-list-answers"]` |

---

## Board generation

- The server (`logic/server.ts`) picks letters via `randomBoard(language, size)` from `logic/board.ts`. English vowel/consonant pools are weighted; an "unpopular consonant" (j, k, q, v, x, y, z) is sprinkled in.
- URL params override the default: `?language=`, `?board=`, `?size=`, `?min=`.
- `boardWidth` is sniffed from the User-Agent (`350` on mobile, `400` on desktop) and `cellWidth` is derived from `calculateCellWidth(width, size)`.
- The board is exposed as a `<table data-testid="board">` with `data-board-size` attribute. Each cell is `<button data-testid="cell-{i}" data-cell-index="{i}" data-cell-char="X">` where `i` runs `0..size*size-1` row-major.

**Verify**
- Default board renders a 5×5 grid → 25 cells with testids `cell-0`..`cell-24`.
- `?board=abcdefghijklmnopqrstuvwxy&size=5` produces cells matching that string in order.

---

## Selecting letters

A "path" is the sequence of cells the player has highlighted. The board emits `data-selected-path` on `[data-testid="board"]` so tests can read the current path as a string.

### Mouse

- **Click** a cell to start the path (mousedown is what registers; mouseup ends the drag).
- **Drag** with the mouse held down to extend the path; `onMouseOver` adds each cell entered while `isMouseDown` is true.
- **Click an already-selected cell** to truncate the path back to (but not including) that cell.
- **Click outside the board** clears the path entirely.
- **Press `Backspace` or `Escape`** clears the path.

### Touch

- `onTouchMove` resolves the cell under the finger via `document.elementFromPoint` and reads its `data-cell-index` / `data-cell-char` attributes — that is what makes touch dragging work without needing per-cell touch listeners.

### Adjacency rule

- A new cell is appended only if it is one of the 8 neighbors of the last cell in the path (`updatePath` computes neighbor indices as `idx ± 1`, `idx ± boardSize`, `idx ± boardSize ± 1`).
- Non-adjacent cells are silently ignored — the path does not change and no sound plays.

### Selected-state visuals

- Each selected cell flips its background from `bg-white` to `bg-blue-200`. Tests assert via `data-cell-is-in-path="true"` and `data-cell-bg="bg-blue-200"`.

**Verify**
- Click `cell-0`. The board's `data-selected-path` equals the char at index 0; that cell's `data-cell-is-in-path` is `"true"`.
- Click a non-adjacent cell. Path is unchanged.
- Press `Escape`. Path is empty.

---

## Audio feedback

- Each cell added to the path triggers a Tone.js `MonoSynth` note. Pitch is indexed by path length (`indexToSound[1..29]` ranging B4 → C9).
- Tests should not assert audio is *audible*; they can assert that `[data-selected-path]` grows, which is the same trigger.

---

## Found-word feedback

`handleFoundWord` runs on every change to `selectedChars`. A word counts as "found" when:

1. its concatenated chars (lowercased) appear in `dictionaryState.dictionary`,
2. it has not already been found, and
3. its length ≥ `gameState.minCharLength`.

When all three hold:

- `gameState.isWordFound` becomes `true`. The board carries `data-is-word-found="true"`.
- Selected cells flip from blue to **green** (`bg-green-200`, `data-cell-bg="bg-green-200"`).
- `fireworks()` (canvas-confetti) and `/wow.mp3` play.
- After 300ms the word is pushed onto `answersState.foundWords`, the path is cleared, and `isWordFound` is reset.

**Verify**
- Set `?board=catx...` so `cat` is solvable in a known position, drag through `c→a→t`. `data-is-word-found` flips to `"true"` for ~300ms, then path clears and `cat` appears in the Found Words list.
- Drag the same word a second time. `data-is-word-found` does **not** flip (already found).

---

## Controls panel

Click `Open Controls` to expand `[data-testid="controls-panel"]`. It contains four fields:

| Field | Test hook | Effect |
| --- | --- | --- |
| Language | `[data-testid="language-select"]` | Re-randomizes the board for the chosen language and re-runs the solver. Currently only `English` is rendered as an option even though `Language` enumerates Russian and Spanish — see Known limitations. |
| Word Size | `[data-testid="word-size-input"]` (number input, default 3) | Min characters required for a word to count. Filters Answers count and the words shown in both lists. |
| Board Size | `[data-testid="board-size-input"]` (number input, default 5) | Re-randomizes and resizes the grid. Cells become `cell-0..cell-{size*size-1}`. |
| Customize | `[data-testid="customize-input"]` | Replaces the board chars with the typed string (one char per cell, row-major). Re-runs the solver. |

The panel auto-closes when you click outside it or press `Escape`. The toggle button text flips between `Open Controls` and `Close Controls`; `data-controls-open` carries the same state.

**Verify**
- Open controls, set Word Size to `5`. The Answers count drops to only words ≥5 chars; the foundWords / answers panels reflect the same filter.
- Open controls, fill Customize with 25 chars. Cells render those exact letters in order.
- Press `Escape`. Panel closes.

---

## Reset Board

`[data-testid="reset-board"]` re-rolls the board for the current language and size, clears the answer list, and re-runs the solver. Found-words and level/progress are **not** reset.

**Verify**
- Note the chars at `cell-0`..`cell-24`. Click Reset. At least some chars change (random — re-run if it happens to roll the same board).

---

## Answers count

`[data-testid="answers-count"]` shows `Answers: N` where `N` counts solver-found words ≥ current minCharLength. Empty string when 0. The numeric value is also exposed via `data-answers-count` on the same element so tests don't have to parse text.

---

## Level and progress

| Hook | Meaning |
| --- | --- |
| `[data-testid="stats-panel"]` | Carries `data-current-level`, `data-found-count`, `data-answers-count`, `data-progress-percent`. |
| `[data-testid="level-display"]` | Text `Level: N`. |
| `[data-testid="level-progress"]` | The stepped bar; `data-step-size` = current level's step count, `data-words-until-next` = remaining words for next level. |
| `[data-testid="progress-text"]` | `found / total - p%`. |
| `[data-testid="progress-bar-fill"]` | The blue fill; width set inline as `{percent}%`. |

**Mechanics** (from `BoggleRoot.tsx`'s `useTask$` watching `foundWords`):
- Initial state: `currentLevel=1`, `wordsUntilNextLevel=1`, `levelStepSize=1`.
- Each new found word decrements `wordsUntilNextLevel` by 1.
- When `wordsUntilNextLevel === 0`, the level increments and both `wordsUntilNextLevel` and `levelStepSize` are reset to the new `currentLevel`. So leveling cost grows linearly: 1, 2, 3, 4… words per level.

**Verify**
- Find one word from level 1 → level becomes 2, step size becomes 2.
- Find two more words → level becomes 3, step size 3.

---

## Word lists (Found Words / Answers)

Two slide-up panels at the bottom:

- `[data-testid="words-list-toggle-foundWords"]` and `[data-testid="words-list-toggle-answers"]` toggle them.
- Open state is reflected on the toggle as `data-open="true"`.
- Open panel → `[data-testid="words-list-{variant}"]` becomes 400px tall and contains either `[data-testid="words-list-items-{variant}"]` (a `<ul>` of `[data-testid="word-{variant}"]` `<li>`s with the word in `data-word`) or a `[data-testid="words-list-empty-{variant}"]` "No data" placeholder.
- Filtering by `minCharLength` is applied to both lists.
- Pressing `Escape` or clicking outside closes whichever is open.

**Verify**
- Open Answers. The number of `[data-testid="word-answers"]` elements matches `[data-testid="answers-count"]` value (when minCharLength is the same).
- Open Found Words on a fresh board. Shows `No data` placeholder.

---

## Keyboard shortcuts

| Key | Effect |
| --- | --- |
| `Backspace` or `Escape` | Clear current path. |
| `Escape` | Also closes the controls panel and any open word list. |
| `Enter` / `Space` while a cell button is focused | Same as clicking that cell (`onKeyDown` calls `handleClick`). |

---

## Smart Mode (intelligent board generation)

Smart Mode is **on by default**. The toggle lives in the Controls panel under the existing layout fields.

| Surface | Test hook |
| --- | --- |
| Smart Mode toggle | `[data-testid="smart-mode-toggle"]` (`data-smart-enabled`, `data-smart-model-status`, `data-slm-tier`) |
| Tier hint (idle) | `[data-testid="smart-mode-tier-hint"]` |
| Tier info (loaded) | `[data-testid="smart-mode-tier-info"]` |
| SLM model picker | `[data-testid="slm-picker"]` (`data-current` reflects the chosen tier) |
| Min Words input | `[data-testid="min-words-input"]` |
| Banner status (loading / generating) | `[data-testid="smart-banner-status"]` |
| Banner narration log | `[data-testid="smart-banner-narration"]` with `[data-testid="narration-line"]` items |
| Live token stream | `[data-testid="live-tokens"]` |
| Search progress | `[data-testid="search-progress"]` |
| Floor-missed warning | `[data-testid="smart-banner-floor-warning"]` |
| Result block | `[data-testid="smart-banner-explanation"]` with `[data-testid="smart-banner-explanation-text"]` |
| Dismiss × | `[data-testid="smart-banner-dismiss"]` |

**How a Smart reset feels:**

1. Reset Board click. Toggle reads `✨ Smart Mode: ON · <model name>` if the model is already loaded; otherwise it loads on first click (~110–786 MB depending on tier; cached after first session per origin).
2. Banner shows narration log: 🤔 → 💡 → 🔍 → 📊 → 💬 → ✅, with token stream beneath and a candidate-progress bar.
3. On completion: banner shows score / strategy / model calls / elapsed / "best of K" / actual word count, plus the SLM's no-spoiler explanation. Dismiss × hides it.
4. If the **Min Words** floor wasn't met after all attempts, a yellow warning appears above the explanation: *"Couldn't reach Min Words target of N after K attempts. Best result: M."*

**Model picker:** dropdown with five options — `Auto (User-Agent)`, `Cloudflare Server` (server-side, ~0 MB on-device), `SmolLM2-135M` (~110 MB), `SmolLM2-360M` (~220 MB), `Qwen2.5-0.5B` (~786 MB), `Llama-3.2-1B` (~1100 MB). Choice persists in `localStorage["word-finder.slm-id"]`. Auto routes iOS UAs to the server tier; modern mobile to SmolLM2-360M; desktop to Qwen2.5-0.5B.

**Min Words:** number input. Smart Mode retries the search up to 5× to satisfy this floor. Search budget scales: <150 → 200 cands × 3 attempts; ≥150 → 300 × 3; ≥200 → 400 × 5; ≥250 → 600 × 5.

**Random sampling ceiling:** ~320–350 player-relevant words on a 5×5. Hill-climbing search (not yet shipped) pushes that to ~500.

## Board Builder side panel

Power-user surface. A vertical "🛠 Board Builder" tab on the right edge opens a slide-in panel.

| Surface | Test hook |
| --- | --- |
| Toggle (right edge) | `[data-testid="board-builder-toggle"]` |
| Panel | `[data-testid="board-builder-panel"]` (`data-open="true"` when shown) |
| Close | `[data-testid="board-builder-close"]` |
| "no model loaded" warning | `[data-testid="board-builder-no-model"]` |
| Guidance prompt | `[data-testid="board-builder-prompt"]` (textarea) |
| Run buttons | `[data-testid="board-builder-run-1"]` / `…-5` / `…-10` / `…-25` |
| Cancel | `[data-testid="board-builder-cancel"]` |
| Progress | `[data-testid="board-builder-progress"]` |
| Aggregate stats | `[data-testid="board-builder-batch-stats"]` |
| Results table | `[data-testid="board-builder-results"]` with `[data-testid="board-builder-result-row"]` items |
| Load row into game | `[data-testid="board-builder-result-load"]` (↩) |
| Save row to favorites | `[data-testid="board-builder-result-save"]` (☆) |
| Saved-empty placeholder | `[data-testid="board-builder-saved-empty"]` |
| Saved list | `[data-testid="board-builder-saved-list"]` with `[data-testid="board-builder-saved-item"]` items |

**How it works:**

1. Type a free-form prompt (e.g. *"lots of long words ending in -ing"*). Persists in `localStorage["word-finder.builder.prompt"]`.
2. Click 1× / 5× / 10× / 25× to run the orchestrator that many times sequentially. Each result is a row in the table.
3. The prompt threads into `goal.description` and is visible to both the strategy router and the explanation step. Each run uses `maxAttempts: 1` so the table reflects the natural distribution.
4. Click ↩ to load a row's board into the game (worker re-solves so the answers panel updates). Click ☆ to save it to favorites (`localStorage["word-finder.builder.saved"]`).
5. Saved boards persist across sessions; per-row note is editable.

## Version surface

Every deployed page exposes the build version via five surfaces:

- Footer (bottom-right): `[data-testid="version-footer"]` reads `v<sha> · <date>Z` with `data-version-sha`, `data-version-branch`, `data-version-build-time` attributes.
- `<meta name="x-app-version">`, `<meta name="x-app-branch">`, `<meta name="x-app-build-time">`.
- `window.__APP_VERSION__` JS global.
- `localStorage["word-finder.version"]` JSON.
- DevTools console banner on hydration: `[word-finder] v<sha> · <branch> · built <iso>`.

## Known limitations (so tests don't fight them)

- The Language `<select>` only renders the `English` option even though `Language` includes Russian and Spanish. Tests should not assume a multi-option dropdown.
- `Spanish` falls through to the English vowel/consonant pool inside `randomBoard`.
- The Rust/WASM solver is built but **not** wired up at runtime — the JS solver in `logic/boggle.ts` is what actually runs in the worker. Don't assert against `boggle-solver/pkg`.
- `console.log('percentage', percentage)` fires in `UserGameStats` on every render. Don't fail the suite on noisy console output.
