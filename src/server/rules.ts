import { count, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  findOverlaps,
  ruleChecker,
  validateRule,
  type Rule,
  type RuleCondition,
  type RuleFields,
} from "../domain/rules.ts";
import type { Db } from "./db/index.ts";
import { accounts, categories, rules, transactions } from "./db/schema.ts";

const fieldsSchema = {
  type: "object",
  required: [
    "match",
    "text",
    "accountId",
    "min",
    "max",
    "currency",
    "categoryId",
  ],
  properties: {
    match: { type: "string" },
    text: { type: "string" },
    accountId: { type: ["integer", "null"] },
    min: { type: "string" },
    max: { type: "string" },
    currency: { type: "string" },
    categoryId: { type: ["integer", "null"] },
  },
} as const;
const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

interface WithId {
  Params: { id: number };
}

type Row = typeof rules.$inferSelect;

function toRule(row: Row): Rule {
  return {
    id: row.id,
    match: row.match,
    text: row.text,
    accountId: row.accountId,
    amount:
      row.amountCurrency === null
        ? null
        : {
            currency: row.amountCurrency,
            min: row.amountMin,
            max: row.amountMax,
          },
    categoryId: row.categoryId,
  };
}

const toColumns = (rule: RuleCondition & { categoryId: number }) => ({
  match: rule.match,
  text: rule.text,
  accountId: rule.accountId,
  amountCurrency: rule.amount?.currency ?? null,
  amountMin: rule.amount?.min ?? null,
  amountMax: rule.amount?.max ?? null,
  categoryId: rule.categoryId,
});

const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: "Not found" });

export function ruleRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const find = (id: number) =>
    db.select().from(rules).where(eq(rules.id, id)).get();
  const currencies = () =>
    new Map(
      db
        .select({ id: accounts.id, currency: accounts.currency })
        .from(accounts)
        .all()
        .map(({ id, currency }) => [id, currency]),
    );
  const validate = (fields: RuleFields) =>
    validateRule(fields, {
      accounts: currencies(),
      categoryIds: new Set(
        db
          .select({ id: categories.id })
          .from(categories)
          .all()
          .map((c) => c.id),
      ),
    });

  // S17: every rule, with how many transactions it categorized and the
  // rules it overlaps, and how many transactions the rules can't decide.
  app.get("/api/rules", () => {
    const all = db.select().from(rules).orderBy(rules.id).all().map(toRule);
    const targets = db
      .select({
        description: transactions.description,
        amount: transactions.amount,
        accountId: transactions.accountId,
        currency: accounts.currency,
        categoryId: transactions.categoryId,
        excluded: transactions.excluded,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .all();
    const byAccount = currencies();
    const overlaps = findOverlaps(all, targets, (id) => byAccount.get(id));
    const matches = new Map(
      db
        .select({ id: transactions.ruleId, n: count() })
        .from(transactions)
        .groupBy(transactions.ruleId)
        .all()
        .map(({ id, n }) => [id, n]),
    );
    const check = ruleChecker(all);
    return {
      rules: all.map((rule) => ({
        ...rule,
        matches: matches.get(rule.id) ?? 0,
        overlaps: overlaps.get(rule.id) ?? [],
      })),
      conflicts: targets.filter(
        (t) =>
          t.categoryId === null && !t.excluded && check(t).kind === "conflict",
      ).length,
    };
  });

  // D6, adding.
  app.post<{ Body: RuleFields }>(
    "/api/rules",
    { schema: { body: fieldsSchema } },
    (req, reply) => {
      const rule = validate(req.body);
      if (!rule.ok) return reply.code(400).send({ errors: rule.errors });
      const row = db
        .insert(rules)
        .values(toColumns(rule.value))
        .returning()
        .get();
      return reply.code(201).send(toRule(row));
    },
  );

  // D6, editing. Categories it already gave stay as they are.
  app.patch<WithId & { Body: RuleFields }>(
    "/api/rules/:id",
    { schema: { params: idParams, body: fieldsSchema } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      const rule = validate(req.body);
      if (!rule.ok) return reply.code(400).send({ errors: rule.errors });
      return toRule(
        db
          .update(rules)
          .set(toColumns(rule.value))
          .where(eq(rules.id, row.id))
          .returning()
          .get()!,
      );
    },
  );

  // Deleting a rule doesn't change the categories it already gave.
  app.delete<WithId>(
    "/api/rules/:id",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      db.delete(rules).where(eq(rules.id, row.id)).run();
      return reply.code(204).send();
    },
  );
}
