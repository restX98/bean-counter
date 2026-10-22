import type { FastifyInstance } from "fastify";
import { readWindow } from "../domain/transfers.ts";
import type { Db } from "./db/index.ts";
import { settings } from "./db/schema.ts";
import { linkTransfers, transferWindow } from "./transfers.ts";

export function settingsRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // S18.
  app.get("/api/settings", () => ({ transferWindow: transferWindow(db) }));

  // A new transfer window takes effect at once: whatever now has a single
  // candidate is linked. Links made with the old one stay.
  app.patch<{ Body: { transferWindow: string } }>(
    "/api/settings",
    {
      schema: {
        body: {
          type: "object",
          required: ["transferWindow"],
          properties: { transferWindow: { type: "string" } },
        },
      },
    },
    (req, reply) => {
      const window = readWindow(req.body.transferWindow);
      if ("error" in window) {
        return reply
          .code(400)
          .send({ errors: { transferWindow: window.error } });
      }
      const linked = db.transaction(() => {
        db.insert(settings)
          .values({ key: "transferWindow", value: window.days })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: window.days },
          })
          .run();
        return linkTransfers(db).linked.length;
      });
      return { transferWindow: window.days, linked };
    },
  );
}
