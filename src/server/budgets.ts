import { eq, min } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  budgetHistory,
  budgetStatus,
  limitIn,
  spendingIn,
  validateBudget,
  validateLimitChange,
  validateRestart,
  type BudgetFields,
  type BudgetPlan,
} from "../domain/budgets.ts";
import {
  periodReport,
  reportCurrencies,
  type PeriodReport,
  type ReportData,
} from "../domain/reports.ts";
import type { Db } from "./db/index.ts";
import {
  accounts,
  budgetLimits,
  budgetRestarts,
  budgets,
  categories,
  transactions,
} from "./db/schema.ts";
import { loadReportData, monthsIn, MONTH } from "./reports.ts";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

interface WithId {
  Params: { id: number };
}

const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: "Not found" });

interface Budget {
  id: number;
  categoryId: number;
  /** The category's. */
  name: string;
  currency: string;
  plan: BudgetPlan;
}

/** The budgets with their limits and start-overs, by category name. */
function loadBudgets(db: Db, id?: number): Budget[] {
  const limits = db.select().from(budgetLimits).all();
  const restarts = db.select().from(budgetRestarts).all();
  return db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      name: categories.name,
      currency: budgets.currency,
      start: budgets.start,
    })
    .from(budgets)
    .innerJoin(categories, eq(categories.id, budgets.categoryId))
    .where(id === undefined ? undefined : eq(budgets.id, id))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    .map(({ start, ...budget }) => ({
      ...budget,
      plan: {
        start,
        limits: limits
          .filter((l) => l.budgetId === budget.id)
          .map((l) => ({ from: l.month, amount: l.amount }))
          .sort((a, b) => a.from.localeCompare(b.from)),
        restarts: restarts
          .filter((r) => r.budgetId === budget.id)
          .map((r) => r.month)
          .sort(),
      },
    }));
}

/**
 * Writes a budget's limits and start-overs as the plan has them, inside
 * the caller's database transaction.
 */
function writePlan(
  tx: Pick<Db, "insert" | "delete">,
  id: number,
  plan: BudgetPlan,
) {
  tx.delete(budgetLimits).where(eq(budgetLimits.budgetId, id)).run();
  tx.delete(budgetRestarts).where(eq(budgetRestarts.budgetId, id)).run();
  tx.insert(budgetLimits)
    .values(
      plan.limits.map((l) => ({
        budgetId: id,
        month: l.from,
        amount: l.amount,
      })),
    )
    .run();
  if (plan.restarts.length > 0) {
    tx.insert(budgetRestarts)
      .values(plan.restarts.map((month) => ({ budgetId: id, month })))
      .run();
  }
}

/**
 * The oldest month with transactions in each currency, as reports count
 * months: a budget can't start before it.
 */
function firstMonths(db: Db): Map<string, string> {
  return new Map(
    db
      .select({ currency: accounts.currency, date: min(transactions.date) })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .groupBy(accounts.currency)
      .all()
      .flatMap(({ currency, date }) =>
        date === null ? [] : [[currency, date.slice(0, 7)] as const],
      ),
  );
}

/**
 * Each month's report in one currency, worked out once, with what each
 * category spent in it.
 */
function monthly(data: ReportData, currency: string) {
  const done = new Map<
    string,
    { report: PeriodReport; spent: Map<number, number> }
  >();
  return (month: string) => {
    let found = done.get(month);
    if (!found) {
      const report = periodReport(data, currency, { from: month, to: month });
      found = { report, spent: spendingIn(report) };
      done.set(month, found);
    }
    return found;
  };
}

