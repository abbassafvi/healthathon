"""Write the OpenAPI spec to api/openapi.json, the contract the clients build against."""

import json
from pathlib import Path

from healthathon.main import app

OUT = Path(__file__).resolve().parents[2] / "openapi.json"


def main() -> None:
    OUT.write_text(json.dumps(app.openapi(), indent=2) + "\n")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
