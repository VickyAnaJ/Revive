"""Arduino -> Browser serial frame schema (FR1).

Per design §6f Contract Registry "Arduino → Browser (C1 → C2)".
Mirror of contracts/serial.ts.
"""
from typing import Literal
from pydantic import BaseModel, Field


class SerialFrame(BaseModel):
    """One frame emitted by C1 ArduinoFirmware on every loop iteration."""

    depth: float = Field(ge=0.0, le=1.0, description="Normalized compression depth")
    rate: int = Field(ge=0, le=220, description="Rolling compression rate in BPM")
    ts: int = Field(ge=0, description="Arduino millis() timestamp")


class SerialReadyFrame(BaseModel):
    """One-shot frame emitted by C1 on boot."""

    type: Literal["ready"]
    fw: str
