# Bean Counter — Project Brief

_Status: draft · Last updated: 2026-10-19_

## 1. Summary

Bean Counter is a personal web app for tracking my cashflow across all my bank accounts in one place. I import the statements my banks already export (CSV/Excel). The app categorizes the transactions, recognizes transfers between my own accounts, and shows where my money comes from, where it goes, and how my total balance changes over time.

## 2. Goals

- See every account's balance, and the overall total, in one place.
- See income vs. expenses for each month, with net cashflow and savings rate.
- Break spending down by category and track it against monthly budgets.
- Keep manual work small: import a file, review what the app suggests, done.

### Non-goals (for now)

- Multiple users or sign-up.
- Login and online deployment (maybe later).
- Automatic bank sync (open-banking APIs).
- Adding transactions by hand.
- Credit cards, cash, e-wallets, investments.
- Tracking who owes what between friends (only paybacks that have arrived get linked, see §5.10).
- Currency conversion and exchange-rate feeds.
- Native mobile app.

## 3. Context & constraints

| | |
|---|---|
| Users | Single user (me). |
| Hosting | Runs locally, reachable only from localhost. The data stays on my machine. |
| Access | No login. |
| Data input | CSV/Excel (.xlsx) import of bank statements |
| Account types | Checking, savings |
| Currency | EUR is the main currency. Other currencies live in their own accounts and are never converted. |
| UI language | English |
| Layouts | Desktop and mobile |
| Theme | Light and dark, following the system setting |
| Tech stack | TypeScript: a React UI and a Fastify server on Node, with the data in one SQLite file. Details in CLAUDE.md; this brief describes behaviour only. |

## 4. Core concepts

- **Account**: a bank account I own, in exactly one currency. It has a name, bank, type (checking / savings), currency and a balance anchor.
- **Balance anchor**: one known balance on a given date. Every other balance of the account is worked out from it.
- **Transaction**: one line from a statement, with a date, a signed amount in the account's currency, a description and an account. It either has a category or is part of a transfer.
- **Import preset**: a saved column mapping for one bank's export format.
- **Category**: e.g. Salary, Rent, Groceries. Each category is either income or expense.
- **Rule**: "if a transaction matches X, assign category Y". Rules are applied on import.
- **Transfer**: a linked pair of transactions that moves money between two of my own accounts. This includes currency exchanges.
- **Budget**: a monthly spending limit for one expense category, in one currency.

## 5. Features (v1)

### 5.1 Accounts

- Create, edit and archive accounts (name, bank, type, currency).
  - Two accounts can't share a name, ignoring case and including archived accounts.
  - The currency can change until the account has transactions. The balance anchor keeps its written amount (1,120.00 € becomes 1,120.00 $). The change is refused if the new currency can't write it, for example 1,120.50 € to JPY, which has no decimals.
- Each account needs one known balance (the anchor):
  - if the export has a balance column, the app takes it from there;
  - otherwise I enter the current balance and its date, which can't be in the future.
- The app works the opening balance out backwards from the anchor and the transactions, so I never need to know it.
- When the export has a balance column, each import compares the app's end-of-day balance with the bank's, for every day that has rows in the file. If they differ, the app flags a balance mismatch and shows where it starts: the last day the balances match and the first day they don't. It can't be more precise than that, because the bank only reports a balance on days with rows. If a skipped or excluded transaction in that window would explain the difference, the app points to it.
- Accounts without a balance column are only checked when I enter a balance by hand (Set balance). If it differs from the app's balance, the app shows the difference first and lets me choose: use my balance as the new anchor, or keep the anchor and look for what's missing. In the second case the difference shows as a balance mismatch until it's resolved.
- Each account shows its current balance and its list of transactions.
- The accounts list shows a total for each currency. While an account in that currency has no balance yet, the total isn't shown, rather than showing a partial sum.
- Amounts I type are written like 3,240.50. A single comma followed by one or two digits also counts as decimals (3240,50, as phone keypads type it), and the currency's symbol or code can be included. Anything ambiguous, such as 3.240,50, is refused rather than guessed.

### 5.2 Import

- Upload a CSV or Excel export into a chosen account.
- The first import from a bank asks me to map its format: date, amount (or separate debit/credit columns), description, optional balance column, date format, decimal separator. The mapping is saved as a preset (e.g. "Bank A · checking") and reused automatically for any file with the same columns. A bank can have more than one preset, for example one for its checking export and one for its savings export.
- Show a preview before saving anything.
- Duplicate handling:
  - each transaction gets a fingerprint made from date + amount + description, or from the bank reference when the export has one;
  - transactions that exactly match one already imported are skipped;
  - near-matches (e.g. same date and amount, slightly different description) are flagged in the preview for me to decide;
  - counts are respected, so two identical transactions on the same day (two €1.20 coffees) are both kept;
  - fingerprints use the values as originally imported, so editing a transaction later doesn't break duplicate detection.
