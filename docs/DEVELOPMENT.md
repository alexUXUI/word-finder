# Development Workflow

Everything you need to ship a feature: dev loop, branch model, CI/CD, hosting, and the automation tooling we use to move fast.

## TL;DR

```sh
yarn install                 # one-time
yarn playwright install      # one-time, for e2e
yarn dev                     # local dev (rebuilds wasm, then vite)
git checkout -b feat/xyz     # branch off main
# … edit, test, commit …
git push -u origin feat/xyz  # → Cloudflare auto-builds a preview
gh pr create                 # open PR; preview URL shows up in PR comments
# review, merge → Cloudflare auto-deploys to production
```

## Repository

- **GitHub**: https://github.com/alexUXUI/word-finder
- **Production branch**: `main`
- **Old repo (`alexUXUI/boggle`)**: archived in spirit. Local remote is preserved as `origin-old` if you ever need history.

## Local dev

| Command | What it does |
| --- | --- |
| `yarn dev` | Rebuilds the Rust/WASM solver, then starts Vite SSR on `:5173`. Run this when Rust sources change. |
| `yarn start` | Vite SSR only — no wasm rebuild. Faster reload during pure JS/TS work. |
| `yarn build` | Full Qwik production build (client + SSR + `tsc --noEmit`). What Cloudflare Pages runs. |
| `yarn preview` | Production build + local preview server. |

**Qwik HMR gotcha**: if the dev page renders an `Invoking 'use*()' method outside of invocation context` overlay after editing, Qwik's HMR cache is stuck. Kill `yarn dev`, `rm -rf .cache node_modules/.vite tsconfig.tsbuildinfo`, restart. Doesn't repro often.

## Branch model

- `main` is the production branch — every commit there deploys to `word-finder-eak.pages.dev`.
- Feature branches (anything else) get a Cloudflare Pages **preview deployment** automatically on push.
- Preview URLs are deterministic: `<deployment-id>.word-finder-eak.pages.dev` per build, plus a per-branch alias.
- PRs against `main` get a Cloudflare Pages bot comment with the preview URL once the build finishes.

## Testing

Two layers, full coverage in [`TESTING.md`](./TESTING.md).

```sh
yarn test            # unit + e2e
yarn test.unit       # vitest run
yarn test.unit.watch # vitest in watch mode
yarn test.e2e        # playwright across desktop + mobile chromium
yarn test.e2e.ui     # interactive ui mode
yarn test.e2e.update-snapshots  # rebaseline visual diffs
```

Always run `yarn test.unit` before pushing. The unit suite is fast (~700ms) and pins the game's algorithmic contracts.

## CI/CD on Cloudflare Pages

### Build environment

The `cloudflare-pages` build image is sensitive to versioning. We pin both:

| Pin | Where | Why |
| --- | --- | --- |
| Node `20` | `.node-version` and `NODE_VERSION` env var | Pages dropped Node 16 from the image; 20 matches local. |
| Yarn `1.22.22` | `package.json` `packageManager` field | Pages defaults to Yarn 4, which refuses to install with our Yarn-1-format `yarn.lock`. |

Don't change either without testing in a feature branch first.

### Project config

| Setting | Value |
| --- | --- |
| Account | `Alexbcloud3@gmail.com's Account` (`f8f818fca34393c451967359eeb2e578`) |
| Project | `word-finder` |
| Build command | `yarn build` |
| Output directory | `dist` |
| Root directory | `/` |
| Production branch | `main` |
| Preview deployments | All non-Production branches |
| PR comments | Enabled |

The Cloudflare Pages GitHub App on `alexUXUI` needs repo access to `word-finder` for webhooks to fire — verify at https://github.com/settings/installations.

### Pulling build status from the API

The Cloudflare MCP gives us read access to deployments. Examples used in this project:

```ts
// List recent deployments and their stages
GET /accounts/{accountId}/pages/projects/word-finder/deployments

// Get failed-build logs
GET /accounts/{accountId}/pages/projects/word-finder/deployments/{id}/history/logs
```

If a build hangs / fails, check the logs first via MCP before guessing. Common failure modes we've already hit:
- Yarn 4 vs Yarn 1 lockfile mismatch — fixed by `packageManager` pin.
- Node 16 EOL in the build image — fixed by `.node-version=20`.

### Triggering a build manually

A push is the only way to trigger a Git-based build. If a webhook didn't fire (e.g. just after wiring up a new repo), an empty commit kicks one off:

```sh
git commit --allow-empty -m "trigger build"
git push
```

## Hosting

- **Production**: https://word-finder-eak.pages.dev (alias `word-finder.pages.dev` if claimed)
- **Per-deployment preview**: `https://<deployment-id-prefix>.word-finder-eak.pages.dev`
- **Per-branch alias**: `https://<branch-slug>.word-finder-eak.pages.dev`
- **Cloudflare dashboard**: https://dash.cloudflare.com/?to=/:account/pages/view/word-finder

## MCP tools wired into Claude Code

