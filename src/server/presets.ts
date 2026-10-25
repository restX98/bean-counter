import { eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db/index.ts";
import { accounts, importPresets, imports } from "./db/schema.ts";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
} as const;

export function presetRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // S18: the saved formats, with the accounts they've been used for and the
  // day of their last import.
  app.get("/api/presets", () => {
    const uses = db
      .select({
        presetId: imports.presetId,
        account: accounts.name,
        importedOn: imports.importedOn,
      })
      .from(imports)
      .innerJoin(accounts, eq(accounts.id, imports.accountId))
      .where(isNotNull(imports.presetId))
      .all();
    const presets = db
      .select()
      .from(importPresets)
      .orderBy(importPresets.name)
      .all()
      .map((preset) => {
        const mine = uses.filter((use) => use.presetId === preset.id);
        return {
          id: preset.id,
          name: preset.name,
          columns: preset.columns.length,
          balance: preset.mapping.roles.includes("balance"),
          accounts: [...new Set(mine.map((use) => use.account))].sort(),
          lastUsed:
            mine
              .map((use) => use.importedOn)
              .sort()
              .at(-1) ?? null,
        };
      });
    return { presets };
  });

  // The imports made with it keep their own copy of the mapping, so nothing
  // else changes. The next file in this format goes through S8 again.
  app.delete<{ Params: { id: number } }>(
    "/api/presets/:id",
    { schema: { params: idParams } },
    (req, reply) => {
      const deleted = db
        .delete(importPresets)
        .where(eq(importPresets.id, req.params.id))
        .returning({ id: importPresets.id })
        .get();
      if (!deleted) return reply.code(404).send({ error: "Not found" });
      return reply.code(204).send();
    },
  );
}
