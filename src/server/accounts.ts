import { eq, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  validateAccount,
  validateAnchor,
  type Account,
  type AccountFields,
  type AnchorFields,
  type FieldErrors,
} from "../domain/accounts.ts";
import { currentBalance, type Posted } from "../domain/balances.ts";
import { formatAmount, rescale } from "../domain/money.ts";
import type { Db } from "./db/index.ts";
import { accounts, transactions } from "./db/schema.ts";

type Row = typeof accounts.$inferSelect;

function toAccount(row: Row, posted: Posted[]): Account {
  const anchor =
    row.anchorAmount !== null &&
    row.anchorDate !== null &&
    row.anchorSource !== null
      ? {
          amount: row.anchorAmount,
          date: row.anchorDate,
          source: row.anchorSource,
        }
      : null;
  return {
    id: row.id,
    name: row.name,
    bank: row.bank,
    type: row.type,
    currency: row.currency,
    anchor,
    archivedOn: row.archivedOn,
    balance: anchor && toBalance(currentBalance(anchor, posted)),
    transactionCount: posted.length,
  };
}

const toBalance = ({ date, balance }: { date: string; balance: number }) => ({
  amount: balance,
  date,
});

const text = { type: "string" } as const;
const fieldsSchema = {
  name: text,
  bank: text,
  type: text,
  currency: text,
} as const;
const anchorSchema = {
  type: "object",
  required: ["amount", "date"],
  properties: { amount: text, date: text },
} as const;
const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

interface WithId {
  Params: { id: number };
}

const invalid = (reply: FastifyReply, errors: FieldErrors) =>
  reply.code(400).send({ errors });
const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: "Not found" });
const archived = (reply: FastifyReply) =>
  reply
    .code(409)
    .send({ error: "This account is archived. Unarchive it to change it." });

export function accountRoutes(
  app: FastifyInstance,
  { db, today }: { db: Db; today: () => string },
) {
  const find = (id: number) =>
    db.select().from(accounts).where(eq(accounts.id, id)).get();
  // A new query each time: where() changes the query it's called on.
  const postedIn = (id?: number) =>
    db
      .select({
        accountId: transactions.accountId,
        date: transactions.date,
        amount: transactions.amount,
        excluded: transactions.excluded,
      })
      .from(transactions)
      .where(id === undefined ? undefined : eq(transactions.accountId, id))
      .all();
  const present = (row: Row) => toAccount(row, postedIn(row.id));
  const otherNames = (id?: number) =>
    db
      .select({ name: accounts.name })
      .from(accounts)
      .where(id === undefined ? undefined : ne(accounts.id, id))
      .all()
      .map((r) => r.name);
  const update = (id: number, values: Partial<Row>) =>
    present(
      db
        .update(accounts)
        .set(values)
        .where(eq(accounts.id, id))
        .returning()
        .get()!,
    );

  app.get("/api/accounts", () => {
    const all = new Map<number, Posted[]>();
    for (const t of postedIn()) {
      all.set(t.accountId, [...(all.get(t.accountId) ?? []), t]);
    }
    return {
      accounts: db
        .select()
        .from(accounts)
        .orderBy(accounts.id)
        .all()
        .map((row) => toAccount(row, all.get(row.id) ?? [])),
    };
  });

  app.get<WithId>(
    "/api/accounts/:id",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = find(req.params.id);
      return row ? present(row) : notFound(reply);
    },
  );

  // D1, adding: the balance anchor is optional.
  app.post<{ Body: AccountFields & { anchor?: AnchorFields } }>(
    "/api/accounts",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "bank", "type", "currency"],
          properties: { ...fieldsSchema, anchor: anchorSchema },
        },
      },
    },
    (req, reply) => {
      const { anchor: anchorFields, ...fields } = req.body;
      const account = validateAccount(fields, otherNames());
      const errors = account.ok ? {} : { ...account.errors };
      let anchor: { amount: number; date: string } | undefined;
      // Without a valid currency the amount can't be read: that error comes first.
      if (anchorFields?.amount.trim() && !errors.currency) {
        const checked = validateAnchor(anchorFields, fields.currency, today());
        if (checked.ok) anchor = checked.value;
        else Object.assign(errors, checked.errors);
      }
      if (!account.ok || Object.keys(errors).length > 0) {
        return invalid(reply, errors);
      }
      const row = db
        .insert(accounts)
        .values({
          ...account.value,
          anchorAmount: anchor?.amount ?? null,
          anchorDate: anchor?.date ?? null,
          anchorSource: anchor ? "manual" : null,
        })
        .returning()
        .get();
      return reply.code(201).send(present(row));
    },
  );

  // D1, editing. The anchor changes only through Set balance.
  app.patch<WithId & { Body: AccountFields }>(
    "/api/accounts/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["name", "bank", "type", "currency"],
          properties: fieldsSchema,
        },
      },
    },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      if (row.archivedOn) return archived(reply);

      const account = validateAccount(req.body, otherNames(row.id));
      if (!account.ok) return invalid(reply, account.errors);
      if (account.value.currency !== row.currency && postedIn(row.id).length) {
        return invalid(reply, {
          currency:
            "The currency can't change once the account has transactions.",
        });
      }

      // A new currency keeps the anchor's written amount: 1,120.00 € becomes
      // 1,120.00 $. Nothing is converted.
      let anchorAmount = row.anchorAmount;
      if (anchorAmount !== null && account.value.currency !== row.currency) {
        const moved = rescale(
          anchorAmount,
          row.currency,
          account.value.currency,
        );
        if (moved === undefined) {
          return invalid(reply, {
            currency: `The balance anchor, ${formatAmount(anchorAmount, row.currency)}, can't be written exactly in ${account.value.currency}. Set the balance again first.`,
          });
        }
        anchorAmount = moved;
      }
      return update(row.id, { ...account.value, anchorAmount });
    },
  );

  // D2, Set balance: the new balance becomes the anchor. Comparing it with
  // the app's own balance first comes with the account's transactions page.
  app.put<WithId & { Body: AnchorFields }>(
    "/api/accounts/:id/anchor",
    { schema: { params: idParams, body: anchorSchema } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      if (row.archivedOn) return archived(reply);

      const anchor = validateAnchor(req.body, row.currency, today());
      if (!anchor.ok) return invalid(reply, anchor.errors);
      return update(row.id, {
        anchorAmount: anchor.value.amount,
        anchorDate: anchor.value.date,
        anchorSource: "manual",
      });
    },
  );

  // D3. Archiving twice keeps the first date.
  app.post<WithId>(
    "/api/accounts/:id/archive",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      return row.archivedOn
        ? present(row)
        : update(row.id, { archivedOn: today() });
    },
  );

  app.post<WithId>(
    "/api/accounts/:id/unarchive",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      return update(row.id, { archivedOn: null });
    },
  );
}
