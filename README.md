# Bean Counter

A personal web app for tracking cashflow across all your bank accounts in one place. You import the statements your banks already export (CSV or Excel). The app categorizes the transactions, recognizes transfers between your own accounts, and shows where your money comes from, where it goes, and how your total balance changes over time.

It's for one person on one computer: it runs only on `127.0.0.1`, has no login, and keeps everything in a single SQLite file. Amounts in different currencies are never added together or converted.

What it does, and why, is in the [project brief](docs/brief.md). The screens and user flows are in the [plan](docs/plan.md).

## Requirements

- Node.js 22.12 or later.
- pnpm 11. With Corepack (`corepack enable`), the version in `package.json` is picked up on its own.

## Getting started

```sh
pnpm install
pnpm start
```

`pnpm start` builds the app and serves it at http://127.0.0.1:4280. The first time, the dashboard asks you to add an account and import a statement.

To work on the app, run `pnpm dev` instead and open http://127.0.0.1:4281. The page reloads when the UI changes, and the server restarts when its code changes.

## Your data

Everything lives in `data/bean-counter.db`, created on the first run. The `data/` folder is never committed.

- **Back up:** in the app, Settings → Backup & restore → Download backup. You get one `.db` file with all your accounts, transactions, categories, rules, budgets, presets and settings.
- **Restore:** in the same place, Restore from file…. It replaces all current data, so it asks first and offers to download a backup of the current data.
- **Another file:** `BEAN_COUNTER_DB=/path/to/other.db pnpm start` uses a different database. `PORT` changes the port.

If you copy `data/bean-counter.db` yourself, stop the app first: while it runs, recent changes may still be in the files next to it.

## Tests and checks

| Command | What it does |
|---|---|
| `pnpm test` | Unit and server tests (Vitest). `pnpm test:watch` reruns them on change. |
| `pnpm test:coverage` | The same, with a coverage report in `coverage/index.html`. |
| `pnpm e2e` | End-to-end tests (Playwright): every user flow in the plan, in a desktop and a phone-sized browser. |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Code checks. `pnpm format` fixes the formatting. |

The end-to-end tests build the app and run it on port 4290 with a throwaway database, so they never touch your data. `E2E_PORT` picks another port, for example to run them next to `pnpm e2e --ui`. On a new machine, install their browser once with `pnpm exec playwright install chromium`.

## How it's built

TypeScript throughout, in one Node process:

- `src/web/`: the UI, with React and Vite.
- `src/server/`: the JSON API, with Fastify, and the SQLite database through better-sqlite3 and Drizzle.
- `src/domain/`: the rules (balances, duplicates, transfers, budgets, reports) as plain functions, tested on their own.
- `e2e/`: the end-to-end tests and their sample statements.
- `docs/`: the brief, the plan, the wireframes and the design.

[CLAUDE.md](CLAUDE.md) has the conventions and domain rules used when working on the code.
