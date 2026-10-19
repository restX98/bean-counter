# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bean Counter is a single-user web app, reachable only on localhost, that tracks cashflow across my bank accounts using CSV/Excel statements I import. The spec is [docs/brief.md](docs/brief.md). Read it before working on a feature.

## Status

There's no code yet and no tech stack has been chosen. If you're asked to write code before a stack exists, propose one with its trade-offs and wait for approval. Don't scaffold anything or add dependencies first. Once a stack is approved, fill in **Commands** below.

## Commands

_To be added once the stack is chosen: run, test, run a single test, lint._

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
- When more than one rule matches a transaction, never pick one: send the transaction to Review.
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
- Like the wireframes, they are design reference. Whether the app reuses `components.css` is decided with the stack.

## Workflow

- When a feature or decision changes, update the relevant section of docs/brief.md and add a dated row to its Feature log, in the same commit as the code.
- Domain logic (import parsing, duplicate detection, transfer matching, balances, budgets) must have unit tests. UI tests are optional.
- Commit after each working, tested step, using Conventional Commits prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Never add a `Co-Authored-By` trailer to commit messages. Never push without asking.
