from __future__ import annotations

import inspect

from lectern.application import ports


def test_protocol_symbols_exist() -> None:
    expected_symbols = {
        "PdfExtractorPort",
        "AIProviderPort",
        "HistoryRepositoryPort",
        "RuntimeSessionStorePort",
        "AnkiGatewayPort",
        "GenerationAppService",
    }

    for symbol in expected_symbols:
        assert hasattr(ports, symbol)


def test_generation_app_service_exposes_required_methods() -> None:
    protocol = ports.GenerationAppService

    required_methods = {
        "run_generation_stream",
        "run_resume_stream",
        "replay_stream",
        "cancel",
    }

    for method_name in required_methods:
        assert method_name in protocol.__dict__
        assert inspect.iscoroutinefunction(protocol.__dict__[method_name])


def test_generation_app_service_signatures_match_contract() -> None:
    protocol = ports.GenerationAppService

    generation_sig = inspect.signature(protocol.run_generation_stream)
    assert list(generation_sig.parameters) == ["self", "req"]

    resume_sig = inspect.signature(protocol.run_resume_stream)
    assert list(resume_sig.parameters) == ["self", "req"]

    replay_sig = inspect.signature(protocol.replay_stream)
    assert list(replay_sig.parameters) == ["self", "req"]

    cancel_sig = inspect.signature(protocol.cancel)
    assert list(cancel_sig.parameters) == ["self", "req"]


def test_history_repository_port_exposes_required_methods() -> None:
    protocol = ports.HistoryRepositoryPort

    required_methods = {
        "create_session",
        "update_phase",
        "append_events",
        "sync_state",
        "mark_terminal",
        "get_session",
        "get_events_after",
    }

    for method_name in required_methods:
        assert method_name in protocol.__dict__
        assert inspect.iscoroutinefunction(protocol.__dict__[method_name])


def test_history_repository_replay_signature_matches_contract() -> None:
    signature = inspect.signature(ports.HistoryRepositoryPort.get_events_after)
    params = list(signature.parameters.values())

    assert [param.name for param in params] == [
        "self",
        "session_id",
        "after_sequence_no",
        "limit",
    ]
    assert params[1].kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
    assert params[2].kind is inspect.Parameter.KEYWORD_ONLY
    assert params[3].kind is inspect.Parameter.KEYWORD_ONLY
    assert params[3].default == 1000
