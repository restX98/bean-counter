# Bean Counter

A self-hosted personal wallet. It consolidates money across bank accounts, imports statements, and
categorizes spending automatically — on your own machine, with no cloud account and no container.

## Status

Scaffold. The backend serves `GET /api/health`, the frontend renders a placeholder page, and that
is all: there is no import, no ledger and no interface yet.

[docs/PRD.md](docs/PRD.md) is what this is being built towards.
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is how.

## Requirements

- **Python 3.12+** and [uv](https://docs.astral.sh/uv/)
- **Node 22** — `frontend/.nvmrc` pins the exact version — and **pnpm 11**

## Getting started

```sh
pnpm run bootstrap    # install both projects' dependencies
pnpm run dev          # start both servers
```

Then open **http://localhost:5173**. Vite serves the app there and forwards `/api` to the backend
on port 8000, so that is the only port you need. Both halves reload on save.

## Commands

Every command runs from the repository root — you never need to change directory.

| Command | Runs |
| --- | --- |
| `pnpm run dev` | both dev servers |
| `pnpm run dev:backend` · `pnpm run dev:frontend` | one of them alone |
| `pnpm run test` | both test suites |
| `pnpm run test:backend` · `pnpm run test:frontend` | one of them alone |
| `pnpm run lint` · `pnpm run typecheck` · `pnpm run build` | frontend only |
| `pnpm run check` | lint, typecheck, both test suites and the build |
| `pnpm run bootstrap` | install dependencies for both |

Use `pnpm run <name>` rather than the `pnpm <name>` shorthand: the shorthand silently defers to
pnpm's own commands when a name collides with one.

`pnpm run check` runs the same lint, typecheck, tests and build that CI does. CI installs
differently, though: `uv sync --locked` and `pnpm install --frozen-lockfile` fail outright if a
lockfile has drifted from its manifest, where installing locally would simply resolve the
difference. That is the one way a green `check` can still meet a red run.

## Layout

`backend/` and `frontend/` are two self-contained projects. Each owns its manifest, its lockfile
and its installed dependencies, and neither builds anything the other consumes — they meet over
HTTP. The `package.json` at the root is a command index only: it has no dependencies and nothing is
installed against it.

See [ARCHITECTURE §2](docs/ARCHITECTURE.md) for the full tree.

## Your data stays on your machine

Statements (`data/`), the ledger itself (`bean.db`), snapshots (`backups/`) and your configuration
(`.env`, and the `.env.*` variants) are gitignored and must never be committed. The `.gitignore` is
the only thing standing in the way, so check `git status` before you stage: a file that is already
tracked stays tracked whatever the ignore rules later say.

The documents in `docs/` are written to the same rule: they describe formats and behaviour, never
real amounts, balances, account identifiers or payee names.

## Attribution

Written with [Claude Code](https://claude.com/claude-code).
