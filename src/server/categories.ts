import { and, count, eq, isNull, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  validateCategory,
  type Category,
  type CategoryFields,
} from "../domain/categories.ts";
import type { Db } from "./db/index.ts";
import { budgets, categories, rules, transactions } from "./db/schema.ts";

const fieldsSchema = {
  type: "object",
  required: ["name", "type"],
  properties: { name: { type: "string" }, type: { type: "string" } },
} as const;
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

export function categoryRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const find = (id: number) =>
    db.select().from(categories).where(eq(categories.id, id)).get();
  const otherNames = (id?: number) =>
    db
      .select({ name: categories.name })
      .from(categories)
      .where(id === undefined ? undefined : ne(categories.id, id))
      .all()
      .map((r) => r.name);
  /** How many transactions and rules each category has, by id. */
  const counts = () => ({
    transactions: new Map(
      db
        .select({ id: transactions.categoryId, n: count() })
        .from(transactions)
        .groupBy(transactions.categoryId)
        .all()
        .map(({ id, n }) => [id, n]),
    ),
    rules: new Map(
      db
        .select({ id: rules.categoryId, n: count() })
        .from(rules)
        .groupBy(rules.categoryId)
        .all()
        .map(({ id, n }) => [id, n]),
    ),
  });
  const present = (
    row: typeof categories.$inferSelect,
    n = counts(),
  ): Category => ({
    ...row,
    transactionCount: n.transactions.get(row.id) ?? 0,
    ruleCount: n.rules.get(row.id) ?? 0,
  });

  // S16: every category, and how many counted transactions have none yet
  // (transfers need none).
  app.get("/api/categories", () => {
    const n = counts();
    const [uncategorized] = db
      .select({ n: count() })
      .from(transactions)
      .where(
        and(
          isNull(transactions.categoryId),
          isNull(transactions.transferWith),
          eq(transactions.excluded, false),
        ),
      )
      .all();
    return {
      categories: db
        .select()
        .from(categories)
        .orderBy(categories.id)
        .all()
        .map((row) => present(row, n)),
      uncategorized: uncategorized?.n ?? 0,
    };
  });

  // D5, adding.
  app.post<{ Body: CategoryFields }>(
    "/api/categories",
    { schema: { body: fieldsSchema } },
    (req, reply) => {
      const category = validateCategory(req.body, otherNames());
      if (!category.ok)
        return reply.code(400).send({ errors: category.errors });
      const row = db
        .insert(categories)
        .values(category.value)
        .returning()
        .get();
      return reply.code(201).send(present(row));
    },
  );

  // D5, editing: renaming or changing the type keeps its transactions.
  app.patch<WithId & { Body: CategoryFields }>(
    "/api/categories/:id",
    { schema: { params: idParams, body: fieldsSchema } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      const budgeted = db
        .select({ id: budgets.id })
        .from(budgets)
        .where(eq(budgets.categoryId, row.id))
        .get();
      const category = validateCategory(req.body, otherNames(row.id), {
        budgeted: budgeted !== undefined,
      });
      if (!category.ok)
        return reply.code(400).send({ errors: category.errors });
      return present(
        db
          .update(categories)
          .set(category.value)
          .where(eq(categories.id, row.id))
          .returning()
          .get()!,
      );
    },
  );

  // D5, deleting. Its transactions move to `moveTo`, or become uncategorized
  // when it's null, and the rules that give it follow them, or are deleted.
  // Left out, a category in use isn't deleted: the choice must be explicit.
  app.delete<WithId & { Body: { moveTo?: number | null } | undefined }>(
    "/api/categories/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: ["object", "null"],
          properties: { moveTo: { type: ["integer", "null"] } },
        },
      },
    },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      const moveTo = req.body?.moveTo;
      const { transactionCount: used, ruleCount } = present(row);
      if ((used > 0 || ruleCount > 0) && moveTo === undefined) {
        const uses = [
          used > 0 &&
            `${used === 1 ? "1 transaction uses" : `${used} transactions use`} this category`,
          ruleCount > 0 &&
            `${ruleCount === 1 ? "1 rule gives" : `${ruleCount} rules give`} it`,
        ].filter(Boolean);
        const one = used + ruleCount === 1;
        return reply.code(409).send({
          error: `${uses.join(" and ")}. Say where ${one ? "it goes" : "they go"} first.`,
        });
      }
      if (moveTo != null && (moveTo === row.id || !find(moveTo))) {
        return reply
          .code(400)
          .send({ error: "Pick another category to move them to." });
      }
      db.transaction((tx) => {
        tx.update(transactions)
          .set({ categoryId: moveTo ?? null })
          .where(eq(transactions.categoryId, row.id))
          .run();
        if (moveTo == null) {
          tx.delete(rules).where(eq(rules.categoryId, row.id)).run();
        } else {
          tx.update(rules)
            .set({ categoryId: moveTo })
            .where(eq(rules.categoryId, row.id))
            .run();
        }
        tx.delete(categories).where(eq(categories.id, row.id)).run();
      });
      return reply.code(204).send();
    },
  );
}
