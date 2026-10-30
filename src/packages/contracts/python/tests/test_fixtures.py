"""Same fixtures as test/fixtures.test.ts, through jsonschema + the pydantic mirror."""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from comfy_dial_contracts import CONTRACTS

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_FILE = {
    "Shot": "shot.schema.json",
    "ControlPacket": "control-packet.schema.json",
    "Candidate": "candidate.schema.json",
    "ScoreReport": "score-report.schema.json",
    "Poses": "poses.schema.json",
}


def _load(path: Path):
    return json.loads(path.read_text())


_schemas = {p.name: _load(p) for p in (ROOT / "schema").glob("*.json")}
_registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in _schemas.values())


def _validator(contract: str) -> Draft202012Validator:
    schema = _schemas[SCHEMA_FILE[contract]]
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=_registry)


VALID = [("Shot", p) for p in sorted((ROOT / "fixtures/shots").glob("*.json"))] + [
    ("ControlPacket", ROOT / "fixtures/control_packet.json"),
    ("Candidate", ROOT / "fixtures/candidate.json"),
    ("ScoreReport", ROOT / "fixtures/score_report.json"),
    ("ScoreReport", ROOT / "fixtures/score_report_solve_failed.json"),
    ("Poses", ROOT / "fixtures/poses.json"),
    ("Poses", ROOT / "fixtures/poses_solve_failed.json"),
]


def test_five_golden_shots():
    names = sorted(p.name for c, p in VALID if c == "Shot")
    assert names == ["dolly_zoom.json", "orbit.json", "pan.json", "push_in.json", "zoom_only.json"]


@pytest.mark.parametrize("contract,path", VALID, ids=lambda v: getattr(v, "name", v))
def test_valid_fixture(contract, path):
    data = _load(path)
    errors = list(_validator(contract).iter_errors(data))
    assert not errors, [e.message for e in errors]
    model = CONTRACTS[contract].model_validate_json(path.read_text())
    assert model.model_dump(mode="json", by_alias=True, exclude_unset=True) == data


@pytest.mark.parametrize("path", sorted((ROOT / "fixtures/invalid").glob("*.json")), ids=lambda p: p.name)
def test_invalid_fixture(path):
    case = _load(path)
    with pytest.raises(ValueError):
        CONTRACTS[case["contract"]].model_validate_json(json.dumps(case["data"]))
