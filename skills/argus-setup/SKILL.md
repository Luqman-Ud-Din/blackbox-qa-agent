---
name: argus-setup
description: "Argus QA first-run setup wizard; safe alias for qa-setup that avoids old qa-agent command collisions"
---

# argus-setup

Run this command when preparing Argus QA for a new user or project:

```text
/argus-setup
```

This is the collision-safe setup entry point for this plugin. It exists because some machines may already have an older plugin that owns `/qa-setup`.

## Behavior

Execute the setup flow from:

```text
skills/qa-setup/SKILL.md
```

Follow that file exactly, with these command-name substitutions in user-facing output:

- Say `/argus-setup` when telling the user how to re-run setup.
- Say `/argus` when telling the user how to start the audit.
- Do not mention `/qa-setup` or `/qa-agent`.

## Safety

All safety rules from `skills/qa-setup/SKILL.md` apply:

- Never auto-install dependencies without confirmation.
- Never write PATs or passwords to `automation.config.json`.
- Store private credentials only in `.claude/secrets.json`.
- Preserve existing config when possible.
