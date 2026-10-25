# Bean Counter — Project Brief

_Status: v1 built · Last updated: 2026-10-25_

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
  - if the export has a balance column, the app takes it from there. After later imports whose balances all agree with the app's, it moves to the file's latest balance, so it stays recent; if they disagree, it stays where it is;
  - otherwise I enter the current balance and its date, which can't be in the future.
- The app works the opening balance out backwards from the anchor and the transactions, so I never need to know it.
- When the export has a balance column, each import compares the app's end-of-day balance with the bank's, for every day that has rows in the file. If they differ, the app flags a balance mismatch and shows where it is: between two consecutive days with bank balances, one where they match and one where they don't. It can't be more precise than that, because the bank only reports a balance on days with rows.
  - The anchor counts as a day where they match. So with a balance entered on 20/10 and only September imported, the difference falls between 30/09 and 20/10, where October's transactions are missing.
  - Each place where the difference changes is a separate mismatch, so two problems in one file show as two.
  - The bank's balance at the end of a day comes from that day's rows, whatever order the file lists them in.
  - The app points to the transactions in that window that would explain the difference, most likely first:
    - a skipped or excluded transaction of that amount, missing from the app;
    - a near-match I kept although the import flagged it, so the app has it twice;
    - only as a guess, any other transaction that would explain it by being there, such as a payment the bank reversed but still listed.
- Set balance compares the balance I enter with the app's own on that day, once the account has transactions. It's how accounts without a balance column get checked. If the two match, mine becomes the anchor. If they differ, the app shows the difference first (noting when my date is after the last imported transaction, so newer ones may just not be imported yet) and lets me choose:
  - use my balance as the new anchor, which moves every balance by the difference;
  - or keep the anchor and look for what's missing. My balance is kept, one per day, and compared like a bank balance, so the difference shows as a balance mismatch on the account's page until it's resolved. On a day a statement also has a balance, mine counts. I can remove it, and making that day's balance the anchor replaces it.
- Each account shows its current balance and its list of transactions.
- The accounts list shows a total for each currency. While an account in that currency has no balance yet, the total isn't shown, rather than showing a partial sum.
- Amounts I type are written like 3,240.50. A single comma followed by one or two digits also counts as decimals (3240,50, as phone keypads type it), and the currency's symbol or code can be included. Anything ambiguous, such as 3.240,50, is refused rather than guessed.

### 5.2 Import

- Upload a CSV or Excel export into a chosen account.
- The first import from a bank asks me to map its format: date, amount (or separate debit/credit columns), description, optional balance column, date format, decimal separator. The mapping is saved as a preset (e.g. "Bank A · checking") and reused automatically for any file with the same columns. Saving it is optional; saving one for columns that already have a preset updates it. A recognised format's mapping can still be opened and changed, for that file only or for its preset. The app proposes the mapping from the column names (in English, Italian, German or Spanish) and from the values (date format, decimal separator), and shows a live preview of how the first rows will be read. It moves on only when the mapping is complete and at least one of those rows can be read. A bank can have more than one preset, for example one for its checking export and one for its savings export.
- How files are read:
  - **Files**: CSV, separated by commas, semicolons, tabs or bars, in UTF-8 or older Windows text; or .xlsx, from its first sheet with data. Old .xls files, password-protected Excel files and PDFs are refused, with a hint on how to get a CSV or .xlsx.
  - **Missing line breaks**: some exports glue records together without line breaks; the app puts them back.
  - **Header**: lines above the column names (account number, period) are skipped. A file without column names gets "Column 1", "Column 2"…
  - **Dates**: day/month/year, month/day/year or year-month-day, with /, . or - between the parts. A two-digit year is in the 2000s. A time after the date is kept (12/06/2026 21:02:16), so transactions on the same day stay in order, and shown next to the date wherever the transaction is listed (12/06/2026 21:02).
  - **Amounts**: the other mark (or a space or an apostrophe) can only group thousands in threes. So with the wrong decimal separator set, 56,30 is refused instead of being read as 5,630. A minus at the end (56,30-) and the currency's symbol or code are accepted. Excel number cells don't depend on the separator.
  - **Debit and credit**: the amount is the credit minus the debit, whether or not the bank writes debits with a minus. A row with both is refused.
  - **Fees**: a separate fee column is taken off the amount, so a 16.00 payment with a 0.50 fee is −16.50.
  - **Currency**: when the file has a currency column, rows in another currency than the account's are left out and listed. A file with several currencies is imported once into each currency's account. The import warns as soon as I choose a file that looks like another currency's, and refuses one with no row in the account's currency.
  - **Status**: when the file has a status column (often called State or Status), only transactions that went through are imported (completed, booked, posted, settled and the like, also in Italian, German and Spanish). Pending, reverted or declined ones are left out and listed. Mapping the column to Ignore imports every row.
  - **Description**: several columns can make it up (payee and reference text, for example), joined with " · ".
  - **Errors**: a row that can't be read is reported with its line number and the reason, never guessed. It's left out, and the rest of the file can still be imported.
