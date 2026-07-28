# bean-counter — Product Requirements

A self-hosted personal wallet that consolidates money across bank accounts, imports statements, and
categorizes spending automatically.

**Deployment: local-first, portable by design.** v1 runs on a development machine with no external
infrastructure — no cloud account, no container required. The same application is deployable
unchanged to a VPS or a home-lab Raspberry Pi when wanted. Host-specific concerns (bind address,
TLS, remote access) are configuration, never code, and **nothing in v1 may depend on a particular
host existing.**

> **Note on data.** This document contains no balances, amounts, transaction counts, account
> identifiers, payee names or verbatim statement descriptors. Statements live in `data/`, which is
> gitignored and never committed. Anything derived from them stays local — see §6.

---

## 1. Problem

Money moves across multiple accounts at multiple institutions, with no single view of it:

- **No unified picture** — each bank exports a different format with different column semantics.
- **Transfers between your own accounts pollute every analysis.** Moving money between two accounts
  you own is not spending, but naive tooling counts it as such.
- **Categorization is manual, so it never happens.**
- **Opaque outflows are invisible** — cash withdrawals and currency conversions leave the account
  with no record of what they bought.
- **Recurring charges drift unnoticed** — subscriptions creep up in price or outlive their usefulness.

**Goal for v1:** import statements from any supported bank, correctly identify transfers, categorize
automatically under rules you control, and answer: where does my money go, what did this trip cost,
what am I subscribed to, am I within budget, and what am I worth.

**Not in scope:** business bookkeeping — VAT, invoicing, payroll, statutory reporting, multi-entity
accounts. This is a personal wallet, and it is deliberately general-purpose *within* that.

### Why these decisions, and not others

Four properties of real bank exports shaped the architecture. Only these four are genuinely expensive
to reverse later:

| Property | Consequence |
|---|---|
| **Inter-account transfers are common** — often the single most frequent transaction type | Without matching, each one appears as phantom spending on one side and unexplained income on the other. Drove the double-entry model. |
| **Export files overlap in date range** | Re-exports share days with earlier files. Some repeated rows are true duplicates; others are legitimately distinct same-day charges of the same amount at the same merchant. A dedup key that can't tell them apart destroys real data silently. |
| **Some counterpart data is permanently unrecoverable** | Closed accounts and un-exported currency pockets leave conversions with no other side, ever. The system records known-unknowns rather than silently guessing or dropping them. |
| **Merchant frequency is heavily long-tailed** | A small number of merchants cover a large share of transactions, while a large fraction of distinct merchants appear exactly once. The head is learnable from corrections; the tail needs a human or a model. |

---

## 2. Domain model

Double-entry lite. A transaction owns 2+ postings that **must sum to zero**. Bank accounts and
categories are both accounts, so transfers, splits and refunds need no special cases.

| Entity | Purpose |
|---|---|
| `account` | Real accounts (`Assets:*`) and categories (`Expenses:*`, `Income:*`) alike. Colon path, `currency`, `status`, `closed_date`, `institution`. |
| `transaction` | Date, payee, note, originating batch. Owns postings. |
| `posting` | `(txn_id, account_id, amount, currency)`. Sum per transaction = 0 — see invariant 1 for how this is enforced. |
| `tag` + `transaction_tag` | Free-form orthogonal labels (e.g. a trip name). Many-to-many. |
| `import_batch` | One import. File, source, hash, counts, timestamp. Reversible as a unit. |
| `raw_row` | The original source line, immutable, linked to its transaction. Provenance + reparsing. |
| `merchant` | Normalized merchant → learned category. The categorization memory. |
| `rule` | User-authored matcher → category, with explicit precedence. |
| `suggestion` | Proposed category + confidence + reason. **Never** treated as confirmed. |
| `budget` | Category + period + limit. |
| `data_gap` | Records that a period or pocket is known-missing, so reports can say so rather than imply zero. |

Money is `Decimal`, stored as integer minor units. Never float.

### Why double-entry rather than flat rows

A flat `(date, amount, account, category)` table is simpler to insert and eyeball, but it cannot
represent a transfer without inventing a `type` flag plus a `transfer_pair_id` linking two rows that
must then be kept consistent by application code forever. Edit or delete one side and the other is
orphaned — silently reverting to a phantom expense.

