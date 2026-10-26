# Bean Counter — Screens & Flows

_Status: draft · Last updated: 2026-10-26 · Source: [brief.md](brief.md)_

These are the screens to design and the flows that connect them. Each entry covers what a screen shows and lets me do, not how it's built. The design work happens in HTML, in [wireframes/](wireframes/) (see §8).

## 1. Scope & assumptions

- **Home** is a Dashboard.
- **First run** has no setup wizard. Empty screens explain the next step instead.
- **Review inbox**: one screen gathers everything waiting for my decision. During an import, the same items can be settled right away for that file.
- **Layouts**: every screen and dialog gets a desktop layout (1440 px wide) and a mobile layout (390 px wide, at least 844 px tall, growing with the content).
- **Language**: English.
- **Money**: amounts are always shown in their own currency and never converted. Screens that show totals have a currency switcher, with EUR first.

## 2. Feature map

| Brief feature | Screens & dialogs |
|---|---|
| 5.1 Accounts | S3, S4, D1, D2, D3, D10 |
| 5.2 Import | S7, S8, S9, S10, S18 (presets) |
| 5.3 Categorization | S2, S6, S9, S16, S17, D5, D6 |
| 5.4 Transfer detection | S2, S6, S9, D4, S18 (window) |
| 5.5 Reports | S1, S11, S12, S13 |
| 5.6 Budgets | S1, S14, S15, D7 |
| 5.7 Multiple currencies | S3 (grouped by currency), currency switcher on S1 and S11–S14, D4 |
| 5.8 Backup & restore | S18, D8 |
| 5.9 Dashboard & Review | S1, S2 |
| 5.10 Split bills | S2, S4, S5, S6, D9 (and the numbers in S1, S12–S15) |

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
  - total balance in the selected currency, plus each account's balance, and how far off the bank an account is when its balances part;
  - this month's income, expenses and net cashflow: the newest month with transactions in that currency, as S12 opens on;
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
- **Shows**: groups, each with a count.
  - **Possible paybacks**, first: money in without a category that could pay back my expenses of the 30 days before it, naming the newest two. Until I decide, reports leave it out, and it isn't listed under Uncategorized or Rule conflicts.
  - **Uncategorized**: date, account, description and amount, with an inline category picker. When a rule would give one a category now (it was saved without applying it, or the other rule of a conflict was deleted), the item names the rule and its category, and **Use it** accepts it.
  - **Rule conflicts**: transactions matched by more than one rule, with the competing rules and their categories. I pick the category.
  - **Transfers to confirm**: same-currency transactions with more than one possible match (pick the other side, or mark as not a transfer), and cross-currency suggestions (link, or mark as not a transfer).
  - **Balance mismatches**: account, computed vs. bank balance, the difference, and the last day the balances match and the first day they don't.
- **Actions**:
  - categorize a transaction, with a shortcut to create a rule (D6); it leaves the list, and a toast offers Undo;
  - pick the category for a rule conflict;
  - link or dismiss a transfer (a dismissal is remembered);
  - link a possible payback (D9), or say it's income by picking its category (remembered); either way a toast offers Undo;
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
  - the account's transactions: date, description, category or transfer badge, amount, running balance. Excluded transactions stay in the list, greyed out.
- **Actions**:
  - Import into this account (S7, account preselected);
  - edit (D1), set balance (D2), archive (D3) or delete (D10);
  - exclude a transaction, or restore an excluded one;
  - open a transaction (S6).
- **States**:
  - no transactions;
  - mismatch warning, which jumps to where the balances split;
  - archived (read-only, with Unarchive and Delete).

#### S5 Transactions

- **Purpose**: search and filter transactions across all accounts.
- **Shows**: date, account, description, category (or transfer badge), and amount in the account's currency. Excluded transactions are greyed out. Archived accounts' transactions are listed too, and open read-only.
- **Filters**: account, period, category, type (income / expense / transfer / payback / uncategorized / excluded), text search.
  - The period is whole months: one month picked from those with transactions, or several when a report links to them. It opens on All time.
  - The type is how reports count a transaction: a possible transfer counts as a transfer, an excluded one only as excluded, a payment linked in full as a payback, the rest by their category's type or as uncategorized.
  - The search finds descriptions that contain the text, like a rule's "contains": ignoring case and repeated spaces.
  - The filters are in the address, so reports can link to them; the search isn't.
  - With accounts in more than one currency, the account filter also offers every account in one currency ("All EUR accounts"), which reports link to.