- Transactions can't be added or deleted by hand: all data comes from files. Instead, I can **exclude** a transaction (e.g. a duplicate that slipped through). An excluded transaction is ignored by balances, reports and budgets, stays visible greyed out, and can be restored. A re-import still recognizes it, so it doesn't come back.

### 5.3 Categorization

- Manage categories (income / expense).
- Rules match on description (contains / regex), optionally narrowed by amount or account, and assign a category. They run automatically on import.
- Uncategorized transactions are listed for manual review. When I categorize one by hand, I can turn that choice into a new rule.
- When I save a rule, the app offers to apply it to the existing uncategorized transactions that match. Transactions that already have a category are never changed.
- Rules have no order. If more than one rule matches a transaction, the app doesn't choose: the transaction goes to Review and I pick the category.
- Rules that overlap (both could match the same transaction) are flagged on the rules page, with a link to the conflicts they caused.
- Deleting a category: its transactions move to a category I pick, or become uncategorized. The rules that assign it follow the transactions (or are deleted if the transactions become uncategorized), and its budget is deleted with its history. The app lists what will change before I confirm.

### 5.4 Transfer detection

- **Candidate match**: two transactions in two different accounts of mine, in the same currency, with opposite amounts, dated within the transfer window (3 days by default, adjustable in settings).
- **Exactly one candidate**: the app links them automatically.
- **More than one candidate**: the app asks me to pick.
- **Different currencies (an exchange)**: there's no rate to compare the amounts with, so the app never links these on its own. It suggests pairs that move money in opposite directions within the window, and I confirm. The two amounts record the real rate my bank applied.
- I can always link or unlink transfers manually.
- If I say a suggested pair is not a transfer, the app remembers it and never suggests that pair again. I can still link them by hand.
- A linked transfer:
  - still updates both accounts' balances and still appears in both accounts' transaction lists;
  - does **not** count as income, expense or category spending.
- Money sent to an account I don't track (a friend, a landlord) is a normal transaction, not a transfer.

### 5.5 Reports

Amounts in different currencies are never added together. Every report is shown per currency, with EUR first.

- **Total balance over time**: a chart of the total across all accounts in a currency, with a per-account breakdown.
- **Monthly in vs. out**: for each month, it shows:
  - income, expenses and net cashflow (income − expenses);
  - savings rate (net cashflow ÷ income);
  - a separate **Moved to savings** line: net transfers from checking into savings accounts (withdrawals from savings reduce it).
- **Spending by category**: for any period, with drill-down to the individual transactions.
- **Transactions still in Review**: uncategorized ones (including rule conflicts) count under an "Uncategorized" line. Possible transfers (a transfer to pick or a cross-currency suggestion, with their candidate matches) and possible paybacks (§5.10) are left out of income, expenses and Moved to savings until I link or dismiss them. While items are waiting, reports say the numbers can still change.

### 5.6 Budgets

- A monthly limit for each expense category, in one currency. Only spending in that currency counts toward it.
- Two views I can switch between:
  - **This month**: spent vs. limit for the current month. It starts fresh each month.
  - **Running balance**: everything budgeted minus everything spent since the budget started. Unspent money carries over, and overspending reduces what's left.
- If I change a limit, each month keeps the limit that was in force at the time.
- A budget's first month counts in full, even if I create it mid-month: whatever I've already spent that month comes out of it.
- The running balance never resets on its own. I can start it over from a month I choose; earlier months stay in the history but no longer count.
- Past months are kept as history.

### 5.7 Multiple currencies

- Each account has exactly one currency. Money in another currency lives in its own account.
- I exchange currency in my bank app. The exchange shows up as a transfer between two of my accounts (see 5.4), so it counts as neither income nor expense in either currency.
- The app has no exchange rates and never converts. Totals, reports and budgets are all kept per currency.

### 5.8 Backup & restore

- Download a full backup of all data as one file from the UI.
- Restore from a backup file. A restore replaces all current data, so the app asks me to confirm first and offers to download a backup of the current data before replacing it.

### 5.9 Dashboard & Review

- The app opens on a dashboard showing balances, this month's income and expenses, budgets at a glance, and how many items are waiting for review.
- A Review inbox gathers everything waiting for my decision: uncategorized transactions, rule conflicts, transfers to confirm, possible paybacks and balance mismatches. During an import, the same items can be settled right away for that file.
- There's no setup wizard. On first launch, empty screens explain the next step (add an account, then import a statement).

The screens and flows are listed in [plan.md](plan.md).

### 5.10 Split bills

