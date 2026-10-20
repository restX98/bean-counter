import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { inOrder, ledger } from "../domain/ledger.ts";
import type { Db } from "./db/index.ts";
import { accounts, transactions } from "./db/schema.ts";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

interface WithId {
  Params: { id: number };
}

export function transactionRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const findAccount = (id: number) =>
    db.select().from(accounts).where(eq(accounts.id, id)).get();

  // S4: the account's transactions, newest first, each with the balance
  // after it, and where the bank's balances disagree with the app's.
  app.get<WithId>(
    "/api/accounts/:id/transactions",
    { schema: { params: idParams } },
    (req, reply) => {
      const account = findAccount(req.params.id);
      if (!account) return reply.code(404).send({ error: "Not found" });

      const rows = db
        .select({
          id: transactions.id,
          importId: transactions.importId,
          line: transactions.line,
          date: transactions.date,
          time: transactions.time,
          amount: transactions.amount,
          description: transactions.description,
          reference: transactions.reference,
          bankBalance: transactions.bankBalance,
          excluded: transactions.excluded,
          nearMatchOf: transactions.nearMatchOf,
        })
        .from(transactions)
        .where(eq(transactions.accountId, account.id))
        .all()
        .map((row) => ({ ...row, keptNearMatch: row.nearMatchOf !== null }));

      // Every import sets an anchor, so an account with transactions has one.
      const { entries, gaps, offDays } =
        account.anchorAmount !== null && account.anchorDate !== null
          ? ledger(
              { amount: account.anchorAmount, date: account.anchorDate },
              rows,
            )
          : {
              entries: inOrder(rows).map((row) => ({ ...row, balance: null })),
              gaps: [],
              offDays: [],
            };
      return {
        transactions: entries.toReversed().map((t) => ({
          id: t.id,
          date: t.date,
          time: t.time,
          amount: t.amount,
          description: t.description,
          reference: t.reference,
          bankBalance: t.bankBalance,
          excluded: t.excluded,
          nearMatchOf: t.nearMatchOf,
          balance: t.balance,
        })),
        gaps: gaps.map(({ suspects, ...gap }) => ({
          ...gap,
          suspects: suspects.map(({ reason, transaction: t }) => ({
            reason,
            id: t.id,
            date: t.date,
            amount: t.amount,
            description: t.description,
          })),
        })),
        offDays,
      };
    },
  );

  // Excluding takes a transaction out of balances, reports and budgets; it
  // stays listed, greyed out, and still counts as a duplicate on re-import.
  const setExcluded =
    (excluded: boolean) =>
    (req: FastifyRequest<WithId>, reply: FastifyReply) => {
      const row = db
        .select({ id: transactions.id, accountId: transactions.accountId })
        .from(transactions)
        .where(eq(transactions.id, req.params.id))
        .get();
      if (!row) return reply.code(404).send({ error: "Not found" });
      if (findAccount(row.accountId)?.archivedOn) {
        return reply.code(409).send({
          error: "This account is archived. Unarchive it to change it.",
        });
      }
      db.update(transactions)
        .set({ excluded })
        .where(eq(transactions.id, row.id))
        .run();
      return reply.code(204).send();
    };
  app.post<WithId>(
    "/api/transactions/:id/exclude",
    { schema: { params: idParams } },
    setExcluded(true),
  );
  app.post<WithId>(
    "/api/transactions/:id/restore",
    { schema: { params: idParams } },
    setExcluded(false),
  );
}
