---
name: argus-ready
description: "Argus QA readiness wizard; safe alias for qa-ready that avoids old qa-agent command collisions"
---

# argus-ready

Run this command after installing the plugin from a zip:

```text
/argus-ready
```

This is the collision-safe readiness entry point for this plugin. It exists because some machines may already have an older plugin that owns `/qa-ready` or `/qa-setup`.

## Behavior

Execute the readiness flow from:

```text
skills/qa-ready/SKILL.md
```

Follow that file exactly, with these command-name substitutions in user-facing output:

- Say `/argus-ready` for readiness checks and repairs.
- Say `/argus-setup` for the full setup wizard.
- Say `/argus` when telling the user how to start the audit.
- Do not mention `/qa-agent`.

## Supported Forms

```text
/argus-ready
/argus-ready --check
/argus-ready --repair
/argus-ready --secrets
```
