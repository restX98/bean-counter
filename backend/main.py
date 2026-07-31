"""HTTP entry point.

Serves the JSON API under ``/api``. Serving the built frontend out of this
process arrives with the frontend itself.
"""

from fastapi import FastAPI

app = FastAPI(title="bean-counter")


@app.get("/api/health")
def health() -> dict[str, str]:
    """Liveness only.

    The ledger checks this endpoint is meant to carry — the ``v_unbalanced``
    count and the clearing balance — need the database layer, which is not on
    this branch yet.
    """
    return {"status": "ok"}