- Show a preview before saving anything. Each new row says what the rules do with it: auto-categorized (with its category), uncategorized, or a rule conflict (with the categories the rules disagree on). After the import, the summary says how many the rules categorized and how many they disagree on.
- Duplicate handling:
  - each transaction gets a fingerprint: its bank reference when the export has one, otherwise date + amount + description, and the time when both have one. Two different references are never the same transaction; two different times may be (a bank can change one between exports), so that's a near-match for me to decide;
  - transactions that exactly match one already imported are skipped;
  - near-matches (same date and amount, another description, unless both have bank references) are flagged in the preview for me to decide;
  - counts are respected, so two identical transactions on the same day (two €1.20 coffees) are both kept;
  - fingerprints use the values as originally imported, so editing a transaction later doesn't break duplicate detection.
- Transactions can't be added or deleted by hand: all data comes from files. Instead, I can **exclude** a transaction (e.g. a duplicate that slipped through). An excluded transaction is ignored by balances, reports and budgets, stays visible greyed out, and can be restored. A re-import still recognizes it, so it doesn't come back.

### 5.3 Categorization

- Manage categories (income / expense). Two categories can't share a name, ignoring case, even if one is income and the other expense, since lists and pickers show only the name. The Categories page lists income first, then expenses, each by name, with how many transactions use each and the rules that give it. Renaming a category or changing its type keeps its transactions. Deleting one that nothing uses just asks for confirmation.
- Rules match on description (contains / regex), optionally narrowed by amount or account, and assign a category. They run automatically on import.
  - Both description tests ignore case, and runs of spaces count as one.
  - The amount narrowing bounds its size, money in or out: at least X, under Y, or both. It's in one currency, and transactions in other currencies never match it. With an account picked, it's the account's currency.
  - Each rule shows how many transactions it categorized. Picking a category by hand takes the transaction off the rule; deleting a rule keeps the categories it gave.
