"""The app object builds and exposes the route everything else polls.

Asserted through the app's own routing table rather than over HTTP: what can
break here is an import error or a renamed path, and catching those needs no
client library and so no dependency beyond pytest.
"""

from backend.main import app, health


def test_health_route_is_registered():
    assert "/api/health" in {getattr(route, "path", None) for route in app.routes}


def test_health_reports_ok():
    assert health() == {"status": "ok"}
