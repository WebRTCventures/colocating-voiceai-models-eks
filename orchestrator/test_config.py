"""Unit tests for orchestrator/config.py."""

import os
import pytest
from unittest.mock import patch
from config import load_config, Config


# A complete valid environment for tests
VALID_ENV = {
    "LIVEKIT_URL": "wss://livekit.example.com",
    "LIVEKIT_API_KEY": "api-key-123",
    "LIVEKIT_API_SECRET": "api-secret-456",
    "STT_BASE_URL": "http://speaches-stt:8000",
    "TTS_BASE_URL": "http://speaches-tts:8000",
    "LLM_BASE_URL": "http://vllm:8000",
}


class TestLoadConfigSuccess:
    """Tests for successful configuration loading."""

    def test_loads_required_vars(self):
        with patch.dict(os.environ, VALID_ENV, clear=True):
            config = load_config()
            assert config.livekit_url == "wss://livekit.example.com"
            assert config.livekit_api_key == "api-key-123"
            assert config.livekit_api_secret == "api-secret-456"
            assert config.stt_base_url == "http://speaches-stt:8000"
            assert config.tts_base_url == "http://speaches-tts:8000"
            assert config.llm_base_url == "http://vllm:8000"

    def test_defaults_model_vars_to_empty_string(self):
        with patch.dict(os.environ, VALID_ENV, clear=True):
            config = load_config()
            assert config.stt_model == ""
            assert config.tts_model == ""
            assert config.llm_model == ""

    def test_reads_model_vars_when_set(self):
        env = {
            **VALID_ENV,
            "STT_MODEL": "whisper-large-v3-turbo",
            "TTS_MODEL": "kokoro",
            "LLM_MODEL": "llama-3.1-8b",
        }
        with patch.dict(os.environ, env, clear=True):
            config = load_config()
            assert config.stt_model == "whisper-large-v3-turbo"
            assert config.tts_model == "kokoro"
            assert config.llm_model == "llama-3.1-8b"

    def test_default_vad_silence_threshold(self):
        with patch.dict(os.environ, VALID_ENV, clear=True):
            config = load_config()
            assert config.vad_silence_threshold_ms == 200

    def test_default_metrics_port(self):
        with patch.dict(os.environ, VALID_ENV, clear=True):
            config = load_config()
            assert config.metrics_port == 8080

    def test_custom_vad_threshold(self):
        env = {**VALID_ENV, "VAD_SILENCE_THRESHOLD_MS": "500"}
        with patch.dict(os.environ, env, clear=True):
            config = load_config()
            assert config.vad_silence_threshold_ms == 500

    def test_custom_metrics_port(self):
        env = {**VALID_ENV, "METRICS_PORT": "9090"}
        with patch.dict(os.environ, env, clear=True):
            config = load_config()
            assert config.metrics_port == 9090

    def test_vad_threshold_at_lower_bound(self):
        env = {**VALID_ENV, "VAD_SILENCE_THRESHOLD_MS": "100"}
        with patch.dict(os.environ, env, clear=True):
            config = load_config()
            assert config.vad_silence_threshold_ms == 100

    def test_vad_threshold_at_upper_bound(self):
        env = {**VALID_ENV, "VAD_SILENCE_THRESHOLD_MS": "2000"}
        with patch.dict(os.environ, env, clear=True):
            config = load_config()
            assert config.vad_silence_threshold_ms == 2000

    def test_metrics_port_at_lower_bound(self):
        env = {**VALID_ENV, "METRICS_PORT": "1"}
        with patch.dict(os.environ, env, clear=True):
            config = load_config()
            assert config.metrics_port == 1

    def test_metrics_port_at_upper_bound(self):
        env = {**VALID_ENV, "METRICS_PORT": "65535"}
        with patch.dict(os.environ, env, clear=True):
            config = load_config()
            assert config.metrics_port == 65535

    def test_config_is_frozen(self):
        with patch.dict(os.environ, VALID_ENV, clear=True):
            config = load_config()
            with pytest.raises(Exception):
                config.livekit_url = "new-value"

    def test_strips_whitespace_from_required_vars(self):
        env = {
            "LIVEKIT_URL": "  wss://livekit.example.com  ",
            "LIVEKIT_API_KEY": " api-key ",
            "LIVEKIT_API_SECRET": " secret ",
            "STT_BASE_URL": " http://stt ",
            "TTS_BASE_URL": " http://tts ",
            "LLM_BASE_URL": " http://llm ",
        }
        with patch.dict(os.environ, env, clear=True):
            config = load_config()
            assert config.livekit_url == "wss://livekit.example.com"
            assert config.livekit_api_key == "api-key"


class TestLoadConfigMissingVars:
    """Tests for missing required environment variables."""

    def test_exits_when_all_required_vars_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_exits_when_single_required_var_missing(self):
        env = {k: v for k, v in VALID_ENV.items() if k != "LIVEKIT_URL"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_error_message_names_missing_vars(self, capsys):
        env = {k: v for k, v in VALID_ENV.items() if k != "LIVEKIT_URL"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit):
                load_config()
        captured = capsys.readouterr()
        assert "LIVEKIT_URL" in captured.err

    def test_exits_when_required_var_is_empty(self):
        env = {**VALID_ENV, "LIVEKIT_API_KEY": ""}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_exits_when_required_var_is_whitespace_only(self):
        env = {**VALID_ENV, "STT_BASE_URL": "   "}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_error_names_all_missing_vars(self, capsys):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(SystemExit):
                load_config()
        captured = capsys.readouterr()
        for var in (
            "LIVEKIT_URL",
            "LIVEKIT_API_KEY",
            "LIVEKIT_API_SECRET",
            "STT_BASE_URL",
            "TTS_BASE_URL",
            "LLM_BASE_URL",
        ):
            assert var in captured.err


class TestLoadConfigInvalidRanges:
    """Tests for invalid ranged integer values."""

    def test_exits_on_vad_threshold_below_range(self):
        env = {**VALID_ENV, "VAD_SILENCE_THRESHOLD_MS": "99"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_exits_on_vad_threshold_above_range(self):
        env = {**VALID_ENV, "VAD_SILENCE_THRESHOLD_MS": "2001"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_exits_on_vad_threshold_non_integer(self):
        env = {**VALID_ENV, "VAD_SILENCE_THRESHOLD_MS": "not_a_number"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_exits_on_metrics_port_below_range(self):
        env = {**VALID_ENV, "METRICS_PORT": "0"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_exits_on_metrics_port_above_range(self):
        env = {**VALID_ENV, "METRICS_PORT": "65536"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_exits_on_metrics_port_non_integer(self):
        env = {**VALID_ENV, "METRICS_PORT": "abc"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 1

    def test_error_message_mentions_variable_name(self, capsys):
        env = {**VALID_ENV, "VAD_SILENCE_THRESHOLD_MS": "9999"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit):
                load_config()
        captured = capsys.readouterr()
        assert "VAD_SILENCE_THRESHOLD_MS" in captured.err

    def test_reports_both_range_errors(self, capsys):
        env = {**VALID_ENV, "VAD_SILENCE_THRESHOLD_MS": "0", "METRICS_PORT": "0"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(SystemExit):
                load_config()
        captured = capsys.readouterr()
        assert "VAD_SILENCE_THRESHOLD_MS" in captured.err
        assert "METRICS_PORT" in captured.err