- **Actions**: open a transaction (S6). Its panel stays open when a change takes it out of the filtered list.
- **States**: no transactions yet, or no results for the current filters (saying which, with Clear filters).
- **Mobile**: rows grouped by day. The filters open in a sheet that says how many transactions they show; chips show the filters set, each with ✕ to take it off.

#### S6 Transaction detail

- **Purpose**: inspect and fix one transaction.
- **Shows**:
  - account, date and amount;
  - the description as imported and as edited;
  - the category;
  - a transfer section: the linked counterpart, or "not linked";
  - for an expense: your share and the paybacks linked to it, or "Nobody has paid it back";
  - for money in: the expense or expenses it pays back and what's left unlinked, or "Not linked to an expense";
  - each linked expense or payback opens in the panel.
- **Actions**:
  - edit the description;
  - set the category;
  - create a rule from this transaction (D6, prefilled);
  - link a transfer (D4), or unlink one;
  - link a payment to the expenses it pays back, or an expense to the payments that pay it back (D9), or unlink them;
  - exclude the transaction, or restore it.
- **States**:
  - categorized;
  - uncategorized;
  - linked transfer (the category is hidden; shows the counterpart's account and amount instead);
  - expense with paybacks (shows your share);
  - linked payback (the category is hidden; shows the expenses it pays back);
  - excluded (greyed out, with Restore).
- **Desktop**: a side panel over S2, S4 or S5. **Mobile**: full screen.

### Import

The import is a four-step wizard. S8 is skipped when the bank already has a saved preset, unless I choose to change its mapping.

#### S7 Import · Choose file

- **Shows**:
  - an account picker;
  - a drop zone or file picker for CSV or Excel;
  - once a file is chosen, the detected bank preset, or "new format".
- **Actions**: continue, change the account, or add a new one (D1) when the statement belongs to an account not added yet. With a recognised format, "Change the mapping" opens S8 with the saved mapping.
- **States**:
  - no accounts yet (→ D1);
  - unreadable or unsupported file.

#### S8 Import · Map columns

- **Purpose**: teach the app a bank's export format, once per bank.
- **Shows**:
  - the first rows of the file;
  - for each column, a choice of what it holds: date, amount, debit, credit, fee, description, balance, bank reference, currency, status or ignore;
  - date format and decimal separator;
  - a live preview of how the rows will be read.
- **Actions**: save as the preset for this bank and continue.
- **States**:
  - mapping incomplete (Continue is disabled and the missing fields are named);
  - valid.
- Also opened from S7 to change a recognised format's mapping (updating its preset is optional), and from S18 to edit a saved preset: its name and mapping, with the samples and live preview from the last file imported with it.
- **Mobile**: one card per column, top to bottom.

#### S9 Import · Preview & resolve

- **Purpose**: see what will be imported and settle anything that needs a decision before saving.
- **Shows**: summary counts and every row, tagged as one of:
  - new, auto-categorized or uncategorized;
  - rule conflict (more than one rule matches; pick a category);
  - duplicate (will be skipped);
  - near-match (keep or skip; must be decided);
  - transfer linked, or transfer to pick (choose the counterpart; cross-currency pairs are suggested in S2 after the import);
  - left out (in another currency than the account's, or not completed), with the reason;
  - can't read, with what's wrong with it.
- If the account has no balance anchor and the file has no balance column, a field asks for the current balance and its date.
- **Actions**:
  - filter by tag;
  - categorize rows inline and settle rule conflicts;
  - decide near-matches;
  - pick transfer counterparts;
  - Import.
- **States**:
  - clean file (nothing to decide);
  - needs decisions: Import stays disabled until every near-match and the balance are settled. Uncategorized rows, rule conflicts and unpicked transfers can be left for Review.
- **Mobile**: the tag filter is a row of chips, and each row is a card.

#### S10 Import · Done

- **Shows**:
  - how many transactions were imported, skipped as duplicates, left out or unreadable, and sent to Review;
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
  - a month picker: arrows from the first month with transactions to this one; it opens on the newest month with transactions, and the month and currency are in the address;
  - income and expenses by category;
  - net cashflow and savings rate;
  - Moved to savings, with its transfers (layout as in brief §6.1);
  - a 12-month bar chart of income vs. expenses;
  - a note when items in Review can still change the numbers (brief §5.5).
- **Actions**: open a category → S5, filtered to that month, category and type (and currency, with accounts in several), so it lists what the line adds up; open a month from the chart.
- **States**: no data for the month; items still in Review.

#### S13 Spending by category

- **Shows**:
  - a period picker: the last 3 months (where it opens), 6 or 12 months up to the newest month with transactions in that currency, each calendar year, All time, or a custom range with From and To months; the period and currency are in the address;
  - a chart and a ranked list of expense categories, with amount and share; the six largest each have their own colour, and the rest and Uncategorized are Other, in gray;
  - under the list, the categories that got more back than they spent, and the possible transfers going out that aren't counted yet (brief §5.5);
  - a note when items in Review can still change the numbers.
- **Actions**: open a category, from the list or the chart → S5, filtered to the period, category and type (and currency, with accounts in several).
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
- **Actions**: change the limit from a given month (D7), start the running balance over from a chosen month (D7), or open a month's transactions (S5, filtered).

### Organize

#### S16 Categories

- **Shows**: income and expense categories, each with its number of transactions and what uses it (budgets, rules).
- **Actions**: add or edit a category (D5), or delete one (D5 asks where its transactions go).
- **States**: no categories.

#### S17 Rules

- **Shows**: each rule as "description contains / matches regex X [+ amount, account] → category".
- Rules have no order. When more than one rule matches a transaction, the app doesn't choose: the transaction goes to Review (S2).
- Rules that overlap are tagged, with a banner linking to the rule conflicts they caused in Review.
- **Actions**: add or edit a rule (D6), or delete one.
- **States**: no rules.

### Settings

#### S18 Settings

- **Transfers**: transfer window in days (default 3).
- **Import presets**: the saved export formats, one per format (a bank can have several). Edit one (S8) or delete it.
- **Backup & restore**: download a backup file, or restore from one (D8).

## 5. Dialogs & panels

On mobile, every dialog opens as a full-screen sheet.

- **D1 Account form**: name, bank, type (checking / savings), currency, optional balance anchor. Used to create and edit accounts.
- **D2 Set balance**: current balance and its date (the anchor). Opened from S4. The same fields appear inline in S9. If the balance differs from the app's, D2 shows the difference first and offers "Use my balance" (new anchor) or "Look for what's missing" (keeps the anchor; the difference shows as a mismatch).
- **D3 Archive account**: asks to confirm archiving.
- **D4 Link transfer**: pick the counterpart from the candidates (opposite direction, within the transfer window), including accounts in other currencies. Each candidate shows its account, date and amount.
- **D5 Category form**: name, income / expense, and what uses the category (transactions, budget, rules). Delete variant: move the category's transactions to another category, or leave them uncategorized. The rules that assign the category follow its transactions (or are deleted if the transactions are left uncategorized), and its budget is deleted with its history; the dialog lists these before you confirm.
- **D6 Rule form**: description match (contains / regex), optional amount and account, category. Prefilled when opened from S6 or S2. An "Also apply to N uncategorized transactions that match" option is ticked by default. Transactions that already have a category are never changed. When an edit removes an overlap, D6 offers to re-check the rule conflicts in Review.
- **D7 Budget form**: category, currency, monthly limit, start month. Edit variant: the new limit and the month it applies from. Start-over variant: the month the running balance counts from.
- **D8 Restore backup**: warns that all current data will be replaced, offers to download the current data first, then asks to confirm.
- **D9 Link payback**: pick the expense or expenses this incoming payment pays back (same currency; suggestions from the previous 30 days, with a search for older ones) and how much goes to each. The amounts are prefilled and a check shows what's left; the part that isn't linked needs a category.
  - Ticking one prefills what's left of the payment, up to what's left on the expense, newest expense first; an amount I type stays, and the untouched ones share the rest.
  - From an expense it's the same dialog turned around: the payments of the 30 days after it that aren't linked in full, with a search for later ones; the check shows my share.
  - It opens on the split the transaction has, so it also edits it.
- **D10 Delete account**: says it can't be undone and lists, with counts, what goes (the account's transactions, its imports, the balances I entered and the rules narrowed to it, by name) and what changes in my other accounts (the transfers that go back to Review and the paybacks that get unlinked, by account). Offers to download a backup first, ticked by default as in D8; the Delete button is red. Afterwards S3, with a message naming the deleted account.

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
   2. S9: decide near-matches, categorize what's left, settle rule conflicts, pick transfer counterparts.
   3. S10 → S2 if anything was left for Review.
3. **Categorize and create a rule**
   1. S2 or S5 → S6.
   2. Pick a category.
   3. Create rule from this → D6 (prefilled) → keep "Also apply to N uncategorized transactions" ticked → save.
4. **Confirm a transfer**
   1. S2 → Transfers to confirm → link, or mark as not a transfer.
   2. Manually: S6 → D4 → pick the counterpart.
   3. To undo: S6 → Unlink.
5. **Currency exchange**
   1. Import the EUR account's file (flow 2).
   2. Import the USD account's file. The app never links across currencies on its own, so S9 imports the pair as normal transactions.
   3. S2 suggests the pair under Transfers to confirm: link it, or mark it as not a transfer.
6. **Balance mismatch**
   1. Reach it from S10, S2 or the S4 banner.
   2. S4 opens where the balances split.
   3. A duplicate that slipped through: exclude it (S6). A missing transaction: import the statement that contains it.
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
   2. D1 to edit, D2 to set the balance, D3 to archive, D10 to delete.
10. **Backup and restore**
    1. S18 → download a backup.
    2. Restore: S18 → choose a file → D8 → S1.
11. **Organize categories and rules**
    1. S16 → D5 to add, rename or delete (reassigning transactions).
    2. S17 → D6 to edit or delete a rule.
12. **Split a bill**
    1. You pay the whole bill: it shows in S4 and S5 as a normal expense.
    2. A friend pays you back. After the import, S2 lists the payment under Possible paybacks.
    3. Link it there (D9), or open it in S6 → Link payback… (D9). One payment can be split across several expenses.
    4. The expense shows your share (S6). Reports and budgets count only your share, in the expense's month.

## 7. Shared components

Each one is defined once in [wireframes/components.css](wireframes/components.css) and reused by every wireframe.

- **App shell**: desktop sidebar and mobile bottom tabs.
- **Amount**: sign, currency symbol, colour for income / expense / transfer.
- **Currency switcher**.
- **Month / period picker**.
- **Category chip**.
- **Transfer badge** (⇄), showing the counterpart account.
- **Payback badge** (↩), showing the expense paid back, or your share on the expense.
- **Row status tag**: new / duplicate / near-match / auto-categorized / rule conflict / possible payback / needs review / excluded.
- **Budget progress bar**: under, near and over the limit.
- **Chart card**: a chart with a title, legend and empty state.
- **Empty state**: illustration or icon, a message and one primary action.
- **Review count badge**.
- **Data row**: a desktop table row and its mobile list-row counterpart, each with an excluded (greyed) variant.

## 8. Design steps

1. **HTML wireframes** for every flow, with desktop and mobile layouts, in [wireframes/](wireframes/). Build them in this order:
   - **Batch 1, core loop**: shared components, S1, S3, S4, D1, D2, S7–S10, S5, S6, S2.
   - **Batch 2, insight**: S11–S15, D7, S16, S17, D5, D6, D4.
   - **Batch 3, admin and edge cases**: S18, D3, D8, then the remaining empty and error states.
2. **Design tokens** as CSS variables, such as colours, type scale and spacing, in [design/tokens.css](design/tokens.css), with a preview in [design/tokens.html](design/tokens.html). They cover a light and a dark theme that follow the system setting.
3. **High-fidelity HTML screens** built with those tokens, in [design/screens/](design/screens/index.html): desktop and mobile frames, light and dark. The index there tracks which screens are done.

## 9. Open design questions

None right now.