- When I pay for friends and they pay me back, I link their payment (a **payback**) to the expense it pays back. My share of the expense is its amount minus the paybacks linked to it.
- A payback isn't income. It reduces the expense's category, in the expense's month, in reports and budgets (including the running balance), even if it arrives in a later month.
- Amounts don't have to match: an expense can have several paybacks (one per friend), and one payment can be split across several expenses, choosing how much goes to each.
- The paybacks linked to an expense can't add up to more than the expense. The part of a payment that isn't linked counts as a normal transaction and needs a category.
- A payback and its expenses must be in the same currency. The payback can arrive in any of my accounts.
- I can link a payback by hand from either transaction. The app also suggests possible paybacks in Review: money coming in that no rule categorized and that isn't a possible transfer, together with my expenses from the previous 30 days that aren't fully paid back yet. I link it or mark it as income; if I mark it as income, the app remembers that and doesn't suggest it again. Unlinking makes it a normal transaction again.
- If I change the expense's category, its paybacks follow it.
- Until a friend pays, the expense counts in full: the app doesn't track who owes what.
- When a friend pays the bill and I send them my share, my payment is simply my expense: I categorize it, and no link is needed.

## 6. Examples

### 6.1 Monthly view

Checking receives a €2,000 salary and pays €700 rent and €300 groceries. I move €500 to savings, and savings earns €5 interest.

```
October 2026
─────────────────────────────
Income                +2,005 €
  Salary              +2,000
  Interest                +5
Expenses              -1,000 €
  Rent                  -700
  Groceries             -300
─────────────────────────────
Net cashflow          +1,005 €
Savings rate             50 %

Moved to savings         500 €
  Checking → Savings     500
─────────────────────────────
Balances  Checking  +500
          Savings   +505
```

The €500 transfer doesn't inflate income or expenses, but both account balances still reflect it.

### 6.2 Budget views

Groceries has a €300/month budget. I spend €250 in September and €320 in October.

```
[ This month ]                     [ Running balance ]

Groceries — October 2026           Groceries — since September 2026
Limit        300 €                 Budgeted     600 €  (2 × 300)
Spent        320 €                 Spent        570 €  (250 + 320)
──────────────────                 ──────────────────
Left         -20 €  ⚠ over         Left         +30 €
```

## 7. Open questions

None right now.

## 8. Feature log

New features and decisions are added here as we go.

| Date | Change |
|---|---|
| 2026-10-16 | Initial brief: accounts, import, categorization, transfers, reports, budgets, multi-currency |
| 2026-10-17 | Resolved open questions: no currency conversion (per-currency reports), balance anchor instead of opening balance, duplicate fingerprinting, transfer window adjustable (default 3 days), budget view toggle, no login (localhost only), backup/restore in UI |
| 2026-10-17 | Screens and flows plan ([plan.md](plan.md)): dashboard as home, Review inbox, empty states instead of a setup wizard, desktop and mobile layouts |
| 2026-10-17 | Resolved the plan's open questions: exclude instead of delete (no manual entry), new rules offered on existing uncategorized transactions, rule conflicts go to Review |
| 2026-10-17 | Balance check: compares end-of-day balances, reports the window where they split, points to skipped or excluded rows; a hand-entered balance that differs is shown before it's used |
| 2026-10-17 | Reports: uncategorized transactions count under Uncategorized; possible transfers are left out until linked or dismissed |
| 2026-10-17 | Budgets: the first month counts in full; the running balance never resets on its own but can be started over from a chosen month |
| 2026-10-17 | Categories and rules: categories show what uses them; overlapping rules are flagged with a link to their conflicts in Review |
| 2026-10-17 | Settings: import presets are per export format (a bank can have several); restore offers to back up the current data first |
| 2026-10-19 | Split bills: paybacks from friends are linked to the expense they pay back (one payment can cover several expenses); they aren't income and reduce the expense's category in the expense's month |
| 2026-10-19 | Resolved the plan's open questions: deleting a category moves its rules with its transactions and deletes its budget; dismissed suggestions (not a transfer, it's income) are remembered |
| 2026-10-17 | Design moves to HTML wireframes in [wireframes/](wireframes/): one file per flow, shared components, desktop and mobile layouts |
| 2026-10-19 | Design tokens in [design/tokens.css](design/tokens.css): light and dark themes following the system setting; teal main colour; income in green, expenses in the normal text colour, red only for problems |
| 2026-10-19 | Tech stack: TypeScript, React and Vite, Fastify on 127.0.0.1, SQLite (better-sqlite3 and Drizzle), Papa Parse and ExcelJS (.xlsx only, no old .xls), Vitest; money stored as integer cents |
| 2026-10-19 | Account rules: unique names, a currency change keeps the anchor's written amount, hand-entered balances can't be dated in the future, per-currency totals hidden while an account has no balance, how typed amounts are read |
