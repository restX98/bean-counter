# Bean Counter — Screens & Flows

_Status: draft · Last updated: 2026-10-17 · Source: [brief.md](brief.md)_

These are the screens to design in Figma and the flows that connect them. Each entry covers what a screen shows and lets me do, not how it's built.

## 1. Scope & assumptions

- **Home** is a Dashboard.
- **First run** has no setup wizard. Empty screens explain the next step instead.
- **Review inbox**: one screen gathers everything waiting for my decision. During an import, the same items can be settled right away for that file.
- **Frames**: every screen and dialog gets a desktop frame (1440 px wide) and a mobile frame (390 px wide).
- **Language**: English.
- **Money**: amounts are always shown in their own currency and never converted. Screens that show totals have a currency switcher, with EUR first.

## 2. Feature map

| Brief feature | Screens & dialogs |
|---|---|
| 5.1 Accounts | S3, S4, D1, D2, D3 |
| 5.2 Import | S7, S8, S9, S10, S18 (presets) |
| 5.3 Categorization | S2, S6, S9, S16, S17, D5, D6 |
| 5.4 Transfer detection | S2, S6, S9, D4, S18 (window) |
| 5.5 Reports | S1, S11, S12, S13 |
| 5.6 Budgets | S1, S14, S15, D7 |
| 5.7 Multiple currencies | S3 (grouped by currency), currency switcher on S1 and S11–S14, D4 |
| 5.8 Backup & restore | S18, D8 |
| 5.9 Dashboard & Review | S1, S2 |

## 3. Navigation

**Desktop**: a left sidebar.

- **Import** (primary button)
- Dashboard
- Review (badge with the number of open items)
- Accounts
- Transactions
- Reports: Balance over time · Monthly in vs out · Spending by category
- Budgets
- Categories
- Rules
- Settings

**Mobile**: a bottom tab bar with Home · Transactions · Reports · Budgets · More.

- More lists Accounts, Review (with badge), Categories, Rules and Settings.
- Import is a button in the header of Home and Account detail.
- The review count also appears on Home, so pending items are visible without opening More.

## 4. Screens

### Overview

#### S1 Dashboard

- **Purpose**: shows at a glance where I stand. It's the home screen.
- **Shows**:
  - total balance in the selected currency, plus each account's balance;
  - this month's income, expenses and net cashflow;
  - budgets at a glance, over-budget ones first;
  - "N items to review".
- **Actions**: switch currency, Import, or open an account, the monthly report, a budget or Review.
- **States**:
  - no accounts (empty state → Add account);
  - accounts but no transactions (→ Import);
  - normal;
  - nothing to review (the review card is hidden).
- **Mobile**: the same cards, stacked in the same order.

#### S2 Review inbox

- **Purpose**: one place for everything the app can't decide on its own.
- **Shows**: three groups, each with a count.
  - **Uncategorized**: date, account, description and amount, with an inline category picker.
  - **Transfers to confirm**: same-currency transactions with more than one possible match (pick one), and cross-currency suggestions (link, or mark as not a transfer).
  - **Balance mismatches**: account, computed vs. bank balance, the difference and the date where they diverge.
- **Actions**:
  - categorize a transaction, with a shortcut to create a rule (D6);
  - link or dismiss a transfer;
  - open a mismatch in S4.
- **States**: all caught up, or normal.
- **Mobile**: groups are collapsible sections, and each item is a card.

### Accounts & transactions

#### S3 Accounts list

- **Purpose**: every account and its balance.
- **Shows**: accounts grouped by currency, each with name, bank, type and balance, plus a total for each currency group.
- **Actions**: add an account (D1), open one (S4), show archived accounts.
- **States**: no accounts, or with archived accounts shown.

#### S4 Account detail

- **Purpose**: one account's balance and history.
- **Shows**:
  - current balance;
  - balance anchor: its value and date, and whether it came from a file or was entered by hand;
  - a mismatch banner when the computed balance disagrees with the bank's;
  - the account's transactions: date, description, category or transfer badge, amount, running balance.
- **Actions**:
  - Import into this account (S7, account preselected);
  - edit (D1), set balance (D2) or archive (D3);
  - open a transaction (S6).
- **States**:
  - no transactions;
  - mismatch warning, which jumps to the date where the balances diverge;
  - archived (read-only, with Unarchive).

#### S5 Transactions

- **Purpose**: search and filter transactions across all accounts.
- **Shows**: date, account, description, category (or transfer badge), and amount in the account's currency.
- **Filters**: account, period, category, type (income / expense / transfer / uncategorized), text search.
- **Actions**: open a transaction (S6).
- **States**: no transactions yet, or no results for the current filters.
- **Mobile**: rows grouped by day. The filters open in a sheet.

