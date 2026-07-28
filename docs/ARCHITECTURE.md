# bean-counter — Architecture

Technical design for v1. Implements [PRD.md](PRD.md); where this document departs from the PRD, the
reason is stated inline and the PRD is the thing that should be updated.

> **Note on data.** As with the PRD, this document contains no amounts, balances, account
> identifiers or payee names. Descriptor examples below are **synthetic** — structurally accurate,
> not copied from real statements.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | Python 3.12+ | `Protocol`, `Decimal`, no runtime deps for the DB layer |
| API | FastAPI + uvicorn | Typed request/response models, one process, no container needed |
| Database | SQLite via stdlib `sqlite3` | Single file, portable, trivially backed up. Invariants live in DDL |
| Data access | Hand-written SQL + thin repository modules | The design is constraint- and view-centric; an ORM would obscure the parts that matter |
| Migrations | Numbered forward-only `.sql` files | No dependency, readable diffs, trivial to reason about |
| Frontend | React + Vite + TypeScript | SPA over a JSON API |
| Server state | TanStack Query | Caching and invalidation for triage screens that mutate constantly |
| Packaging | `uv` | Single lockfile, fast, no virtualenv ceremony |

Money is `Decimal` at the boundary and **signed integer minor units** in the database. Never float,
at any layer, including JSON — amounts cross the API as integers plus a currency code.

## 2. Layout

```
backend/
  main.py             FastAPI app; mounts /api, serves the built SPA
  config.py           base currency, timezone, era cutover, own-name list — all env
  db/
    conn.py           connection factory; PRAGMA foreign_keys=ON, WAL, Row factory
    schema.sql        full DDL (authoritative)
    migrations/       001_init.sql, 002_*.sql — forward-only
  repo/               accounts, transactions, rules, merchants, budgets, reports
  sources/
    base.py           TransactionSource protocol, RawTxn
    registry.py       sniff dispatch
    aib.py  revolut.py
  domain/
    money.py          Decimal <-> minor units, currency handling
    normalize.py      descriptor normalization
    dedup.py
    reversals.py      pass 1
    transfers.py      pass 2
    categorize.py     pass 3 — suggester chain
    eras.py  gaps.py  recurring.py
  api/                routers, one per resource
  backup.py
frontend/
  src/                pages, components, api client
  vite.config.ts
data/                 statements — gitignored
backups/              snapshots — gitignored
bean.db
```

## 3. Schema

Full DDL lives in `db/schema.sql`. The parts that carry design weight:

```sql
CREATE TABLE account (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,              -- 'Assets:Bank:Current'
  kind        TEXT NOT NULL CHECK (kind IN ('asset','expense','income','equity')),
  currency    TEXT NOT NULL CHECK (length(currency) = 3),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_date TEXT,
  institution TEXT
);

CREATE TABLE txn (
  id       INTEGER PRIMARY KEY,
  date     TEXT NOT NULL,                        -- ISO-8601
  payee    TEXT,
  note     TEXT,
  batch_id INTEGER REFERENCES import_batch(id) ON DELETE CASCADE,
  status   TEXT NOT NULL DEFAULT 'settled' CHECK (status IN ('settled','pending'))
);

CREATE TABLE posting (
  id         INTEGER PRIMARY KEY,
  txn_id     INTEGER NOT NULL REFERENCES txn(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES account(id),
  amount     INTEGER NOT NULL,                   -- minor units, signed
  currency   TEXT NOT NULL CHECK (length(currency) = 3)
);
```

`import_batch` → `txn` → `posting` cascades on delete, which gives PRD invariant 4 for free.

### 3.1 The zero-sum invariant

PRD `:60` says the sum is "enforced by constraint". **SQLite cannot express this as a CHECK** — a
transaction's postings are inserted one row at a time, so any row-level check fails on the first
insert, and SQLite has no deferred constraints. The honest equivalent is three layers:

1. The repository writes a txn and all its postings inside one SQL transaction and asserts the sum
   before `COMMIT`. Nothing else may write postings.
2. A permanent view exposes any drift:

```sql
CREATE VIEW v_unbalanced AS
SELECT txn_id, SUM(amount) AS delta, COUNT(*) AS n
FROM posting GROUP BY txn_id HAVING delta <> 0 OR n < 2;
```

3. Startup and the test suite assert `v_unbalanced` is empty.

This is a real deviation from the PRD's wording and should be corrected there.

### 3.2 Dedup

