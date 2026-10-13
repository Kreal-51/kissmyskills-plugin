---
description: Show what is on your KissMySkills CRM board today - overdue, due and next steps
argument-hint: "[optional project or space name]"
---

KMS, where were we? Show my board for today. $ARGUMENTS

Use the KissMySkills connector (MCP server `kissmyskills`):

1. Call `crm_today`. If I named a project or space above, also call `crm_list_spaces` to find it and `crm_search_records` to read its open cards.
2. Summarise per project: status, the next step with its date, and what is overdue. Keep it short; most urgent first.
3. End with the `ui_url` so I can open the board in the CRM.

Read only: do not change any records unless I ask in a follow-up message. If the `kissmyskills` tools are not available, tell me to run `/mcp`, pick `kissmyskills`, choose Authenticate and sign in with my email.