#### S6 Transaction detail

- **Purpose**: inspect and fix one transaction.
- **Shows**:
  - account, date and amount;
  - the description as imported and as edited;
  - the category;
  - a transfer section: the linked counterpart, or "not linked".
- **Actions**:
  - edit the description;
  - set the category;
  - create a rule from this transaction (D6, prefilled);
  - link a transfer (D4), or unlink one.
- **States**:
  - categorized;
  - uncategorized;
  - linked transfer (the category is hidden; shows the counterpart's account and amount instead).
- **Desktop**: a side panel over S2, S4 or S5. **Mobile**: full screen.

### Import

The import is a four-step wizard. S8 is skipped when the bank already has a saved preset.

#### S7 Import · Choose file

- **Shows**:
  - an account picker;
  - a drop zone or file picker for CSV or Excel;
  - once a file is chosen, the detected bank preset, or "new format".
- **Actions**: continue, or change the account.
- **States**:
  - no accounts yet (→ D1);
  - unreadable or unsupported file.

#### S8 Import · Map columns

- **Purpose**: teach the app a bank's export format, once per bank.
- **Shows**:
  - the first rows of the file;
  - for each column, a choice of what it holds: date, amount, debit, credit, description, balance, bank reference or ignore;
  - date format and decimal separator;
  - a live preview of how the rows will be read.
- **Actions**: save as the preset for this bank and continue.
- **States**:
  - mapping incomplete (Continue is disabled and the missing fields are named);
  - valid.
- Also opened from S18 to edit a saved preset.
- **Mobile**: one card per column, top to bottom.

#### S9 Import · Preview & resolve

- **Purpose**: see what will be imported and settle anything that needs a decision before saving.
- **Shows**: summary counts and every row, tagged as one of:
  - new, auto-categorized or uncategorized;
  - duplicate (will be skipped);
  - near-match (keep or skip; must be decided);
  - transfer linked, or transfer to pick (choose the counterpart, including cross-currency suggestions).
- If the account has no balance anchor and the file has no balance column, a field asks for the current balance and its date.
- **Actions**:
  - filter by tag;
  - categorize rows inline;
  - decide near-matches;
  - pick transfer counterparts;
  - Import.
- **States**:
  - clean file (nothing to decide);
  - needs decisions: Import stays disabled until every near-match and the balance are settled. Uncategorized rows and unpicked transfers can be left for Review.
- **Mobile**: the tag filter is a row of chips, and each row is a card.

#### S10 Import · Done

- **Shows**:
  - how many transactions were imported, skipped as duplicates, and sent to Review;
  - the balance check: matches the bank, or a mismatch with its difference.
- **Actions**: go to Review, go to the account, or import another file.
- **States**:
  - balance OK;
  - mismatch;
  - no balance column (check skipped).

### Reports

All three reports share a currency switcher (EUR first) and a period control.

#### S11 Balance over time

- **Shows**:
  - a chart of the total balance for the selected currency, broken down by account;
  - a range selector (e.g. 3M / 1Y / All).
- **States**: one account, or several accounts.

#### S12 Monthly in vs out

- **Shows**:
  - a month picker;
  - income and expenses by category;
  - net cashflow and savings rate;
  - Moved to savings, with its transfers (layout as in brief §6.1);
  - a 12-month bar chart of income vs. expenses.
- **Actions**: open a category → S5, filtered to that month and category.
- **States**: no data for the month.

#### S13 Spending by category

- **Shows**:
  - a period picker;
  - a chart and a ranked list of expense categories, with amount and share.
- **Actions**: open a category → S5, filtered.
- **States**: no spending in the period.

### Budgets

#### S14 Budgets

- **Shows**:
  - a This month / Running balance toggle (brief §6.2);
  - one row per budget: category, limit, spent, left and a progress bar;
  - a currency switcher;
  - month navigation for past months.
- **Actions**: add a budget (D7), open a budget (S15).
- **States**:
  - no budgets;
  - under budget;
  - over budget (warning).

#### S15 Budget detail

- **Shows**: a month-by-month table with the limit in force that month, spent, left and running balance.
- **Actions**: change the limit from a given month (D7), or open a month's transactions (S5, filtered).

### Organize

#### S16 Categories

- **Shows**: income and expense categories, each with its number of transactions.
- **Actions**: add or edit a category (D5), or delete one (D5 asks where its transactions go).
- **States**: no categories.

#### S17 Rules

- **Shows**: each rule as "description contains / matches regex X [+ amount, account] → category".
- **Actions**: add or edit a rule (D6), or delete one.
- **States**: no rules.

### Settings

#### S18 Settings

- **Transfers**: transfer window in days (default 3).
- **Import presets**: the saved bank formats. Edit one (S8) or delete it.
- **Backup & restore**: download a backup file, or restore from one (D8).

## 5. Dialogs & panels

On mobile, every dialog opens as a full-screen sheet.

- **D1 Account form**: name, bank, type (checking / savings), currency, optional balance anchor. Used to create and edit accounts.
- **D2 Set balance**: current balance and its date (the anchor). Opened from S4. The same fields appear inline in S9.
- **D3 Archive account**: asks to confirm archiving.
- **D4 Link transfer**: pick the counterpart from the candidates (opposite direction, within the transfer window), including accounts in other currencies. Each candidate shows its account, date and amount.
- **D5 Category form**: name, income / expense. Delete variant: move the category's transactions to another category, or leave them uncategorized.
- **D6 Rule form**: description match (contains / regex), optional amount and account, category. Prefilled when opened from S6 or S2.
- **D7 Budget form**: category, currency, monthly limit, start month. Edit variant: the new limit and the month it applies from.
- **D8 Restore backup**: warns that all current data will be replaced, then asks to confirm.

## 6. User flows

1. **First run**
   1. S1 shows the empty state → Add account.
   2. D1: create the account.
   3. S4 (empty) → Import.
   4. S7: choose the file.
   5. S8: map the columns (new bank).
   6. S9: review the rows; enter the current balance if asked.
   7. S10 → S1, which now shows data.
2. **Monthly import**
   1. Import → S7: choose account and file. The preset is detected, so S8 is skipped.
   2. S9: decide near-matches, categorize what's left, pick transfer counterparts.
   3. S10 → S2 if anything was left for Review.
3. **Categorize and create a rule**
   1. S2 or S5 → S6.
   2. Pick a category.
   3. Create rule from this → D6 (prefilled) → save.
4. **Confirm a transfer**
   1. S2 → Transfers to confirm → link, or mark as not a transfer.
   2. Manually: S6 → D4 → pick the counterpart.
   3. To undo: S6 → Unlink.
5. **Currency exchange**
   1. Import the EUR account's file (flow 2).
   2. Import the USD account's file. S9 suggests the cross-currency pair.
   3. Confirm it there, or later in S2.
6. **Balance mismatch**
   1. Reach it from S10, S2 or the S4 banner.
   2. S4 opens at the date where the balances diverge.
   3. Find the missing or duplicate transaction and fix it (how depends on open question 1).
7. **Check how I'm doing**
   1. S1 → S12: this month's in vs. out.
   2. Open a category → S5 (filtered) → S6.
   3. S13 for spending over a longer period, and S11 for the balance trend.
8. **Budgets**
   1. S14 → Add budget → D7.
   2. Track it through the month on S1 and S14.
   3. Switch to Running balance to see carry-over.
   4. S15 → change the limit from next month (D7).
9. **Manage accounts**
   1. S3 → S4.
   2. D1 to edit, D2 to set the balance, D3 to archive.
10. **Backup and restore**
    1. S18 → download a backup.
    2. Restore: S18 → choose a file → D8 → S1.
11. **Organize categories and rules**
    1. S16 → D5 to add, rename or delete (reassigning transactions).
    2. S17 → D6 to edit or delete a rule.

## 7. Shared components

Design these first. Every screen is built from them.

- **App shell**: desktop sidebar and mobile bottom tabs.
- **Amount**: sign, currency symbol, colour for income / expense / transfer.
- **Currency switcher**.
- **Month / period picker**.
- **Category chip**.
- **Transfer badge** (⇄), showing the counterpart account.
- **Row status tag**: new / duplicate / near-match / auto-categorized / needs review.
- **Budget progress bar**: under, near and over the limit.
- **Chart card**: a chart with a title, legend and empty state.
- **Empty state**: illustration or icon, a message and one primary action.
- **Review count badge**.
- **Data row**: a desktop table row and its mobile list-row counterpart.

## 8. Design order

1. **Batch 1, core loop**: shell and components, S1, S3, S4, D1, D2, S7–S10, S5, S6, S2.
2. **Batch 2, insight**: S11–S15, D7, S16, S17, D5, D6, D4.
3. **Batch 3, admin and edge cases**: S18, D3, D8, then the remaining empty and error states.

## 9. Open design questions

1. Can I delete a transaction (e.g. a duplicate that slipped through) or add one by hand? This affects S4, S6 and flow 6.
2. Should a new rule also apply to existing uncategorized transactions? If so, D6 needs an "apply to N existing transactions" option.
3. When several rules match a transaction, which one wins: list order (drag to reorder in S17) or the most specific rule?
