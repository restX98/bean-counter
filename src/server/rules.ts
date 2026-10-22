import { and, count, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  findOverlaps,
  ruleChecker,
  ruleEffect,
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
/** Saving can also categorize the uncategorized transactions it concerns. */
const saveSchema = {
  ...fieldsSchema,
  properties: {
    ...fieldsSchema.properties,
    apply: { type: "boolean" },
    settle: { type: "boolean" },
  },
} as const;
/** The preview of a new rule (id null) or of an edit. */
const previewSchema = {
  ...fieldsSchema,
  required: [...fieldsSchema.required, "id"],
  properties: {
    ...fieldsSchema.properties,
    id: { type: ["integer", "null"] },
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

interface SaveOptions {
  /** Categorize the uncategorized transactions it matches. */
  apply?: boolean;
  /** Editing: categorize the conflicts it no longer takes part in. */
  settle?: boolean;
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

/** Every rule, oldest first. */
export const loadRules = (db: Db): Rule[] =>
  db.select().from(rules).orderBy(rules.id).all().map(toRule);

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
  const all = () => loadRules(db);
  const targets = () =>
    db
      .select({
        id: transactions.id,
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
  /**
   * The transactions a rule may still categorize: counted ones without a
   * category, in accounts that aren't archived.
   */
  const uncategorized = () =>
    db
      .select({
        id: transactions.id,
        description: transactions.description,
        amount: transactions.amount,
        accountId: transactions.accountId,
        currency: accounts.currency,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          isNull(transactions.categoryId),
          eq(transactions.excluded, false),
          isNull(accounts.archivedOn),
        ),
      )
      .all();
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
    const list = all();
    const known = targets();
    const byAccount = currencies();
    const overlaps = findOverlaps(list, known, (id) => byAccount.get(id));
    const matches = new Map(
      db
        .select({ id: transactions.ruleId, n: count() })
        .from(transactions)
        .groupBy(transactions.ruleId)
        .all()
        .map(({ id, n }) => [id, n]),
    );
    const check = ruleChecker(list);
    return {
      rules: list.map((rule) => ({
        ...rule,
        matches: matches.get(rule.id) ?? 0,
        overlaps: overlaps.get(rule.id) ?? [],
      })),
      conflicts: known.filter(
        (t) =>
          t.categoryId === null && !t.excluded && check(t).kind === "conflict",
      ).length,
    };
  });

  /**
   * Saves a rule, a new one when `id` is null, then categorizes the
   * transactions the options ask for.
   */
  const save = (
    rule: RuleCondition & { categoryId: number },
    id: number | null,
    { apply = false, settle = false }: SaveOptions,
  ) =>
    db.transaction((tx) => {
      const before = all();
      const columns = toColumns(rule);
      const saved = toRule(
        id === null
          ? tx.insert(rules).values(columns).returning().get()
          : tx
              .update(rules)
              .set(columns)
              .where(eq(rules.id, id))
              .returning()
              .get()!,
      );
      const effect = ruleEffect(before, saved, uncategorized());
      for (const t of [
        ...(apply ? effect.matching : []),
        ...(settle ? effect.settled : []),
      ]) {
        tx.update(transactions)
          .set({ categoryId: t.categoryId, ruleId: t.ruleId })
          .where(eq(transactions.id, t.id))
          .run();
      }
      return saved;
    });

  // D6, adding.
  app.post<{ Body: RuleFields & SaveOptions }>(
    "/api/rules",
    { schema: { body: saveSchema } },
    (req, reply) => {
      const rule = validate(req.body);
      if (!rule.ok) return reply.code(400).send({ errors: rule.errors });
      return reply.code(201).send(save(rule.value, null, req.body));
    },
  );

  // D6, editing. Categories it already gave stay as they are.
  app.patch<WithId & { Body: RuleFields & SaveOptions }>(
    "/api/rules/:id",
    { schema: { params: idParams, body: saveSchema } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      const rule = validate(req.body);
      if (!rule.ok) return reply.code(400).send({ errors: rule.errors });
      return save(rule.value, row.id, req.body);
    },
  );

  // D6, while typing: what saving would do. Nothing when the form isn't
  // valid yet; its errors show when it's saved.
  app.post<{ Body: RuleFields & { id: number | null } }>(
    "/api/rules/preview",
    { schema: { body: previewSchema } },
    (req, reply) => {
      const { id } = req.body;
      if (id !== null && !find(id)) return notFound(reply);
      const valid = validate(req.body);
      if (!valid.ok) return { valid: false };
      const list = all();
      const rule = {
        ...valid.value,
        id: id ?? Math.max(0, ...list.map((r) => r.id)) + 1,
      };
      const effect = ruleEffect(list, rule, uncategorized());
      const settled = new Map<number, number>();
      for (const { categoryId } of effect.settled) {
        settled.set(categoryId, (settled.get(categoryId) ?? 0) + 1);
      }
      const byAccount = currencies();
      const overlaps = findOverlaps(
        [...list.filter((r) => r.id !== rule.id), rule],
        targets(),
        (account) => byAccount.get(account),
      );
      return {
        valid: true,
        matching: effect.matching.length,
        conflicts: effect.conflicts,
        settled: [...settled].map(([categoryId, count]) => ({
          categoryId,
          count,
        })),
        overlaps: overlaps.get(rule.id) ?? [],
      };
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