With postings, the relationship *is* the transaction, enforced by a single `SUM(amount) = 0`
constraint, and inconsistent state is unrepresentable. Splits are a third posting rather than a
`parent_id` hack. Spending queries filter `WHERE account LIKE 'Expenses:%'`, so transfers are
excluded structurally instead of by remembering `AND type != 'transfer'` in every query.

Double-entry can always project down to a flat shape; flat can never project back up, because the
information was never captured. A `v_flat` view provides that projection for browsing and debugging:

```sql
CREATE VIEW v_flat AS
SELECT t.id, t.date, t.payee,
       asset.account AS account, cat.account AS category, asset.amount AS amount
FROM transactions t
JOIN postings asset ON asset.txn_id = t.id AND asset.account LIKE 'Assets:%'
JOIN postings cat   ON cat.txn_id   = t.id AND cat.account   LIKE 'Expenses:%';
```

### Invariants

1. Every transaction's postings sum to zero, and there are at least two. SQLite cannot express this
   as a `CHECK` — postings are inserted one row at a time and there are no deferred constraints — so
   it is enforced by writing a transaction and all its postings in one SQL transaction that asserts
   the sum before committing, backed by a permanent `v_unbalanced` view that startup and the test
   suite assert is empty.
2. Dedup key includes the statement's running balance (see §4.1 — this is load-bearing).
3. Categorization never overwrites a manual assignment.
4. Deleting an `import_batch` deletes exactly the transactions it created.

---

## 3. Extensibility

The system is account- and institution-agnostic. Nothing downstream of import knows which bank a row
came from.

**Adding an account** — a new bank, a savings pot, a cash wallet, or closing an old one — is a **row
insert via the UI. No code, no migration.** Accounts carry their own currency and status, so a
foreign-currency account or a closed account works immediately.

**Adding a statement format** is one class:

```python
class TransactionSource(Protocol):
    def sniff(self, headers: list[str]) -> bool:      # claim files you recognise
    def discriminators(self, f) -> list[str]:         # per-row account keys, if any
    def parse(self, f) -> Iterable[RawTxn]:           # emit normalised rows
```

`sniff` identifies a **format**, never an account — see assumption 16. `discriminators` reports the
distinct account keys a file contains, and the import flow asks once which account each maps to,
remembering the answer for every later import.

Register it and everything else — dedup, transfer matching, categorization, tags, reports, recurring
detection, budgets, net worth — works unchanged. Bank APIs arrive in v2 as another implementation of
the same protocol, not a refactor.

**What is genuinely single-tenant:** one user, one ledger, one app password. A second *person* would
be a real change. A second *account*, *bank*, or *currency* is not.

**Currency:** every posting carries a currency from day one. Multi-currency *holding* works now;
multi-currency *conversion* (FX rate table, converted reporting) is deferred until a non-base-currency
account actually exists.

---

## 4. User flows

### 4.1 Import

Upload a file (or drop it in a watched folder) → source auto-detected → rows normalized, originals
retained → dedup → transfer matching → categorization → summary → batch reversible in one click.

```
Import #7   statement.csv
  ✓  N new transactions
  ⏭  N skipped (duplicate)
  ⚠  N need review

  [ view rows ]   [ undo batch ]
```

**Dedup detail, because getting it wrong loses data silently.** The key is
`(account, date, description, amount, running_balance)`. Without the balance, two genuinely separate
identical charges on the same day — same merchant, same amount — collapse into one and the second is
lost. The running balance differs between them precisely because each one moved it, which is what
makes it the reliable discriminator.

### 4.2 Transfer matching

Candidates are opposite-sign, equal-amount postings across two accounts within a configurable window
(default ±5 days, since institutions post on different days). Confidence rises when the description
contains the account holder's own name, or a known inter-account pattern. Because round-number
transfers recur on the same day with identical amounts and descriptions, matching yields a candidate
*set* ranked by balance consistency and date proximity — never a first match.