All registered at user scope (`~/.claude.json`), available across every project on this machine.

| MCP | URL | What it does |
| --- | --- | --- |
| **Cloudflare** (Code Mode / catch-all) | `https://mcp.cloudflare.com/mcp` | 2,500+ Cloudflare API endpoints via code execution. Pages project / deployment management, build logs, env vars. Tools: `mcp__cloudflare__execute`, `mcp__cloudflare__search`. |
| **Cloudflare Docs** | `https://docs.mcp.cloudflare.com/mcp` | Up-to-date reference info for Workers, Pages, KV, D1, R2, AI, etc. Use when designing infra. |
| **Cloudflare Workers Builds** | `https://builds.mcp.cloudflare.com/mcp` | Purpose-built for build/deployment monitoring. Cleaner than rolling our own API calls for build status. |
| **Cloudflare Observability** | `https://observability.mcp.cloudflare.com/mcp` | Logs, analytics, error tracking on the deployed site. |
| **GitHub** | `https://api.githubcopilot.com/mcp/` | Official GitHub remote MCP — PRs, issues, workflow runs, branches, releases. Tools: `mcp__github__*`. First call prompts for a PAT. |
| **Playwright** | (built-in to Claude Code) | Drives a real browser for verifying UI changes against `:5173` or deployed Pages URLs. Tools: `mcp__playwright__*`. |

The full list of Cloudflare's domain-specific MCPs (Browser Rendering, Radar, AI Gateway, etc.) lives in the [`cloudflare/mcp-server-cloudflare`](https://github.com/cloudflare/mcp-server-cloudflare) repo. Add any of them with the same `claude mcp add` pattern — they all OAuth on first use against this Cloudflare account.

### Adding / removing MCPs

```sh
claude mcp add <name> --transport http <url> -s user   # register
claude mcp list                                         # inspect
claude mcp remove <name> -s user                        # unregister
```

`-s user` makes it available everywhere on this machine. Use `-s project` (writes a `.mcp.json` to the repo root) only when collaborators need the same MCP and are okay each using their own auth.

## Agent Skills

Skills are markdown prompts that Claude auto-loads when a conversation matches their triggers, plus user-invocable `/<skill>` commands. Installed globally via [`npx skills`](https://skills.sh) into `~/.claude/skills/`:

| Skill | When it auto-loads / What it does |
| --- | --- |
| `cloudflare` | Anything Workers / Pages / KV / D1 / R2 / Workers AI / networking / WAF / Terraform / Pulumi. |
| `agents-sdk` | Building stateful AI agents — state, scheduling, RPC, MCP servers, email, streaming chat. |
| `durable-objects` | Stateful coordination patterns (chat rooms, games, booking), RPC, SQLite, alarms, WebSockets. |
| `sandbox-sdk` | Secure code execution / interpreters / interactive dev environments. |
| `wrangler` | Wrangler CLI patterns (deploy, dev, secrets, tail). |
| `workers-best-practices` | Performance / cost / DX patterns for Workers. |
| `web-perf` | Web performance triage. |
| `cloudflare-email-service` | Cloudflare Email Routing / Workers email. |

Plus user-invocable commands provided by the `cloudflare` skill:

```
/cloudflare:build-agent   # bootstrap an Agents-SDK app
/cloudflare:build-mcp     # bootstrap a remote MCP server
```

Update / re-install:

```sh
npx skills update -g            # update all globally-installed skills
npx skills add <repo-url> -g    # add another skill source
npx skills list                 # see what's installed
```

## Iteration playbook

The combination of unit tests + e2e + Cloudflare previews + the MCP surface means we can move quickly:

1. **Branch and edit.** Run `yarn dev`. Use Playwright MCP to drive the local app and verify behavior, including grabbing screenshots.
2. **Run unit tests on every algorithm change.** They're under a second; no excuse not to.
3. **Run the full e2e + visual suite before pushing UI changes.** `yarn test.e2e.update-snapshots` if visuals legitimately changed.
4. **Push.** Cloudflare auto-builds a preview. Inspect via MCP if anything looks off — `mcp__cloudflare__execute` can pull deployment status and build logs without leaving the CLI.
5. **Open the PR via `gh`** (or via `mcp__github__*` once that's authorized). The Cloudflare bot will comment the preview URL.
6. **Merge to main.** Production deploys automatically.

## Known follow-ups (non-blocking)

- `/service-worker.js` 404 in the deployed site console: `src/routes/service-worker.ts` exists but the static generator isn't emitting it. App functions without it.
- Pre-existing `tsc --noEmit` error: `src/components/boggle/models.ts:43` has a hardcoded absolute path (`/Users/alexbennett/Desktop/personal/...`) for a type-only import. Needs to be made relative.
- `pnpm-lock.yaml` lingering in the repo from a previous experiment — we use yarn; safe to delete.
- `boggle-solver/pkg/*` files often dirty in working tree because `yarn dev` rebuilds wasm. Either commit them after intentional Rust changes or git-ignore the pkg outputs.
