from gui.backend.main import app


def _response_schema(spec: dict, path: str, method: str) -> dict:
    operation = spec["paths"][path][method]
    return operation["responses"]["200"]["content"]["application/json"]["schema"]


def test_critical_endpoints_have_typed_response_schemas():
    spec = app.openapi()
    critical_routes = [
        ("/health", "get"),
        ("/version", "get"),
        ("/anki/status", "get"),
        ("/config", "get"),
        ("/config", "post"),
        ("/history", "get"),
        ("/decks", "get"),
        ("/decks", "post"),
        ("/history", "delete"),
        ("/history/{entry_id}", "delete"),
        ("/history/batch-delete", "post"),
        ("/estimate", "post"),
        ("/stop", "post"),
        ("/session/{session_id}", "get"),
        ("/anki/notes", "delete"),
        ("/anki/notes/{note_id}", "put"),
    ]

    for path, method in critical_routes:
        schema = _response_schema(spec, path, method)
        assert schema != {}, f"{method.upper()} {path} should not expose an empty schema"
        assert (
            "$ref" in schema
            or "anyOf" in schema
            or "items" in schema
            or "properties" in schema
        ), f"{method.upper()} {path} should use structured OpenAPI schema"
