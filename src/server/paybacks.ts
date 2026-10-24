import { eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { validateSplit, type PaybackLink } from "../domain/paybacks.ts";
import type { Db } from "./db/index.ts";
import { accounts, paybacks, transactions } from "./db/schema.ts";
import { findTransfers, linkTransfers } from "./transfers.ts";

/** Every payback linked so far, or those a transaction is a side of. */
export const loadPaybacks = (db: Db, id?: number): PaybackLink[] =>
  db
    .select({
      paymentId: paybacks.paymentId,
      expenseId: paybacks.expenseId,
      amount: paybacks.amount,
    })
    .from(paybacks)
    .where(
      id === undefined
        ? undefined
        : or(eq(paybacks.paymentId, id), eq(paybacks.expenseId, id)),
    )
    .all();

interface WithId {
  Params: { id: number };
}

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

export function paybackRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const load = (ids: number[]) =>
    ids.length === 0
      ? []
      : db
          .select({
            id: transactions.id,
            accountId: transactions.accountId,
            currency: accounts.currency,
            date: transactions.date,
            time: transactions.time,
            amount: transactions.amount,
            description: transactions.description,
            categoryId: transactions.categoryId,
            excluded: transactions.excluded,
            transferWith: transactions.transferWith,
            archivedOn: accounts.archivedOn,
          })
          .from(transactions)
          .innerJoin(accounts, eq(accounts.id, transactions.accountId))
          .where(inArray(transactions.id, ids))
          .all();
  type Row = ReturnType<typeof load>[number];

  /** Why a transaction can't be linked as a payment or an expense, if it can't. */
  const refusal = (t: Row, candidates: Map<number, unknown>) =>
    t.archivedOn
      ? "This account is archived. Unarchive it to change it."
      : t.excluded
        ? "It's excluded. Restore it to link it."
        : t.transferWith !== null
          ? "It's a transfer. Unlink it first."
          : candidates.has(t.id)
            ? "It may be a transfer. Link it or mark it as not a transfer first."
            : null;

  // S6: what a payment pays back, or what an expense got back: each link
  // with its other side, the newest first.
  app.get<WithId>(
    "/api/transactions/:id/paybacks",
    { schema: { params: idParams } },
    (req, reply) => {
      const [row] = load([req.params.id]);
      if (!row) return reply.code(404).send({ error: "Not found" });
      const links = loadPaybacks(db, row.id);
      const otherOf = (l: PaybackLink) =>
        l.paymentId === row.id ? l.expenseId : l.paymentId;
      const others = new Map(load(links.map(otherOf)).map((t) => [t.id, t]));
      return {
        total: links.reduce((sum, l) => sum + l.amount, 0),
        links: links
          .map((l) => {
            const t = others.get(otherOf(l))!;
            return {
              amount: l.amount,
              other: {
                id: t.id,
                accountId: t.accountId,
                date: t.date,
                time: t.time,
                amount: t.amount,
                description: t.description,
                categoryId: t.categoryId,
              },
            };
          })
          .sort(
            (a, b) =>
              b.other.date.localeCompare(a.other.date) ||
              (b.other.time ?? "").localeCompare(a.other.time ?? "") ||
              b.other.id - a.other.id,
          ),
      };
    },
  );

  // D9, Link payback: how much of the payment pays back each expense, as
  // typed. It replaces the split the payment had.
  app.put<WithId & { Body: { expenses: { id: number; amount: string }[] } }>(
    "/api/transactions/:id/paybacks",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["expenses"],
          properties: {
            expenses: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "amount"],
                properties: {
                  id: { type: "integer" },
                  amount: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    (req, reply) => {
      const [row] = load([req.params.id]);
      if (!row) return reply.code(404).send({ error: "Not found" });
      const { candidates } = findTransfers(db);
      const refused = refusal(row, candidates);
      if (refused) return reply.code(409).send({ error: refused });
      const fields = req.body.expenses.map(({ id, amount }) => ({
        expenseId: id,
        amount,
      }));
      // Only what can still be paid back; the rest is refused by the split.
      const expenses = new Map(
        load(fields.map((f) => f.expenseId))
          .filter((t) => refusal(t, candidates) === null)
          .map((t) => [t.id, t]),
      );
      const split = validateSplit(row, fields, expenses, loadPaybacks(db));
      if (!split.ok) return reply.code(400).send({ errors: split.errors });
      db.transaction(() => {
        db.delete(paybacks).where(eq(paybacks.paymentId, row.id)).run();
        db.insert(paybacks).values(split.value).run();
      });
      return reply.code(204).send();
    },
  );

  // S6, Unlink: a payment pays back nothing any more, or an expense gets
  // nothing back, and the other sides lose that link too. Each becomes a
  // normal transaction again, which can now link as a transfer on its own.
  app.delete<WithId>(
    "/api/transactions/:id/paybacks",
    { schema: { params: idParams } },
    (req, reply) => {
      const [row] = load([req.params.id]);
      if (!row) return reply.code(404).send({ error: "Not found" });
      const links = loadPaybacks(db, row.id);
      if (links.length === 0) {
        return reply.code(409).send({ error: "It isn't linked." });
      }
      const sides = load([
        ...new Set(links.flatMap((l) => [l.paymentId, l.expenseId])),
      ]);
      if (sides.some((t) => t.archivedOn)) {
        return reply.code(409).send({
          error: "One side is in an archived account. Unarchive it first.",
        });
      }
      db.transaction(() => {
        db.delete(paybacks)
          .where(
            or(eq(paybacks.paymentId, row.id), eq(paybacks.expenseId, row.id)),
          )
          .run();
        linkTransfers(db);
      });
      return reply.code(204).send();
    },
  );
}
