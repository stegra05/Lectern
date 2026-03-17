# CLAUDE.md

For full project context, see [AGENTS.md](./AGENTS.md).

## Claude-Specific Settings

- Uses superpowers skills from `~/.claude/plugins/`
- Plan mode available for complex changes
- See `.claude/settings.local.json` for allowed commands

## Quick Start

```bash
python gui/launcher.py              # Run desktop app
pytest tests/                       # Backend tests
cd gui/frontend && npm test         # Frontend tests
```