export function budgetRoutes(
  app: FastifyInstance,
  { db, today }: { db: Db; today: () => string },
) {
  const thisMonth = () => today().slice(0, 7);
  const monthsFor = (currency: string) => ({
    first: firstMonths(db).get(currency) ?? null,
    thisMonth: thisMonth(),
  });

  // S15, and what the forms answer: a budget month by month, up to the
  // newest month with transactions in its currency.
  const detail = (budget: Budget) => {
    const { data } = loadReportData(db);
    const inMonth = monthly(data, budget.currency);
    const spent = (month: string) =>
      inMonth(month).spent.get(budget.categoryId) ?? 0;
    const month = monthsIn(data, budget.currency).at(-1) ?? thisMonth();
    return {
      ...budget,
      month,
      thisMonth: thisMonth(),
      status: budgetStatus(budget.plan, spent, month),
      // Oldest first.
      history: budgetHistory(budget.plan, spent, month),
    };
  };

  // S14: the budgets in one currency in one month. Without a month, the
  // newest that has transactions in that currency, like the reports.
  app.get<{ Querystring: { currency?: string; month?: string } }>(
    "/api/budgets",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            currency: { type: "string" },
            month: { type: "string", pattern: MONTH },
          },
        },
      },
    },
    (req, reply) => {
      const { data } = loadReportData(db);
      const currencies = reportCurrencies(data.accounts);
      const currency = req.query.currency ?? currencies[0] ?? "EUR";
      if (req.query.currency && !currencies.includes(currency)) {
        return reply
          .code(400)
          .send({ error: `None of your accounts is in ${currency}.` });
      }
      const month =
        req.query.month ?? monthsIn(data, currency).at(-1) ?? thisMonth();
      const inMonth = monthly(data, currency);
      const all = loadBudgets(db);
      const budgeted = new Set(all.map((b) => b.categoryId));
      const firsts = firstMonths(db);

      return {
        currencies,
        currency,
        month,
        thisMonth: thisMonth(),
        budgets: all
          .filter((b) => b.currency === currency)
          .map(({ plan, ...budget }) => ({
            ...budget,
            start: plan.start,
            // The limit that month; before the budget starts, its first.
            limit: limitIn(plan, month) ?? plan.limits[0]!.amount,
            // Null before it starts.
            status: budgetStatus(
              plan,
              (m) => inMonth(m).spent.get(budget.categoryId) ?? 0,
              month,
            ),
          })),
        // What that month spent with no category: no budget counts it.
        uncategorized:
          inMonth(month).report.expenses.lines.find(
            (l) => l.categoryId === null,
          )?.amount ?? 0,
        // D7, adding: the expense categories without a budget, and the
        // oldest month a budget can start in each currency.
        available: db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.type, "expense"))
          .all()
          .filter((c) => !budgeted.has(c.id))
          .sort((a, b) =>
            a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
          ),
        firstMonths: Object.fromEntries(
          currencies.map((c) => [c, firsts.get(c) ?? null]),
        ),
      };
    },
  );

  app.get<WithId>(
    "/api/budgets/:id",
    { schema: { params: idParams } },
    (req, reply) => {
      const [budget] = loadBudgets(db, req.params.id);
      return budget ? detail(budget) : notFound(reply);
    },
  );

  // D7, adding.
  app.post<{ Body: BudgetFields }>(
    "/api/budgets",
    {
      schema: {
        body: {
          type: "object",
          required: ["categoryId", "currency", "limit", "start"],
          properties: {
            categoryId: { type: ["integer", "null"] },
            currency: { type: "string" },
            limit: { type: "string" },
            start: { type: "string" },
          },
        },
      },
    },
    (req, reply) => {
      const checked = validateBudget(req.body, {
        categories: db
          .select({ id: categories.id, type: categories.type })
          .from(categories)
          .all(),
        budgeted: new Set(
          db
            .select({ id: budgets.categoryId })
            .from(budgets)
            .all()
            .map((b) => b.id),
        ),
        currencies: reportCurrencies(
          db.select({ currency: accounts.currency }).from(accounts).all(),
        ),
        months: monthsFor,
      });
      if (!checked.ok) return reply.code(400).send({ errors: checked.errors });
      const { categoryId, currency, limit, start } = checked.value;
      const id = db.transaction((tx) => {
        const row = tx
          .insert(budgets)
          .values({ categoryId, currency, start })
          .returning({ id: budgets.id })
          .get();
        writePlan(tx, row.id, {
          start,
          limits: [{ from: start, amount: limit }],
          restarts: [],
        });
        return row.id;
      });
      return reply.code(201).send(detail(loadBudgets(db, id)[0]!));
    },
  );

  // D7, changing the limit from a month on.
  app.post<WithId & { Body: { limit: string; from: string } }>(
    "/api/budgets/:id/limits",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["limit", "from"],
          properties: {
            limit: { type: "string" },
            from: { type: "string" },
          },
        },
      },
    },
    (req, reply) => {
      const [budget] = loadBudgets(db, req.params.id);
      if (!budget) return notFound(reply);
      const checked = validateLimitChange(
        req.body,
        budget.plan,
        budget.currency,
        monthsFor(budget.currency),
      );
      if (!checked.ok) return reply.code(400).send({ errors: checked.errors });
      db.transaction((tx) => writePlan(tx, budget.id, checked.value));
      return detail({ ...budget, plan: checked.value });
    },
  );

  // D7, starting the running balance over from a month.
  app.post<WithId & { Body: { from: string } }>(
    "/api/budgets/:id/restarts",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["from"],
          properties: { from: { type: "string" } },
        },
      },
    },
    (req, reply) => {
      const [budget] = loadBudgets(db, req.params.id);
      if (!budget) return notFound(reply);
      const checked = validateRestart(
        req.body,
        budget.plan,
        monthsFor(budget.currency),
      );
      if (!checked.ok) return reply.code(400).send({ errors: checked.errors });
      db.transaction((tx) => writePlan(tx, budget.id, checked.value));
      return detail({ ...budget, plan: checked.value });
    },
  );
}