```sql
CREATE TABLE raw_row (
  id               INTEGER PRIMARY KEY,
  batch_id         INTEGER NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  txn_id           INTEGER REFERENCES txn(id) ON DELETE SET NULL,
  line_no          INTEGER NOT NULL,
  raw              TEXT NOT NULL,                -- original line, verbatim
  account_id       INTEGER NOT NULL REFERENCES account(id),
  posted_date      TEXT NOT NULL,
  description_norm TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  running_balance  INTEGER
);

CREATE UNIQUE INDEX ux_raw_dedup
  ON raw_row (account_id, posted_date, description_norm, amount, running_balance);
```

Import inserts and catches `IntegrityError` — a collision *is* a duplicate, counted and skipped. No
separate lookup pass.

`running_balance` is load-bearing exactly as PRD `:151` claims; the corpus contains same-day rows
identical in every other field, distinguishable only by balance. It is deliberately **nullable**:
SQLite treats NULLs as distinct in unique indexes, so a future source without a balance column
fails *open* (imports possible duplicates) rather than *closed* (silently discards real rows). That
is the correct direction to fail, and it is the whole reason the column is in the key.

### 3.3 Remaining tables

`tag` / `txn_tag` (many-to-many, cascade) · `merchant` (`norm_key` unique → learned `account_id`,
confirmation count) · `rule` (precedence, matcher kind, pattern or amount range → account) ·
`suggestion` (txn, account, confidence, reason, source, resolution) · `budget` · `data_gap`
(account, from/to, reason) · `txn_link` (see §5) · `v_flat` per PRD `:88-94`.

## 4. Import

```
upload → sniff format → resolve accounts → parse → normalize → dedup → persist batch
       → pass 1 reversals → pass 2 transfers → pass 3 categorize → summary
```

### 4.1 The `TransactionSource` protocol — corrected

The PRD's `sniff(headers) -> bool` (`:118`) cannot do the job. Two files from the same institution
in different countries have **byte-identical headers and the same currency**, so neither headers nor
currency identify the account. Separately, one file can contain rows for more than one account
(a `Product`-style column splitting current from savings).

Format detection and account binding are therefore different problems:

```python
class TransactionSource(Protocol):
    name: str

    def sniff(self, headers: list[str]) -> bool:
        """Claim files whose column set this parser recognises."""

    def discriminators(self, f) -> list[str]:
        """Distinct per-row account discriminators present in this file.
        Empty list means the whole file maps to a single account."""

    def parse(self, f) -> Iterable[RawTxn]:
        """Emit normalised rows, each carrying its discriminator."""
```

```python
@dataclass(frozen=True)
class RawTxn:
    discriminator: str | None   # resolved to an account by the caller
    date: date
    description: str
    amount: Decimal             # signed
    currency: str
    running_balance: Decimal | None
    state: str | None           # settled / pending / reverted
    fee: Decimal | None
    kind: str | None            # card payment, ATM, transfer, direct debit...
    line_no: int
    raw: str
```

**Account binding is a UI step, not an inference.** On upload the server sniffs the format, lists
the discriminators found, and asks which account each maps to. The mapping is stored keyed by
`(source, discriminator)` and reused silently on every subsequent import. One question, once.

Adding a bank API in v2 implements the same protocol — `discriminators` returns the accounts the API
exposes.

### 4.2 Parser rules

Verified against the local corpus; each traces to a named column.

| Concern | Rule |
|---|---|
| Dates | Per-source and explicit. One source uses `DD/MM/YYYY`, another ISO. **Never infer** — `01/04/2026` is ambiguous and guessing silently reorders history |
| Enum casing | One source's type column changes case *within a single file* (both `Title Case` and `UPPER_CASE` rows). Normalize unconditionally; never branch on file or date range |
| Signed amounts | Sources with separate debit/credit columns collapse to one signed value; sources with a signed column pass through |
| Fees | A non-zero fee column emits a **second posting** to `Expenses:Fees` (PRD assumption 2), not an adjustment to the main amount |
| Row state | `reverted` → skip the row entirely; `pending` → import, flag `status='pending'`, exclude from reports until settled |
| Truncation | At least one source truncates the merchant field to ~18 characters. This is precisely the prefix-matching case in PRD `:177` |

### 4.3 Descriptor normalization

`domain/normalize.py`, per source, applied before dedup and before merchant lookup:

1. Strip the trailing bank reference (`IE` + 14 digits, or equivalent) and any ` TxnDate: …` suffix.
2. Strip the leading channel prefix — a **closed set** per source (internet banking, mobile banking,
   card payment, card purchase, direct debit, fee, ATM). Closed set, not a regex guess.
3. Strip masked card fragments (`**1234*`), collapse whitespace, uppercase.
4. Classify before truncating — see below.
5. Truncate to a **13-character** match prefix.