Above threshold → linked, with each leg posting against `Assets:Transfers:Clearing`. Below →
surfaced for confirmation, never silently discarded. Transfers never reach spending reports, because
no leg touches `Expenses:`.

**Why a clearing account rather than merging the two legs into one transaction.** The two sides of a
transfer arrive in different files, hence different import batches — and invariant 4 requires that
deleting a batch delete exactly the transactions it created. A merged transaction would belong to
two batches at once, so merging and reversible imports cannot both hold. Clearing keeps each
transaction owned by exactly one batch, and it is more honest besides: a matched pair nets the
clearing account to zero, while an unmatched leg leaves a non-zero balance that correctly represents
money in transit or a missing counterpart. The clearing balance becomes a health metric instead of a
silent error.

### 4.3 Categorization

A chain of suggesters, each returning `(category, confidence, reason)`:

1. **Explicit user rule** — highest precedence, always wins, always explainable.
2. **Merchant memory** — normalized merchant → category, learned from every correction.
3. **Fallback** — leave uncategorized. **No cloud LLM.** A small local model is planned for v2 and
   joins as one more link in this chain, not a rewrite.

Merchant normalization strips institution prefixes and trailing card digits, collapses whitespace,
and matches on **prefix** — several banks truncate merchant names to a fixed width.

Bootstrapping groups by merchant so one decision applies retroactively to every transaction from that
merchant. Because merchant frequency is long-tailed, categorizing the handful of most frequent
merchants resolves a large fraction of all history in a few clicks.

### 4.4 Opaque outflows

Cash withdrawals and currency conversions are categorized **at the point of exit**, since what they
bought is unknowable. Both are taggable, so a trip's cash still rolls into that trip's total.

Where a counterpart genuinely cannot be recovered — a closed account's foreign-currency pocket, a
statement that was never exported — a `data_gap` row records it, so reports show a gap rather than
implying zero.

### 4.5 Reports

- **Spend by category, month over month** — macro rollup, drill-down to sub, filterable by tag.
- **Recurring / subscriptions** — same merchant recurring monthly; flags price changes and stops.
- **Budgets** — monthly limit per category, progress, over-budget warning.
- **Net worth timeline** — summed asset balances, annotated wherever a `data_gap` falls.

Categories are two levels (macro → sub). Tags are orthogonal to categories, so a restaurant meal
abroad is `Expenses:Food:Restaurants` **and** a trip tag — letting you ask both "what do I spend
eating out" and "what did that trip cost" without either number being wrong.

---

## 5. Out of scope for v1

Bank API sync (v2, same `TransactionSource` protocol) · any cloud LLM · local LLM categorization
(v2) · multi-user and sharing · FX conversion and converted reporting · receipts and attachments ·
investment positions, cost basis, capital gains · forecasting and savings goals · native mobile app
(responsive web only) · bill reminders and scheduled payments · export to Beancount/QIF/OFX ·
business accounting features.

---

## 6. Assumptions and open questions

### Handling of personal data

This repository never contains financial data:

- Statements live in `data/`, which is **gitignored**.
- This document carries no amounts, balances, counts, account identifiers, payee names or verbatim
  statement descriptors. Where a real descriptor would illustrate a point, a synthetic one that is
  structurally identical is used instead.
- Per-bank parser quirks are documented in `backend/sources/` **structurally** (which columns exist,
  which formats vary) without example values from real statements.
- Tests derive expectations from the local corpus **at runtime** and skip when it is absent.
  Any committed fixture is synthetic, not a copy of real rows.
- The account holder's own name, used by transfer-matching confidence (§4.2), lives in runtime
  configuration — never in this repository, its documentation, or committed fixtures.

### Assumptions

Some were since validated against the local corpus; the rest remain unconfirmed.

1. Reversals arrive in two incompatible shapes and need separate handling:
   - **The bank removes the row**, marking it with a reverted state in the export. Skipped entirely
     at parse time.
   - **The bank keeps the row and posts a compensating credit.** Both rows are imported and paired,
     and the credit is categorized to the same account as the original charge so the pair nets to
     zero. Any associated penalty fee is a real expense and is left alone.

   Pending rows are imported but flagged and excluded from reports until they settle.
