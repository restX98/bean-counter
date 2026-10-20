import { and, count, eq, isNull, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  validateCategory,
  type Category,
  type CategoryFields,
} from "../domain/categories.ts";
import type { Db } from "./db/index.ts";
import { categories, transactions } from "./db/schema.ts";

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
  /** How many transactions each category has, by id. */
  const counts = () =>
    new Map(
      db
        .select({ id: transactions.categoryId, n: count() })
        .from(transactions)
        .groupBy(transactions.categoryId)
        .all()
        .map(({ id, n }) => [id, n]),
    );
  const present = (
    row: typeof categories.$inferSelect,
    n = counts().get(row.id) ?? 0,
  ): Category => ({ ...row, transactionCount: n });

  // S16: every category, and how many counted transactions have none yet.
  app.get("/api/categories", () => {
    const n = counts();
    const [uncategorized] = db
      .select({ n: count() })
      .from(transactions)
      .where(
        and(isNull(transactions.categoryId), eq(transactions.excluded, false)),
      )
      .all();
    return {
      categories: db
        .select()
        .from(categories)
        .orderBy(categories.id)
        .all()
        .map((row) => present(row, n.get(row.id) ?? 0)),
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
      return reply.code(201).send(present(row, 0));
    },
  );

  // D5, editing: renaming or changing the type keeps its transactions.
  app.patch<WithId & { Body: CategoryFields }>(
    "/api/categories/:id",
    { schema: { params: idParams, body: fieldsSchema } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      const category = validateCategory(req.body, otherNames(row.id));
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

  // D5, deleting one that no transaction uses.
  app.delete<WithId>(
    "/api/categories/:id",
    { schema: { params: idParams } },
    (req, reply) => {
      const row = find(req.params.id);
      if (!row) return notFound(reply);
      const used = counts().get(row.id) ?? 0;
      if (used > 0) {
        return reply.code(409).send({
          error: `${used === 1 ? "1 transaction uses" : `${used} transactions use`} this category. Give ${used === 1 ? "it" : "them"} another category first.`,
        });
      }
      db.delete(categories).where(eq(categories.id, row.id)).run();
      return reply.code(204).send();
    },
  );
}