**Order matters, and getting it wrong is silent.** Own-name detection and self-transfer exclusion
must run on the *full* normalized string at step 4, before truncation at step 5. Truncating first
clips the surname out of `TO <FULL NAME>` descriptors, and self-transfers then rank as the largest
merchant in the corpus — measured, not hypothetical.

The 13-character width is chosen, not arbitrary: one source truncates its merchant field to ~18
characters while another emits the full name, so the same merchant arrives under two keys. 13
characters is the widest prefix that still merges every such pair in the corpus. Regression-test it
against those pairs; widening the prefix silently splits merchants back apart.

Synthetic worked example:

```
raw   *MOBI GROCERY STORE IE26010112345678 TxnDate: 01Jan2026
  1   *MOBI GROCERY STORE
  2   GROCERY STORE
  3/4 GROCERY STORE
```

The original line is preserved verbatim in `raw_row.raw` regardless — normalization is never lossy
in the sense that matters.

## 5. Post-import passes

### 5.1 Pass 1 — reversal pairing

Two banks express a reversal in incompatible ways, and PRD assumption 1 (`:230`) currently covers
only the first:

- **Bank removes the row.** The export carries a `reverted` state; the row is skipped at parse time.
- **Bank keeps the row and posts a compensating credit.** Original charge stays; a credit of equal
  magnitude appears within a day or two, sometimes with a separate penalty fee.

For the second case, pair on `(same account, opposite sign, equal amount, ≤3 days)` where one side
is a compensating-credit kind. **Then categorize the credit to the same expense account as the
original charge.** Double-entry does the rest: the category nets to zero without any report-level
special case. Any penalty fee is a genuine expense and is left alone.

Record the pair in `txn_link(kind='reversal')` for explainability.

### 5.2 Pass 2 — transfer matching, via a clearing account

**Deviation from the PRD, and the reason matters.** PRD `:163` merges a matched transfer into one
transaction with two `Assets:` postings. But the two sides arrive in *different files*, hence
different `import_batch` rows — and PRD invariant 4 requires deleting a batch to delete exactly the
transactions it created. A merged transaction belongs to two batches at once, so merging and
invariant 4 cannot both hold.

Instead, every transfer leg posts against `Assets:Transfers:Clearing`:

```
leg A (bank 1)   Assets:Bank1:Current       -10000
                 Assets:Transfers:Clearing  +10000
leg B (bank 2)   Assets:Bank2:Current       +10000
                 Assets:Transfers:Clearing  -10000
```

This is strictly better than merging:

- Each transaction stays owned by exactly one batch — invariant 4 holds, undo stays exact.
- Neither posting touches `Expenses:`, so transfers stay out of spending reports structurally,
  which is what PRD `:165` actually wanted.
- A matched pair nets the clearing account to zero. An **unmatched** leg leaves a non-zero clearing
  balance — which is *correct*: that is money genuinely in transit, or a missing counterpart. The
  clearing balance becomes a health metric instead of a silent error.

Matching parameters, measured against the full corpus rather than assumed:

- **Window ±5 days, not the PRD's ±3.** Observed lag across every cross-institution transfer in the
  corpus: `0d`, `1d` and `2d` dominate, with a tail at `3d` and `5d`. ±3 catches 98.9%; ±5 catches
  100%. The two stragglers are ordinary weekend settlement.
- **Return candidate sets, never first-match.** Round-number transfers repeat on the same day with
  identical amounts and descriptions. Rank candidates by balance consistency, then date proximity.
- Confidence rises when the descriptor contains a configured own-name (`config.own_names`, from env
  — never committed) or a known inter-account pattern.
- Above threshold, link automatically; below, surface for confirmation. Never discard.

### 5.3 Pass 3 — categorization

Chain per PRD `:169-174`: explicit rule → merchant memory → uncategorized. Each link returns
`(account, confidence, reason)` and writes a `suggestion`; nothing is applied over a manual
assignment (invariant 3).

One addition the corpus forces: **merchant memory structurally cannot learn the largest recurring
expense.** Where a payment carries a human-typed reference, the descriptor changes every month —
the payee's name one month, the month's name the next, an agent's name the third. Prefix matching
cannot group these, and no amount of correction will teach it. Such payments need either an explicit
user rule or amount+periodicity detection. The `rule` table therefore supports an `amount_range`
matcher and a `periodic` matcher, not only string matchers.

### 5.3.1 Seeding, and what may be committed

Seeding has two halves with **different privacy properties**, and they must not share a file:

| | Contents | Committed? |
|---|---|---|
| `seeds/categories.yaml` | The category tree only — macro/sub paths | **Yes.** Generic, no personal data |
| Merchant → category map | Normalized merchant keys mapped to categories | **No.** Merchant names are personal data |

