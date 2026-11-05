---
description: Install my own and team KissMySkills skills into Claude Code as real skills (with all their files)
argument-hint: "[--project] [--dry-run]"
---

KMS, sync my skills into Claude Code. Options: $ARGUMENTS

Use the KissMySkills connector (MCP server `kissmyskills`):

1. Call `my_skills_sync`. It returns a sync link valid for 10 minutes. Do not open, fetch or print the files yourself.
2. Run the plugin's sync script with that link (Node 18+), in one Bash call:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-skills.mjs" "<link>"`
   - If the options above include `--project`, add `--dir .claude/skills` (skills for this project only); otherwise the default is `~/.claude/skills`.
   - If they include `--dry-run`, add `--dry-run`.
   - If `${CLAUDE_PLUGIN_ROOT}` is not set, find the script with `ls ~/.claude/plugins/cache/*/kissmyskills/*/scripts/sync-skills.mjs ~/.claude/plugins/marketplaces/kissmyskills/scripts/sync-skills.mjs 2>/dev/null` and use the first match.
3. Report the script's summary in 1-2 lines (installed, updated, removed, skipped). New skills are picked up by Claude Code right away or after a restart; say so if anything was installed.

The script only writes text files into `<skills folder>/my-.../` and never runs them. It replaces or removes only folders it made itself (they carry a `.kms-sync.json` marker); other skills are never touched. Do not run any scripts inside the synced skills unless I ask for that skill's work.

If `my_skills_sync` is not available: the user is not signed in (run `/mcp`, pick `kissmyskills`, Authenticate) or the server does not offer own skills yet. Own skills are uploaded at https://app.kissmyskills.com (My skills).