- Uncategorized transactions are listed for manual review. When I categorize one by hand, I can turn that choice into a new rule: the form starts with the description's longest run of words without digits (dates, store numbers and references often have them) and the category I picked. A transaction a rule categorized names that rule instead, and one its rules disagree on is tagged as a rule conflict, with the categories they give.
- An account's page shows each transaction's category, or an Uncategorized tag (excluded transactions don't need one). Opening a transaction shows its details with a category picker: the categories of the type that matches the amount come first (expenses for money going out), and a new category can be added from the picker. On a computer the details open beside the list, so I can go from one transaction to the next.
- When I save a rule, the app offers to apply it to the existing uncategorized transactions that match, with their number, ticked by default. Transactions that already have a category are never changed, and neither are excluded transactions or archived accounts. A transaction that another matching rule disagrees on stays uncategorized and goes to Review; the form says how many.
- When an edit takes a rule out of the conflicts it caused, the app offers to re-check them: the rules left give them their category. While I type, the form shows the rules it would overlap, and the overlaps the edit removes.
- Rules have no order. If the rules that match a transaction give different categories, the app doesn't choose: the transaction goes to Review and I pick the category. If they all give the same one, there's nothing to choose and it gets that category.
- Rules that overlap (both could match the same transaction, with different categories) are flagged on the rules page, with a link to the conflicts they caused. Two rules overlap when one's "contains" text would itself match the other ("AMAZON PRIME" and "AMAZON") and their accounts, currencies and amounts can meet, or when an imported transaction matches both; for two regular expressions, only the second can tell.
- Deleting a category: its transactions move to a category I pick (its own type is offered first), or become uncategorized. The rules that assign it follow the transactions (or are deleted if the transactions become uncategorized), and its budget is deleted with its history. The app lists what will change before I confirm. A category that only rules give asks the same question about the rules: move them to another category, or delete them. Until budgets exist, only transactions and rules are asked about.

### 5.4 Transfer detection

- **Candidate match**: two transactions in two different accounts of mine, in the same currency, with opposite amounts, dated within the transfer window (3 days by default, adjustable in Settings from 0 to 30 days). A new window applies at once: whatever now has a single candidate is linked, and links made before stay.
- **Exactly one candidate**: when the two are each other's only candidate, the app links them automatically, as soon as the second one is imported (an import also links pairs imported before). Accounts that are archived are left out.
- **More than one candidate**: the app asks me to pick. Review lists one item per transaction on the smaller side of each group that could pair up in more than one way, with what could be its other side; the rest of the group waits with it, not as uncategorized. The import preview tags these rows "Transfer to pick".
- After every decision (a pick, "Not a transfer", an unlink), the app links again whatever now has a single candidate, which often settles the rest of a group: with two −100.00 and two +100.00 in the window, one pick links both pairs. Right after a pick or "Not a transfer", Undo puts back everything it changed.
- **Different currencies (an exchange)**: there's no rate to compare the amounts with, so the app never links these on its own. It suggests pairs that move money in opposite directions within the window, and I confirm. The two amounts record the real rate my bank applied.
  - Every such pair is its own suggestion in Review, with Link and Not a transfer; whatever the amounts, a busy account can bring many. "Not a transfer" dismisses only that pair.
  - A transaction that has candidates in its own currency isn't paired across currencies until that's settled.
  - Both sides stay normal transactions meanwhile: they can still be categorized, and they're listed under Uncategorized too.
- I can always link or unlink transfers manually. Linking by hand offers the candidates (even a pair I dismissed), then the transactions in other currencies going the other way within the window.
- If I say a suggested pair is not a transfer, or unlink a pair, the app remembers it and never suggests or links that pair again. I can still link them by hand.
- A transfer has no category: linking takes away the one a rule or I gave, and unlinking leaves both sides uncategorized. Excluding one side unlinks the other.
- A linked transfer:
  - still updates both accounts' balances and still appears in both accounts' transaction lists;
  - does **not** count as income, expense or category spending.
- Money sent to an account I don't track (a friend, a landlord) is a normal transaction, not a transfer.

### 5.5 Reports

Amounts in different currencies are never added together. Every report is shown per currency, with EUR first.

- **Total balance over time**: a chart of the total across all accounts in a currency, with a per-account breakdown.
  - Each account's balance at the end of every day, stacked, with the total on top, over the last 3 months, the last year (where it opens) or all time, up to the newest day with data. Under the chart, each account's balance at the start and end of the range, and the change.
  - An account counts from its first day with a transaction, or its balance's date if that's earlier. Before then its balance isn't known, so it adds nothing and the report says from when it counts. Archived accounts are included: they're history.
  - While an active account has no balance, there's no total, and the report names the account.
- **Monthly in vs. out**: for each month, it shows:
  - income, expenses and net cashflow (income − expenses);
    - each category adds up under its type, so a refund reduces its expense category;
    - a transaction without a category goes to an "Uncategorized" line: under expenses for money going out, under income for money coming in;
  - savings rate (net cashflow ÷ income), none in a month without income;
  - a separate **Moved to savings** line: net transfers from checking into savings accounts (withdrawals from savings reduce it).
    - Only linked transfers between a checking and a savings account count, not between two savings or two checking accounts.
    - Each counts on the savings side: in that account's currency and on that side's date. An exchange from a EUR checking account into a USD savings account counts in the USD report.
- **Spending by category**: for any period of whole months, with drill-down to the individual transactions.
  - Each expense category adds up as in the monthly report, so refunds reduce it, and uncategorized money out has its own line. Each line shows its share of the total.
  - A category that got more back than it spent in the period is left out of the chart, the shares and the total, and named under them.
  - The periods on offer: the last 3, 6 or 12 months up to the newest month with transactions in that currency, each calendar year, all time, or any range of months. It opens on the last 3 months.
- **Transactions still in Review**: uncategorized ones (including rule conflicts) count under an "Uncategorized" line. Possible transfers in one currency (a transfer to pick, with its candidate matches) and possible paybacks (§5.10) are left out of income, expenses and Moved to savings until I link or dismiss them, and the report names them. A suggested exchange across currencies counts as a normal transaction until I link it, as §5.4 says: any transaction near one in another currency can be suggested, so leaving them out would hide ordinary income and expenses. While items are waiting, reports say how many and that the numbers can still change.

### 5.6 Budgets

- A monthly limit for each expense category, in one currency. Only spending in that currency counts toward it.
  - A category has one budget. What it spends is what the monthly report counts for it: refunds and paybacks are taken off, and uncategorized spending counts toward no budget until it has a category.
  - It can start in any month from the first one with transactions in its currency, up to next month.
  - A category with a budget stays an expense category. Deleting the category deletes its budget, with its history.
- Two views I can switch between:
  - **This month**: spent vs. limit for the current month. It starts fresh each month.
  - **Running balance**: everything budgeted minus everything spent since the budget started. Unspent money carries over, and overspending reduces what's left.
- If I change a limit, each month keeps the limit that was in force at the time.
  - The new limit applies from a month I choose (from the start up to next month) and replaces any change from that month on.
- A budget's first month counts in full, even if I create it mid-month: whatever I've already spent that month comes out of it.
- The running balance never resets on its own. I can start it over from a month I choose; earlier months stay in the history but no longer count.
  - The month is after the start and after any earlier start-over, up to next month. Each month in the history keeps the running balance it had then.
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
  - Balances are per currency (EUR first, with a switch): the total of the active accounts and each one's balance. An account whose balances part from the bank's says by how much, as Review does.
  - "This month" is the newest month with transactions in that currency, as the monthly report opens on, so it isn't empty while the current month's statement isn't imported yet.
- A Review inbox gathers everything waiting for my decision: uncategorized transactions, rule conflicts, transfers to confirm, possible paybacks and balance mismatches. During an import, the same items can be settled right away for that file.
  - Picking a category in Review takes the transaction off the list, and a message offers Undo.
  - When a rule would categorize an uncategorized transaction now (it was saved without applying it, or the other rule of a conflict was deleted), Review names the rule and its category, and one click accepts it. Nothing changes until I do.
  - A possible transfer is picked from its candidates (D4), or marked "Not a transfer", with Undo.
  - Each place where an account's balances and the bank's part ways is its own item: the app's balance and the bank's, how far apart they are, and between which days. It opens the account at that place, and leaves Review once it's fixed there.
  - Archived accounts can't change, so their items are left out.
  - How many items are waiting shows next to Review in the navigation (on a phone, on More) and on the dashboard. An import says how many of its transactions it sent to Review.
- There's no setup wizard. On first launch, empty screens explain the next step (add an account, then import a statement).

The screens and flows are listed in [plan.md](plan.md).

### 5.10 Split bills

- When I pay for friends and they pay me back, I link their payment (a **payback**) to the expense it pays back. My share of the expense is its amount minus the paybacks linked to it.
- A payback isn't income. It reduces the expense's category, in the expense's month, in reports and budgets (including the running balance), even if it arrives in a later month.
- Amounts don't have to match: an expense can have several paybacks (one per friend), and one payment can be split across several expenses, choosing how much goes to each.
- The paybacks linked to an expense can't add up to more than the expense. The part of a payment that isn't linked counts as a normal transaction and needs a category.
- A payback and its expenses must be in the same currency. The payback can arrive in any of my accounts.
- I can link a payback by hand from either transaction. The app also suggests possible paybacks in Review: money coming in that no rule categorized and that isn't a possible transfer, together with my expenses from the previous 30 days that aren't fully paid back yet. I link it or mark it as income; if I mark it as income, the app remembers that and doesn't suggest it again. Unlinking makes it a normal transaction again.
  - Marking it as income is picking its category, so it leaves Review in one step. The same happens when I pick the category of a possible payback in the transaction panel.
  - A possible payback waits for that decision before anything else, as a possible transfer does: it isn't listed under Uncategorized or Rule conflicts meanwhile.
  - After Unlink, the payment can be suggested again, unless I marked it as income.
- If I change the expense's category, its paybacks follow it.
- A payment linked in full has no category. One that's only partly linked keeps its category for the rest, and waits in Review while it has none.
- I can unlink from either transaction. Excluding the payment or an expense unlinks it too, and restoring it doesn't link it again.
- A transfer, or a possible one, can't be linked as a payback until it's unlinked or marked as not a transfer. A transaction linked to a payback is never matched as a transfer.
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

### Where the app runs, and how changes reach it

Today the app runs only on my own computer, at 127.0.0.1, and every check (tests, lint, end-to-end) runs only when I start it. To decide:

- **Where it runs.** Only on this computer, as now, or also somewhere I can reach from my phone or another device: a machine at home on my network, or a server or cloud service.
- **Login first.** The app has no login because nothing but this computer can reach it, and online deployment is a non-goal (§2). Reaching it from anywhere else needs a way to keep everyone else out, decided before it moves: a login, or access only through a private network such as a VPN.
- **Environments.** One copy with my real data, or also a separate one to try changes on, with sample data only.
- **Checks on every push (CI).** Run the tests, lint, typecheck and end-to-end tests automatically, for example with GitHub Actions.
- **Delivery (CD).** How a new version reaches where the app runs (by hand, or automatically after the checks pass), and how the database is backed up before an update and its migrations run.
- **Backups.** Where backups are kept once the data isn't only on this computer, and how often.

This repository is public, so the answers recorded here stay general: never host names, addresses, domains, accounts, ports, keys or passwords. Those go in the deployment's own secret settings, outside the repository.

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
| 2026-10-20 | Reading statements: CSV and .xlsx with lines above the header skipped, missing line breaks put back, three date orders, the decimal separator checked against thousands groups, debit and credit columns, a fee column, a description from several columns, unreadable rows reported, not guessed |
| 2026-10-20 | Duplicates and the balance check: bank references decide when both sides have one, near-matches share date and amount; each change in the difference with the bank is its own mismatch, placed between two days with bank balances, the anchor counting as a day that matches; what could explain it, most likely first: skipped or excluded transactions, kept near-matches, then any transaction of the right amount as a guess |
| 2026-10-20 | Saving an import: the anchor follows the file's latest balance while everything agrees, unreadable rows are left out, one preset per set of columns, the account's currency is locked once it has transactions |
| 2026-10-20 | Import screens S7 and S8: an account can be added while choosing the file; the mapping is proposed from column names and values with a live preview, Fee is a column type, and S8 moves on only once some rows can be read |
| 2026-10-20 | Times, currencies and statuses: times are kept and used for duplicates; rows in another currency or not completed are left out and listed; an import with nothing in the account's currency is refused |
| 2026-10-20 | Import screens S9 and S10: every row with its tag (new, duplicate, near-match, left out, can't read), Keep or Skip for near-matches, the balance asked for when needed; then the counts and the balance check, with the likely causes of a mismatch. A recognised format's mapping can be changed from S7 |
| 2026-10-20 | Account page: its transactions with the balance after each, the bank's balance where a file had one, the mismatch and where the balances split; excluding and restoring transactions; the currency is locked once the account has transactions |
| 2026-10-20 | Set balance compares with the app's balance on that day: a match becomes the anchor; a difference offers Use my balance (new anchor) or Look for what's missing, which keeps my balance on the account's page and compares it like the bank's until I remove it |
| 2026-10-20 | Categories page and form: unique names across income and expense, counts of the transactions using each, renaming and changing type keep them, unused categories can be deleted |
| 2026-10-20 | Categorizing by hand: a Category column on the account page, and a transaction panel with the category picker (matching type first, new categories from the picker) and Exclude or Restore |
| 2026-10-21 | Deleting a category in use: its transactions move to another category, its own type offered first, or become uncategorized |
| 2026-10-21 | Rules, matching and storage: contains or regex ignoring case and spaces, amount bounds on the size in one currency, an optional account; rules that agree aren't a conflict; overlaps found from the descriptions and from imported transactions; deleting a category moves or deletes its rules with its transactions |
| 2026-10-22 | Rules page and form: each rule with what it needs, its category and how many it categorized, overlaps flagged with the conflicts they caused; the form shows overlaps while typing and offers to apply the rule to matching uncategorized transactions, or to re-check the conflicts an edit settles; categories show the rules that give them, and deleting one lists what happens to its rules |
| 2026-10-22 | Rules run on import: the preview tags rows auto-categorized, uncategorized or rule conflict, and the summary counts them; the account page tags rule conflicts; a transaction categorized by hand offers "Create rule from this", with the form filled in, and one a rule categorized names the rule |
| 2026-10-22 | Review: picking a category takes the item off the list with an Undo message; an uncategorized transaction a rule would now categorize names the rule and its category, with Use it |
| 2026-10-22 | Review: balance mismatches, one item per gap, with the app's and the bank's balance where they differ most, opening the account at the gap; the review count in the navigation, on the dashboard and in the import's summary; archived accounts left out |
| 2026-10-22 | Transfers, linked automatically: a pair that's each other's only candidate is linked when an import is saved, losing its category; the account page tags it with the other account, the transaction panel shows the other side with Unlink, which is remembered; excluding one side unlinks the other; the import summary counts the linked ones |
| 2026-10-22 | Transfers to pick: tagged on the account page and in the import preview, one Review item per transaction on a group's smaller side, picked with Link transfer (D4, also from the transaction panel) or dismissed with "Not a transfer", with Undo; after every decision the app links again whatever has a single candidate left |
| 2026-10-22 | Exchanges and the transfer window: every pair across currencies within the window is suggested in Review (Link, or Not a transfer for that pair), never linked on its own and still a normal transaction meanwhile; Settings has the transfer window, 0 to 30 days, applied at once |
| 2026-10-23 | Times: a transaction's time, when its file had one, is shown next to its date everywhere it's listed: Review, Link transfer, the other side of a transfer, near-matches and the transactions that could explain a balance mismatch |
| 2026-10-23 | Transactions (S5), first part: every account's transactions newest first, archived accounts included, tagged as on the account page and opening the transaction panel; a search on the description that ignores case and repeated spaces; 50 rows at a time with Load more; grouped by day on a phone. Money in shows green only once it has a category and can't be a transfer, on the account page too |
| 2026-10-23 | Transactions (S5), filters: account, period (whole months, All time by default), category and type (as reports count it: a possible transfer is a transfer, an excluded one only excluded), kept in the address so reports can link to them; on a phone they're in a sheet, with chips for those set; an empty result says which filters, with Clear filters; the open transaction's panel stays open when a change takes it out of the list |
| 2026-10-23 | Monthly in vs out, the sums: per category under its type (refunds reduce their category), uncategorized money out and in on their own lines, net and savings rate; excluded transactions, transfers and possible transfers left out, the possible ones listed; Moved to savings counted on the savings side, in its currency and on its date |
| 2026-10-23 | Monthly in vs out (S12): opens on the newest month with transactions, with arrows from the first month to this one and a currency switcher (EUR first); each line opens its transactions in S5, filtered the way the report counts them; Moved to savings lists its transfers and the possible ones not counted yet; how many transactions Review can still change; the last 12 months as a chart whose months open; suggested exchanges count as normal transactions until linked. Transactions can filter every account in one currency |
| 2026-10-23 | Dashboard: total balance per currency with each active account (and how far off the bank one is), the newest month's income, expenses and net with a link to the monthly report, and the Review card; a currency switch kept in the address |
| 2026-10-24 | Spending by category, the sums: each expense category over a period of whole months, as the monthly report adds it up, with its share of the total (rounded so the shares add up to 100 %); a category that got more back than it spent is named instead of counted; the periods on offer: the last 3, 6 and 12 months up to the newest with transactions, each calendar year, all time or a custom range |
| 2026-10-24 | Spending by category (S13): a ring and a ranked list with each category's amount and share, the six largest in their own color and the rest under Other; pointing at a row or a slice shows its numbers in the middle, and either opens its transactions in S5; the period on offer or a custom range of months, and the currency, kept in the address; categories refunded more than they spent and possible transfers going out named under the list. Reports has tabs for Monthly in vs out and Spending by category |
| 2026-10-24 | Split bills, the links: a payment split across the expenses it pays back, with an amount for each, never more than the payment or than what's left on an expense; reports count my share of each expense, in its month, and a payment linked in full isn't income; such a payment has no category and leaves Review, while a part that isn't linked needs one; unlinking from either side, and excluding either side unlinks it; transfers and possible transfers can't be linked, and linked transactions aren't matched as transfers |
| 2026-10-24 | Split bills, linking by hand: Link payback (D9) from a payment or, turned around, from an expense, with suggestions from the 30 days before the payment (or after the expense), a search for older expenses (or later payments), and amounts prefilled with what's left, nearest first, keeping what I type; the transaction panel shows what a payment pays back and what's left unlinked, or an expense's share and its paybacks, each opening in the panel, with Unlink; the lists tag paybacks and shares, and Transactions can filter paybacks |
| 2026-10-24 | Split bills, possible paybacks: Review lists money in without a category that could pay back expenses of the 30 days before it, first, with Link… (D9) and It's income, which picks its category and is remembered, each with Undo; reports leave possible paybacks out and name them (under income in the monthly report, and under the list in Spending by category); Transactions tags them, filters them with paybacks, and the panel puts that decision first. Money in is green in the panel only once it has a category, as in the lists |
| 2026-10-24 | Budgets, the sums: one budget per expense category, counting what the monthly report counts for it (refunds and paybacks taken off); each month's limit is the one in force then, and the running balance adds each limit and takes off each month's spending from the start or the last start-over; a budget starts, changes its limit or starts over at the latest next month, and starts at the earliest in the first month with transactions in its currency; a new limit replaces any change from its month on |
| 2026-10-24 | Budgets, stored: each budget with its limits and start-overs; the budgets of one currency in a month (the newest with transactions, by default), with that month and the running balance, and what that month spent with no category; one budget month by month up to the newest month with transactions; adding, changing the limit and starting over answer with the budget; a category with a budget can't become income, and deleting it deletes the budget |
| 2026-10-24 | Budgets page (S14) and adding a budget (D7): This month or Running balance in one currency, over budget first and budgets not started yet last, on the newest month with transactions or one picked with the arrows (back to the oldest budget's start), kept in the address; the month's uncategorized spending is named under the list, linking to it; adding offers the expense categories without a budget, my accounts' currencies and the months from the first with transactions to next month, and says what the category already spent this month comes out of the first limit |
| 2026-10-24 | Budget page (S15): this month against its limit and the running balance, then the history newest first, each month with its limit, spent, left, running balance and its transactions, the start-overs marked; Change limit shows the limits set, applies from a month (next month by default) and says what the running balance carries over and which later limits it replaces; Start over (next month by default) says what the running balance becomes, and isn't offered for a budget that hasn't started |
| 2026-10-24 | Budgets on the dashboard and in categories: the dashboard shows up to five budgets of its month and currency, over budget first, each opening its page, with All budgets (under the balance on desktop, after the month on a phone; hidden until a budget has started); Categories lists a category's budget under Used by, the form says a category with a budget stays an expense category, and deleting one lists its budget as deleted with its history. The dashboard's Review card now counts possible paybacks too |
| 2026-10-24 | Backup and restore (S18, D8): a backup is a copy of the whole database, downloaded as one file, and Settings shows the day of the last one; a restore checks the file is a Bean Counter backup, brings an older one up to date, and replaces all data in one step, so a failed restore changes nothing; D8 downloads a backup of the current data first unless I untick it, then lands on the dashboard |
| 2026-10-25 | Import presets in Settings (S18): each saved format with its column count, whether it has a balance column, the accounts it was used for and its last import (only imports that used the preset count); deleting one, after a confirmation, keeps what was imported with it, and the next file in that format goes through the column mapping again |
| 2026-10-25 | Editing an import preset (S8 from S18): its name and column mapping, with the samples and the live preview from the last file imported with it, saved only once the mapping is complete and the samples read; the change applies to future imports only; Delete is on the edit page too, and on mobile a preset opens it |
| 2026-10-25 | Balance over time (S11), the first report: each account's end-of-day balance stacked, with the total, over 3 months, a year or all time, in one currency; an account counts from the first day its balance is known, archived accounts included, and there's no total while an active account has no balance; under the chart, each account's balance then and now |