The tree is a fixed, generic two-level taxonomy. The mapping is derived from the user's own history
and is loaded from a local file outside version control, or entered through the triage UI, landing
in the `merchant` table either way. A merchant map in the repository would leak spending habits as
surely as committing the statements.

Because the head of the distribution is steep — the top 25 merchants cover roughly 40% of merchant
transactions — seeding that head resolves a large fraction of history on first import.

### 5.4 Deposits

Rental and similar deposits get `Assets:Deposits Held`, not an expense category. Paying a deposit
moves an asset; getting it back moves it home. Categorizing either as spending or income puts a
visible false spike in both the spend report and net worth. Currently unmodelled in the PRD.

### 5.5 Eras and gaps

`eras.py` tags each transaction at import from its date against a configured cutover, so reports
default to the current era and month-over-month spend does not show a fake step change where the
underlying regime shifted. Older data still trains merchant memory for merchants that carried over.

`data_gap` rows mark known-missing periods. The net worth timeline renders them as visible breaks —
**never interpolate across a gap.** History is incomplete and more statements will arrive, so this
is a first-class feature, not bookkeeping hygiene.

## 6. API

```
POST   /api/import                 upload; returns detected format + discriminators
POST   /api/import/{id}/confirm    account mapping; runs the pipeline, returns the summary
GET    /api/batches                DELETE /api/batches/{id}   → exact undo
GET    /api/transactions           filter: date, account, category, tag, state, era
PATCH  /api/transactions/{id}      manual category, payee, note, tags
GET    /api/suggestions            POST /api/suggestions/{id}/{accept|reject}
GET    /api/links                  unconfirmed transfer + reversal candidates
GET    POST  /api/accounts  /api/rules  /api/budgets  /api/tags
GET    /api/reports/spend          by category, month over month, tag-filterable
GET    /api/reports/recurring      merchant periodicity, price drift, stops
GET    /api/reports/networth       asset balances over time, gap-annotated
GET    /api/health                 includes v_unbalanced count and clearing balance
```

All amounts serialize as `{ "minor": -1234, "currency": "EUR" }`. No decimal strings, no floats.

## 7. Frontend

Six screens: **Import** (drop file → confirm account mapping → batch summary with undo),
**Triage** (uncategorized queue, grouped by merchant so one decision applies retroactively),
**Transactions** (filterable ledger), **Reports**, **Budgets**, **Accounts & Rules**.

The triage screen is the one that decides whether the tool gets used, because it is where the long
tail is paid down. It groups by normalized merchant, shows the whole group's transaction count and
total, and applies one keystroke to all of them.

## 8. Backups

`backup.py` runs `VACUUM INTO backups/bean-YYYY-MM-DD.db` on startup and once daily, retaining 14.
Cheap, atomic, no external dependency, and it protects the thing that is genuinely irreplaceable:
manual categorizations, rules and merchant memory. The statements themselves are re-downloadable.

## 9. Configuration

Env only, via `pydantic-settings`: base currency, timezone, era cutover date, own-name list, bind
address, app password hash, backup retention. **No personal identifier ever reaches the repository,
its documentation, or committed fixtures.** Bind address and remote access are configuration, never
code, per PRD assumption 15.

## 10. Testing

- **Unit** — normalization, minor-unit conversion, dedup key construction, matching windows. Pure
  functions, synthetic input, always run.
- **Corpus** — parser and pipeline tests derive expectations from `data/` **at runtime** and
  `pytest.skip` when it is absent (PRD `:225`). They assert invariants, not values: postings balance,
  batch delete is exact, every cross-institution transfer matches within the window, same-day
  identical rows all survive dedup, `v_unbalanced` is empty.
- **Fixtures** — any committed CSV is synthetic and structurally derived, never copied rows.

## 11. Build order

1. Schema, migrations, `money.py`, repository layer, `v_unbalanced` check
2. `TransactionSource`, both parsers, normalization, import batch + exact undo
3. Dedup, then pass 1 reversals, then pass 2 transfers with the clearing account
4. Categorization chain, seed taxonomy, merchant memory
5. Reports, budgets, net worth with gap annotation
6. React SPA — import, triage, reports
7. Backups

Each step is independently verifiable against the corpus before the next begins.

## 12. PRD corrections this design implies

1. `:60` — the zero-sum rule is enforced by repository + view + startup check, not a CHECK
   constraint. SQLite cannot do the latter.
2. `:118` — `sniff(headers)` identifies a format, not an account. Account binding is per row.
3. `:163` — transfers post to a clearing account rather than merging, because merging conflicts
   with invariant 4.
4. `:159` — the default matching window should be ±5 days, not ±3.
5. `:230` — assumption 1 covers two incompatible reversal mechanisms and must be split.
6. Deposits held are unmodelled and need an asset account.
