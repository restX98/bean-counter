import { useEffect, useState } from "react";

type Health = { ok: true; sqlite: string } | { ok: false };

async function checkHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  return res.ok ? ((await res.json()) as Health) : { ok: false };
}

// Placeholder until the app shell exists: shows that the UI reaches the server
// and the database.
export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    checkHealth().then(setHealth, () => setHealth({ ok: false }));
  }, []);

  return (
    <main className="placeholder">
      <h1>Bean Counter</h1>
      <p>The project is set up. The screens come next.</p>
      {health === null ? (
        <p className="status">Checking the server…</p>
      ) : health.ok ? (
        <p className="status is-ok">Server OK · SQLite {health.sqlite}</p>
      ) : (
        <p className="status is-error">
          Can’t reach the server. Is it running?
        </p>
      )}
    </main>
  );
}
