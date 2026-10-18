"""Camera adherence verifier. Owned by the verifier lane (SPEC.md §6)."""

import sys
from pathlib import Path

# The contracts mirror is not an installed package (uv `package = false`); make the CLI work outside pytest.
_contracts = Path(__file__).resolve().parents[1] / "packages/contracts/python"
if str(_contracts) not in sys.path:
    sys.path.append(str(_contracts))
