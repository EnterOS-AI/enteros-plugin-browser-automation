# Tests

This plugin uses a smoke-test approach: plugin.yaml schema validation, SKILL.md
frontmatter checks, and adapter re-export verification. The test suite covers
the manifest structure and integration points rather than runtime behavior.

## Running Tests

```bash
pytest tests/ -v
```

## Coverage Rationale

This plugin is primarily prose (skills, rules, commands) with a thin adapter
layer. The adapter (`adapters/claude_code.py`) is a re-export wrapper that
implements no business logic — it delegates to `AgentskillsAdaptor` from
`plugins_registry.builtins`. Unit-testing such a wrapper would test the
framework, not the plugin. The smoke suite provides sufficient coverage for
the manifest contract and adapter wiring.
