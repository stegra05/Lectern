# Contributing to Lectern

First off, thank you for considering contributing to Lectern. It's people like you that make things easier for students everywhere.

## 💡 The Philosophy

Lectern follows a "Craft over Speed" philosophy. We value:
- **Readability:** Code is read more often than written.
- **Aesthetics:** Even command-line tools should be beautiful.
- **Safety:** We never mess with the user's data (Anki collection) directly; we use APIs.

## 🛠 Development Setup

1.  **Python Environment:**
    ```bash
    python -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    ```

2.  **Frontend Environment:**
    ```bash
    cd gui/frontend
    npm install
    ```

3.  **Formatters:**
    - Python: `black`
    - TypeScript: `prettier` / `eslint`

## 🔀 Workflow

1.  Fork the repo and create your branch from `main`.
2.  If you've added code that should be tested, add tests.
3.  Ensure the test suite passes.
4.  Make sure your code lints.
5.  Issue that pull request!

## 📐 Code Style

### Python
- **Type Hints:** Use `typing` module or modern `list[str]` syntax where supported (3.9+).
- **Docstrings:** Use Google-style docstrings for complex functions.
- **Imports:** Standard library first, then third-party, then local.

### TypeScript / React
- **Functional Components:** Use `const Component: React.FC<Props> = (...) => ...`.
- **Tailwind:** Group utility classes logically (layout -> spacing -> typography -> color).
- **Naming:** PascalCase for components, camelCase for variables/functions.

## 🧪 Testing

We use `pytest` for the backend.

```bash
# Run all tests
pytest tests/
```

For the frontend, we currently rely on manual verification, but adding Vitest would be a welcome contribution.

## 🐛 Reporting Bugs

Bugs are tracked as GitHub issues.
- Explain the problem and include additional details to help maintainers reproduce the problem.
- A clear, minimal reproduction is worth a thousand words.

## 📜 License

By contributing, you agree that your contributions will be licensed under its MIT License.
