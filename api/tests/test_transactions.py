from collections.abc import Callable, Iterator
from typing import Any

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from healthathon.db import get_conn
from healthathon.main import app


def _scopes(dependant: Dependant, target: Callable[..., Any]) -> Iterator[str | None]:
    """The scope of every use of `target` in a route's dependency tree."""
    for dep in dependant.dependencies:
        if dep.call is target:
            yield dep.scope
        yield from _scopes(dep, target)


def test_every_route_commits_before_it_responds() -> None:
    """
    The database dependency must end, and commit, before the response is
    sent. Otherwise a client that reads straight after a write can miss it,
    and a commit that fails would follow a 200.
    """
    routes = [r for r in app.routes if isinstance(r, APIRoute) and r.path != "/api/health"]
    for route in routes:
        scopes = list(_scopes(route.dependant, get_conn))
        assert scopes, f"{route.path} does not use the database dependency"
        assert set(scopes) == {"function"}, f"{route.path} uses get_conn with {scopes}"
