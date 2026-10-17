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

## Workflow

- When a feature or decision changes, update the relevant section of docs/brief.md and add a dated row to its Feature log, in the same commit as the code.
- Domain logic (import parsing, duplicate detection, transfer matching, balances, budgets) must have unit tests. UI tests are optional.- Commit after each working, tested step, using Conventional Commits prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Never add a `Co-Authored-By` trailer to commit messages. Never push without asking.
