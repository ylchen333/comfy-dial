"""pydantic mirror of packages/contracts/schema/*.schema.json (the source of truth).

Field names match the JSON exactly (camelCase) so models round-trip the wire format.
Models are strict: load files with `Model.model_validate_json(text)` (JSON mode accepts
arrays for tuples and ints for floats; Python-mode `model_validate` does not).
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FPS = 25
UNIT_QUAT_TOLERANCE = 1e-6

NonEmpty = Annotated[str, Field(min_length=1)]
Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]
Err = Annotated[float, Field(ge=0)] | None


def is_ltx_frame_count(n: int) -> bool:
    return n >= 9 and (n - 1) % 8 == 0


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class FrameRange(_Strict):
    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(ge=1)]


class Transform(_Strict):
    position: Vec3
    quaternion: Quat
    scale: Vec3


class SceneNode(_Strict):
    id: NonEmpty
    asset: NonEmpty
    transform: Transform


class Scene(_Strict):
    nodes: list[SceneNode]


class Resolution(_Strict):
    width: Annotated[int, Field(ge=64, multiple_of=32)]
    height: Annotated[int, Field(ge=64, multiple_of=32)]


class Keyframe(_Strict):
    t: Annotated[float, Field(ge=0)]
    position: Vec3
    quaternion: Quat
    fov_v_deg: Annotated[float, Field(gt=0, lt=180)]


class Shot(_Strict):
    version: Literal[1]
    id: NonEmpty
    name: str | None = None
    scene: Scene
    fps: Literal[25]
    frames: Annotated[int, Field(ge=9)]
    resolution: Resolution
    track: Annotated[list[Keyframe], Field(min_length=2)]
    segments: Annotated[list[FrameRange], Field(min_length=1)]

    @model_validator(mode="after")
    def _cross_field(self) -> Shot:
        if not is_ltx_frame_count(self.frames):
            raise ValueError("frames must be 1 + 8k")
        duration = (self.frames - 1) / self.fps
        for prev, k in zip([None, *self.track], self.track):
            if prev is not None and k.t <= prev.t:
                raise ValueError("track t must be strictly increasing")
            if k.t > duration + 1e-9:
                raise ValueError("track t is past the last frame")
            if abs(math.hypot(*k.quaternion) - 1) > UNIT_QUAT_TOLERANCE:
                raise ValueError("quaternion must be unit length")
        cursor = 0
        for seg in self.segments:
            if seg.start != cursor or seg.end <= seg.start:
                raise ValueError("segments must be contiguous and non-empty")
            cursor = seg.end
        if cursor != self.frames:
            raise ValueError("segments must end at frames")
        return self


class DepthNormalization(_Strict):
    mode: Literal["fixed"]
    near: Annotated[float, Field(gt=0)]
    far: Annotated[float, Field(gt=0)]


class ICLoRA(_Strict):
    name: NonEmpty
    strength: Annotated[float, Field(ge=0, le=1)]


class ControlPacket(_Strict):
    shotId: NonEmpty
    depthVideo: NonEmpty
    depthNormalization: DepthNormalization
    iclora: ICLoRA

    @model_validator(mode="after")
    def _far_gt_near(self) -> ControlPacket:
        if self.depthNormalization.far <= self.depthNormalization.near:
            raise ValueError("far must be greater than near")
        return self


class Candidate(_Strict):
    id: NonEmpty
    shotId: NonEmpty
    seed: Annotated[int, Field(ge=0)]
    idempotencyKey: NonEmpty
    jobId: str | None
    status: Literal["pending", "submitted", "running", "succeeded", "failed"]
    video: str | None


class SegmentScore(_Strict):
    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(ge=1)]
    rotErrDeg: Err
    transErrPct: Err
    fovErrDeg: Err
    passed: bool = Field(alias="pass")

    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class ScoreReport(_Strict):
    candidateId: NonEmpty
    solveOk: bool
    mode: Literal["full", "rotation_only"]
    rotErrDeg: Err
    transErrPct: Err
    fovErrDeg: Err
    perSegment: list[SegmentScore]
    composite: Err
    passed: bool = Field(alias="pass")

    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    @model_validator(mode="after")
    def _failed_solve(self) -> ScoreReport:
        if self.solveOk:
            return self
        if self.passed:
            raise ValueError("solveOk=false implies pass=false")
        if any(v is not None for v in (self.rotErrDeg, self.transErrPct, self.fovErrDeg, self.composite)):
            raise ValueError("solveOk=false implies null errors")
        return self


class ImageSize(_Strict):
    width: Annotated[int, Field(ge=1)]
    height: Annotated[int, Field(ge=1)]


class PoseFrame(_Strict):
    index: Annotated[int, Field(ge=0)]
    t: Annotated[float, Field(ge=0)]
    position: Vec3
    quaternion: Quat
    fov_v_deg: Annotated[float, Field(gt=0, lt=180)]
    fx: Annotated[float, Field(gt=0)] | None = None
    fy: Annotated[float, Field(gt=0)] | None = None
    cx: float | None = None
    cy: float | None = None


class Poses(_Strict):
    # `schema` shadows a BaseModel attribute, so the field is stored as `schema_id` under its wire name.
    schema_id: Literal["comfy-dial/poses/1"] = Field(alias="schema")
    fps: Annotated[float, Field(gt=0)]
    image: ImageSize
    solve_ok: bool
    convention: dict[str, Any] | None = None
    source: dict[str, Any] | None = None
    frames: list[PoseFrame]

    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    @model_validator(mode="after")
    def _cross_field(self) -> Poses:
        if self.solve_ok and not self.frames:
            raise ValueError("solve_ok=true requires at least one frame")
        for prev, f in zip([None, *self.frames], self.frames):
            if prev is not None and f.index <= prev.index:
                raise ValueError("index must be strictly increasing")
            if prev is not None and f.t <= prev.t:
                raise ValueError("t must be strictly increasing")
            if abs(math.hypot(*f.quaternion) - 1) > UNIT_QUAT_TOLERANCE:
                raise ValueError("quaternion must be unit length")
        return self


CONTRACTS: dict[str, type[BaseModel]] = {
    "Shot": Shot,
    "ControlPacket": ControlPacket,
    "Candidate": Candidate,
    "ScoreReport": ScoreReport,
    "Poses": Poses,
}
