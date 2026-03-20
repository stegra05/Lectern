from gui.backend.main import app


def _response_schema(spec: dict, path: str, method: str) -> dict:
    operation = spec["paths"][path][method]
    return operation["responses"]["200"]["content"]["application/json"]["schema"]


def _resolve_schema(spec: dict, schema: dict) -> dict:
    if "$ref" not in schema:
        return schema

    ref_path = schema["$ref"].replace("#/", "").split("/")
    resolved = spec
    for key in ref_path:
        resolved = resolved[key]
    return resolved


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
        ("/estimate-v2", "post"),
        ("/stop-v2", "post"),
        ("/session-v2/{session_id}", "get"),
        ("/anki/notes", "delete"),
        ("/anki/notes/{note_id}", "put"),
    ]

    for path, method in critical_routes:
        schema = _response_schema(spec, path, method)
        assert (
            schema != {}
        ), f"{method.upper()} {path} should not expose an empty schema"
        assert (
            "$ref" in schema
            or "anyOf" in schema
            or "items" in schema
            or "properties" in schema
        ), f"{method.upper()} {path} should use structured OpenAPI schema"


def test_health_schema_includes_provider_diagnostics_fields():
    spec = app.openapi()
    schema = _resolve_schema(spec, _response_schema(spec, "/health", "get"))

    properties = schema.get("properties", {})
    for required_field in ["active_provider", "provider_configured", "provider_ready"]:
        assert required_field in properties


def test_health_schema_includes_nested_diagnostics_contract():
    spec = app.openapi()
    schema = _resolve_schema(spec, _response_schema(spec, "/health", "get"))

    properties = schema.get("properties", {})

    for backward_compatible_field in [
        "anki_connected",
        "gemini_configured",
        "provider_ready",
    ]:
        assert backward_compatible_field in properties

    assert "diagnostics" in properties
    diagnostics_schema = _resolve_schema(spec, properties["diagnostics"])
    diagnostics_properties = diagnostics_schema.get("properties", {})
    for diagnostics_field in ["anki", "provider", "api_key"]:
        assert diagnostics_field in diagnostics_properties


def test_config_schema_includes_ai_provider_selection_field():
    spec = app.openapi()
    schema = _resolve_schema(spec, _response_schema(spec, "/config", "get"))

    properties = schema.get("properties", {})
    assert "ai_provider" in properties
