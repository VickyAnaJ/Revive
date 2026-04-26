"""Session record schema written by C11 LocalSessionLog at scenario debrief (FR9).

Per design §6f Backend → File system contract row.
Mirror of contracts/session.ts.
"""
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class CompressionEvent(BaseModel):
    ts: int
    depth: float
    rate: int
    is_adequate: bool
    recoil_complete: bool


class DecisionEvent(BaseModel):
    decision_point: str
    choice_made: Optional[str]
    correct_choice: str
    is_correct: bool
    time_to_decide_seconds: float


class ErrorEvent(BaseModel):
    ts: int
    component: str
    error_code: str
    fallback_used: Optional[str] = None


class SessionRecord(BaseModel):
    """Full per session record. Written once at scenario debrief to data/local/<session_id>.json."""

    session_id: UUID
    scenario_type: str
    started_at: datetime
    ended_at: datetime
    patient_survived: bool
    overall_score: float
    response_time_seconds: float
    compressions: list[CompressionEvent] = Field(default_factory=list)
    decisions: list[DecisionEvent] = Field(default_factory=list)
    errors: list[ErrorEvent] = Field(default_factory=list)
