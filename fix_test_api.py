import re

def rewrite():
    with open('tests/test_api.py', 'r') as f:
        content = f.read()

    # Remove the patch
    content = re.sub(r"@patch\('gui\.backend\.main\.GenerationService'\)\n(?:@patch\(.*\)\n)*def test_history_actions", "def test_history_actions", content)
    # Also if there are any other GenerationService patches left
    content = re.sub(r"@patch\('gui\.backend\.main\.GenerationService'\)\n", "", content)

    with open('tests/test_api.py', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    rewrite()