2. Bank-charged fees become their own posting to `Expenses:Fees`, not folded into the transaction
   amount.
3. Sub-products of one institution (e.g. current vs savings) are separate accounts.
4. Accounts at the same brand in different countries are separate accounts, not one with a gap.
5. Closed accounts keep full history but are excluded from current balance and today's net worth.
6. Recurring monthly credits from a single corporate payer default to `Income:Salary`.
7. Categories are stored as colon paths, but the UI enforces exactly two levels (macro → sub).
8. Tags are free-form, flat, user-created, with no predefined list.
9. Transfer matching auto-links above a confidence threshold and suggests below it, rather than ever
   silently discarding a candidate. Linked legs post against `Assets:Transfers:Clearing` (§4.2).
10. Re-running categorization never overwrites a manually assigned category.
11. Budgets do not roll over unspent amounts month to month.
12. Net worth is the sum of `Assets:` balances in the ledger's base currency.
13. Month boundaries are calendar months in a single configured timezone. Historical data originating
    in a different timezone is not retro-corrected.
14. Single user, one hashed app password, no user table.
15. Bind address and remote-access strategy are configuration, not code: `localhost` when running
    locally, and on a VPS or Pi whatever that deployment provides (reverse proxy, tailnet). The app
    never assumes it is publicly reachable, and never requires it.
16. A file's format does not identify its account. Exports from the same institution in different
    countries can share identical headers and the same currency, so account binding is an explicit
    user mapping made once at upload and remembered — never an inference from headers. A single
    export may also carry rows for more than one account, since a sub-product such as a savings
    pocket is its own account (assumption 3), so the binding is resolved per row rather than per
    file. Sub-accounts that are later closed follow assumption 5: history retained, excluded from
    current balance.
17. Rental and similar deposits post to `Assets:Deposits Held` rather than to an expense category.
18. Where a period or account is known-missing, a `data_gap` row records it and reports render a
    visible break. Values are never interpolated across a gap. History is expected to stay
    incomplete as further statements arrive, so this is a first-class concern.

### Resolved decisions

These were open questions; each was settled by inspecting the local corpus. The findings that
settled them stay local — only the resulting rules are recorded here.

1. **Historical depth — import everything, tagged by era.** Where history spans a regime change
   (different cost of living, largely disjoint merchant set), all of it is imported and rows before
   the cutover are auto-tagged from their date. Reports default to the current era, so month-over-
   month spend shows no false step change, while older data still trains merchant memory for
   merchants that carried over.
2. **Backups — yes, in v1.** A nightly local snapshot (`VACUUM INTO` a timestamped file under
   `backups/`, retaining 14) runs on startup and daily. The statements are re-downloadable; the
   manual categorizations, rules and merchant memory are not, and nothing outside the database file
   holds them.
3. **Reversal credits net against the original charge.** Where a bank posts a failed direct debit as
   a compensating credit rather than removing the original row, the credit is categorized to the
   same expense account as the charge, so the category nets to zero without any report-level special
   case. Any penalty fee is a genuine expense and stays one. See assumption 1.
4. **Interest and savings pockets.** Interest income maps to `Income:Interest` where it occurs.
   Savings pockets are assets and count toward net worth; transfers into them are inter-account
   transfers, not spending.
5. **Deposits are assets, not spending.** Rental and similar deposits post to `Assets:Deposits Held`.
   Paying one moves an asset; getting it back moves it home. Treating either as spending or income
   puts a false spike in both the spend report and the net worth timeline.
6. **Starter taxonomy — seeded from the user's own top merchants** at bootstrap, shipped as an
   editable two-level seed file rather than a fixed list. Because merchant frequency is long-tailed,
   seeding the head resolves a large fraction of history on first import.
7. **Budget periods — calendar month for v1.** The period model stays configurable so that aligning
   periods to a payday is a configuration change rather than a rewrite.

### Still open

1. **Dominant categories in reports.** Should a category that dominates monthly spend be broken out
   separately in reports and budgets, or remain one macro among others?
2. **Outlier review.** Should large one-off transactions matching no rule be surfaced for explicit
   review at import, rather than landing silently in Uncategorized?
