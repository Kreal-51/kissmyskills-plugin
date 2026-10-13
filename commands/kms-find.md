---
description: Find the best KissMySkills skill for a task and load it right away
argument-hint: <task or role, e.g. "SEO audit for my store">
---

KMS, find and load the best skill for this task: $ARGUMENTS

Use the KissMySkills connector (MCP server `kissmyskills`):

1. If the task above is empty, ask me in one line what I want to get done, then continue.
2. Call `search_skills` with 1-3 short English keywords for the role or deliverable (translate if needed). If I described a goal rather than a role, call `suggest_skills` with my description instead.
3. In the same turn, call `get_skill` on the match the reply names under LOAD NOW (up to 3 if they cover different parts of the task). If there is no LOAD NOW line, rephrase once and search again; if still weak, ask me one short question.
4. Say in one line which skill is active, then start working on the task in that role.

If the `kissmyskills` tools are not available, tell me to run `/mcp`, pick `kissmyskills`, choose Authenticate and sign in with my email (7-day free trial, no card).
