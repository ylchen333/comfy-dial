"""Phase 0 wiring check: the verifier can import the contract mirror. Replace with real tests."""

from comfy_osh_contracts import ScoreReport


def test_contracts_importable():
    assert "solveOk" in ScoreReport.model_fields
