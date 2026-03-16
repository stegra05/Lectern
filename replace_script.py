import re

def rewrite():
    with open('tests/test_api.py', 'r') as f:
        content = f.read()

    # 1. Replace sm.create_session(..., mock_service, mock_drafts) -> sm.create_session(...)
    content = re.sub(r'(session_manager.create_session([^,]+)),s*[^,]+,s*[^)]+(\))', r'\1\2', content)
    content = re.sub(r'(sm.create_session([^,]+)),s*[^,]+,s*[^)]+(\))', r'\1\2', content)
    
    # 2. Fix the specific imports or patches
    content = re.sub(r"@patch('gui.backend.main.GenerationService')\n", "", content)
    content = re.sub(r"@patch('gui.backend.main.LecternGenerationService')\n", "", content)
    
    # Remove some tests entirely as they test deleted functionality
    tests_to_delete = [
        "test_sync_drafts_endpoint",
        "test_session_api_more",
        "test_simple_session_actions",
        "test_session_card_management_success",
        "test_batch_delete_session_cards",
        "test_draft_api_failures",
        "test_sync_failures_reporting",
        "test_sync_session_runtime_error",
        "test_sync_session_to_anki_recreate_branch",
        "test_update_session_cards_not_found",
        "test_session_status_endpoint",
        "test_sync_nonexistent_session",
        "test_generate_event_generator_errors",
        "test_generate_with_overrides",
        "test_generate_with_many_pages",
        "test_generate_cancellation_via_stop",
        "test_generate_cleanup_on_error",
        "test_generate_endpoint",
        "test_session_manager_edge_cases",
        "test_session_latest_fallback",
        "test_api_status_event_handling",
        "test_concurrent_session_handling",
        "test_no_active_session_404",
        "test_session_management_logic",
        "test_sync_session_to_anki_logic"
    ]
    
    for test in tests_to_delete:
        pattern = re.compile(r'^[ \t]*def ' + test + r'(.*):\n(?:(?:[ \t]+.*\n)|\n)*', re.MULTILINE)
        content = pattern.sub('', content)

    # Clean up patches inside remaining tests
    content = re.sub(r"[ \t]+with patch('gui.backend.main.GenerationService.run_generation'.*?):\n", "", content)
    content = re.sub(r"[ \t]+with patch('gui.backend.main.LecternGenerationService').*?:\n", "", content)
    content = re.sub(r"[ \t]+with patch('gui.backend.main._get_runtime_or_404'.*?):\n", "", content)

    with open('tests/test_api.py', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    rewrite()
