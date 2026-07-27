"""Configuration loading and validation for the Pipecat Orchestrator Agent.

Reads all configuration from environment variables, validates required fields
and integer ranges, and returns an immutable Config dataclass.
"""

import os
import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    """Immutable configuration loaded from environment variables."""

    # LiveKit
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str

    # Service endpoints
    stt_base_url: str
    tts_base_url: str
    llm_base_url: str

    # Model identifiers
    stt_model: str
    tts_model: str
    llm_model: str

    # VAD
    vad_silence_threshold_ms: int  # 100-2000, default 200

    # Metrics
    metrics_port: int  # 1-65535, default 8080


# Required environment variables that must be present and non-empty
_REQUIRED_VARS = (
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "STT_BASE_URL",
    "TTS_BASE_URL",
    "LLM_BASE_URL",
)


def _validate_ranged_int(
    name: str, value: str, min_val: int, max_val: int, default: int
) -> tuple[int | None, str | None]:
    """Parse and validate a ranged integer environment variable.

    Returns (parsed_value, None) on success or (None, error_message) on failure.
    If value is empty, returns (default, None).
    """
    if not value:
        return default, None

    try:
        parsed = int(value)
    except ValueError:
        return None, (
            f"{name} must be an integer between {min_val} and {max_val}, "
            f"got: '{value}'"
        )

    if parsed < min_val or parsed > max_val:
        return None, (
            f"{name} must be between {min_val} and {max_val}, got: {parsed}"
        )

    return parsed, None


def load_config() -> Config:
    """Load configuration from environment variables.

    Validates that all required variables are present and non-empty,
    and that ranged integer variables are within their valid ranges.

    Returns:
        A frozen Config dataclass with all configuration values.

    Raises:
        SystemExit: If required variables are missing or values are invalid.
    """
    errors: list[str] = []

    # Check required variables
    missing = [var for var in _REQUIRED_VARS if not os.environ.get(var, "").strip()]
    if missing:
        errors.append(f"Missing required environment variables: {', '.join(missing)}")

    # Validate ranged integers
    vad_threshold, vad_err = _validate_ranged_int(
        "VAD_SILENCE_THRESHOLD_MS",
        os.environ.get("VAD_SILENCE_THRESHOLD_MS", ""),
        100,
        2000,
        200,
    )
    if vad_err:
        errors.append(vad_err)

    metrics_port, port_err = _validate_ranged_int(
        "METRICS_PORT",
        os.environ.get("METRICS_PORT", ""),
        1,
        65535,
        8080,
    )
    if port_err:
        errors.append(port_err)

    # Exit with all errors if any validation failed
    if errors:
        error_msg = "Configuration error: " + "; ".join(errors)
        print(error_msg, file=sys.stderr)
        sys.exit(1)

    return Config(
        livekit_url=os.environ["LIVEKIT_URL"].strip(),
        livekit_api_key=os.environ["LIVEKIT_API_KEY"].strip(),
        livekit_api_secret=os.environ["LIVEKIT_API_SECRET"].strip(),
        stt_base_url=os.environ["STT_BASE_URL"].strip(),
        tts_base_url=os.environ["TTS_BASE_URL"].strip(),
        llm_base_url=os.environ["LLM_BASE_URL"].strip(),
        stt_model=os.environ.get("STT_MODEL", ""),
        tts_model=os.environ.get("TTS_MODEL", ""),
        llm_model=os.environ.get("LLM_MODEL", ""),
        vad_silence_threshold_ms=vad_threshold,
        metrics_port=metrics_port,
    )
