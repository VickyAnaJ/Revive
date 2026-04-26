"""Gemini agent JSON schemas (FR3, FR4, FR2, FR11).

Per design §6f Browser → PatientAgent / CoachAgent / ScenarioAgent contracts.
Mirror of contracts/agents.ts.
"""
from typing import Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field


# PatientAgent input + output (FR3).
class CompressionBatch(BaseModel):
    avg_depth: float = Field(ge=0.0, le=1.0)
    avg_rate: int = Field(ge=0, le=220)
    consistency: float = Field(ge=0.0, le=1.0)
    classification: Literal["adequate", "too_shallow", "too_fast", "too_slow", "force_ceiling"]


Rhythm = Literal["flatline", "v_fib", "v_tach", "weak_pulse", "sinus", "rosc"]


class PatientState(BaseModel):
    hr: int = Field(ge=0, le=220)
    bp: str  # e.g., "90/60"
    o2: int = Field(ge=0, le=100)
    rhythm: Rhythm
    complication: Optional[str] = None
    patient_speech: Optional[str] = None
    body_type_feedback: Optional[str] = None


# CoachAgent output (FR2).
Priority = Literal["low", "medium", "high", "critical"]


class CoachPhrase(BaseModel):
    feedback: str = Field(max_length=200)
    priority: Priority


# ScenarioAgent output (FR4).
class DecisionOption(BaseModel):
    id: str
    label: str


class PenaltyDelta(BaseModel):
    hr: int
    o2: int


class DecisionNode(BaseModel):
    id: str
    prompt: str
    options: list[DecisionOption] = Field(min_length=2, max_length=4)
    correct_choice_id: str
    penalty_delta: PenaltyDelta


class PatientProfile(BaseModel):
    age: int
    sex: str
    body_type: str


class Scenario(BaseModel):
    scenario_id: UUID
    scenario_type: str
    location: str
    patient_profile: PatientProfile
    decision_tree: list[DecisionNode] = Field(min_length=3, max_length=4)
