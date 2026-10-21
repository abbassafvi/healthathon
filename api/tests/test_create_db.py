import pytest

from dev_seed.create_db import recreate


@pytest.mark.parametrize("name", ["healthathon", "prod", "x_test; DROP DATABASE y", "a-b_test"])
def test_refuses_anything_but_test_or_e2e_databases(name: str) -> None:
    with pytest.raises(SystemExit):
        recreate(name)
