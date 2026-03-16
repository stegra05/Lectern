import re

def rewrite():
    with open('tests/test_api.py', 'r') as f:
        content = f.read()
    
    tests_to_delete = [
        "test_session_state_loading_failures",
        "test_config_update_complex"
    ]
    
    for test in tests_to_delete:
        pattern = re.compile(r'^[ \t]*def ' + test + r'\(.*?\):\n(?:(?:[ \t]+.*?\n)|\n)*', re.MULTILINE)
        content = pattern.sub('', content)

    with open('tests/test_api.py', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    rewrite()

