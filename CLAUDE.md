# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bean Counter is a single-user web app, reachable only on localhost, that tracks cashflow across my bank accounts using CSV/Excel statements I import. The spec is [docs/brief.md](docs/brief.md). Read it before working on a feature.

## Stack

TypeScript everywhere: one Node process, with the data in one SQLite file. Approved on 2026-10-19.

- **UI** (`src/web/`): React and Vite. React Router and TanStack Query come with the app shell. Styling is plain CSS on `docs/design/tokens.css`, imported from there and never copied. Components are ported from `docs/design/screens/components.css`, without the viewer chrome. No Tailwind or UI kit. Charts are our own SVG components.
- **Server** (`src/server/`): Fastify, listening on 127.0.0.1 only. It serves the JSON API under `/api` and, after a build, the UI.
- **Database**: SQLite through better-sqlite3, with Drizzle for the schema and migrations. The file lives in `data/` (gitignored). Backup and restore work on a copy of that file.
- **Domain logic** (`src/domain/`): plain functions that never import the database, the server or React, so they can be unit tested directly.
- **Import**: Papa Parse for CSV, ExcelJS for .xlsx. The old .xls format isn't supported.
- **Money**: integer minor units (cents) plus a currency code. Parse text straight to cents, never through `parseFloat`.
- **Tests**: Vitest, with `*.test.ts` files next to the code they test. Coverage comes from `@vitest/coverage-v8` and measures `src/domain` and `src/server` only.
- **End-to-end tests**: Playwright, in `e2e/`, against the built app in a desktop and a mobile size. One spec per user flow in docs/plan.md §6.
- **TypeScript 6.0, not 7**: typescript-eslint doesn't support 7 yet.
- **React Router 7, not 8**: 8 needs Node 22.22 or later.
- Add a dependency only when a feature needs it.

## Commands

- Install: `pnpm install`.
- Develop: `pnpm dev`, then open http://127.0.0.1:4281. Vite reloads the UI on change and forwards `/api` to the server on port 4280, which restarts on change.
- Use: `pnpm start` builds the UI and serves the whole app at http://127.0.0.1:4280.
- Test: `pnpm test` (or `pnpm test:watch`). One file: `pnpm test src/server/app.test.ts`. One test by name: `pnpm test -t "SQLite version"`.
- Coverage: `pnpm test:coverage` prints a summary and writes the full report to `coverage/index.html`. It fails if `src/domain` drops below its minimum, set in `vite.config.ts`.
- End-to-end: `pnpm e2e` builds the app and runs it on port 4290 with a throwaway database, never the one in `data/`. Each test starts from a state saved by `e2e/states.setup.ts` (see `e2e/states.ts`). One file: `pnpm e2e e2e/first-run.spec.ts`. After a failure, `pnpm exec playwright show-trace` opens the trace it names.
- Check: `pnpm lint`, `pnpm typecheck`, `pnpm format:check` (`pnpm format` fixes formatting).
- The database is `data/bean-counter.db`. `BEAN_COUNTER_DB` points the server at another file; tests use `:memory:`. `PORT` changes the server's port; the Vite proxy in `vite.config.ts` must match it.
- After changing `src/server/db/schema.ts`, `pnpm db:generate` writes a migration to `src/server/db/migrations/`. Migrations run on their own when the server opens the database.
- A new package with an install script needs `pnpm approve-builds <name>`, which records it in `pnpm-workspace.yaml`.

## Domain rules

These are easy to get wrong. The brief has the details.

- Store and compute money as exact values (integer cents or a decimal type), never floats.
- Never add amounts in different currencies together. There are no exchange rates and no conversion: totals, reports and budgets are all per currency.
- A linked transfer, including a currency exchange, changes both account balances but never counts as income, expense or category spending.
- Each account's balances come from a single balance anchor. The opening balance is calculated backwards from it, never entered.
- Duplicate fingerprints use a transaction's values as originally imported, not as later edited. Identical transactions in one file are all kept (detection respects counts).
- Auto-link a transfer only when exactly one same-currency candidate falls inside the transfer window. Cross-currency pairs always need the user's confirmation.
- A balance mismatch can only be located between the last day the balances match and the first day they don't (the bank reports balances only on days with rows). Never report a more precise date than the data supports.
- An excluded transaction is ignored by balances, reports and budgets, but it still counts for duplicate detection, so a re-import doesn't bring it back.
- When the rules that match a transaction give different categories, never pick one: send the transaction to Review. Rules that match and agree on the category aren't a conflict.
- A dismissed suggestion ("Not a transfer", "It's income") is remembered and never suggested again; manual linking stays possible.
- A budget's running balance adds each month's limit in force and subtracts that month's spending, from the start month (or the last start-over). The first month counts in full, even if the budget was created mid-month.
- A payback linked to an expense isn't income: it reduces the expense's category in the expense's month. The paybacks linked to an expense never add up to more than it; the unlinked part of a payment counts normally.
- In reports, transactions waiting in Review count under "Uncategorized", except possible transfers (with their candidate matches) and possible paybacks, which are left out until linked or dismissed.

## Wireframes

Design work happens here, not in Figma.

- Wireframes live in `docs/wireframes/`: one self-contained HTML file per flow, plus `index.html` linking them all.
- Each file uses inline CSS plus the shared `components.css`. No frameworks, no build step, nothing loaded from the internet.
- Shared UI pieces (sidebar, step indicator, buttons, dropdowns, tags) are defined once in `docs/wireframes/components.css` and reused.
- Low-fidelity gray style, system font, realistic fake data.
- Wireframes are for design only and are never reused as app code.

## Design tokens

- Tokens live in `docs/design/tokens.css`, previewed in `docs/design/tokens.html`. Unlike the wireframes, the app reuses `tokens.css`.
- High-fidelity screens and the app use only the meaning tokens (`--color-*`, `--chart-*`, `--type-*`, `--space-*`, …), never the raw palette and never hard-coded colours or sizes.
- Light and dark themes follow the system setting. Every colour change keeps text at 4.5:1 or more against its background, and borders, icons, bars and chart colours at 3:1 or more, in both themes.
- Amounts: income is green, expenses use the normal text colour, transfers and paybacks are muted. Red is only for problems (over budget, errors, deletes).
- Charts give their own colour to at most 6 categories; the rest are grouped under Other, in gray.

## High-fidelity screens

- They live in `docs/design/screens/`: one HTML file per group of screens, plus `index.html` that tracks what's done. Each file loads only `../tokens.css` and the shared `components.css`; nothing is loaded from the internet.
- They follow `docs/plan.md` and the approved wireframes, with the same example data. If a screen should differ from the plan, ask first, then update the plan in the same commit.
- Every screen has a desktop (1440 × 1024) and a mobile (390 × 844) frame. On mobile, every dialog is a full-screen sheet. Check both themes with the viewer's Light/Dark switch before committing.
- Like the wireframes, they are design reference. The app ports their components into its own CSS (see **Stack**) and never loads `components.css`.

## Workflow

- When a feature or decision changes, update the relevant section of docs/brief.md and add a dated row to its Feature log, in the same commit as the code.
- Domain logic (import parsing, duplicate detection, transfer matching, balances, budgets) must have unit tests. UI tests are optional.
- Commit after each working, tested step, using Conventional Commits prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Never add a `Co-Authored-By` trailer to commit messages. Never push without asking.
