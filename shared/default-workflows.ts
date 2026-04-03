/**
 * Default workflows seeded during `kent init`.
 * Each workflow runs on a cron schedule via the daemon.
 */

export const DEFAULT_WORKFLOWS = [
   {
      name: "morning-briefing",
      description: "Daily morning briefing — calendar, emails, to-dos",
      cron_schedule: "0 8 * * *",
      source: "default" as const,
      prompt: `You are writing a morning briefing. Use the tools to gather data, then output ONLY the briefing. No preamble, no "let me check", no narration of what you're doing. Just the briefing.

Steps:
1. Use get_source_stats, then get_recent_items for each active source
2. Use search_memory if you need to find specific items
3. Use list_memories to recall known context about people and projects
4. If synced data is missing or sparse, use run_command to fill gaps:
   - Calendar: run_command("gh api /user") or check local calendar via CLI tools
   - Email: run_command("gws gmail list --unread --limit 10") if gmail data is stale
   - GitHub: run_command("gh notification list --limit 10") for fresh notifications
   - Notes: use read_file to check specific files if referenced in messages
5. Output the briefing using EXACTLY these headings:

## Todaydisk
One sentence on what's happening today. Meetings, events, or "clear day." Mention prereads or docs if attached.

## Prep
If meetings today have agendas, prereads, or shared docs, list them. If nothing needs prep, skip this section entirely.

## Upcoming week
2-3 sentences on the most important things this week. Names, times, conflicts.

## Emails
1-2 most important emails needing attention. Include time-sensitive items (bills, deadlines, renewals). Skip if nothing important.

## People
One sentence on who to follow up with or who reached out. Names only.

## To-do
3-5 actionable bullets:
- Follow-ups from meetings or messages
- Bills, payments, deadlines approaching
- Anything that will slip through the cracks today
Format: - **Task title** — brief context

Rules:
- Do NOT narrate your process. No "Let me check..." or "Based on the data..."
- Do NOT include empty sections. If a section has nothing, skip it entirely.
- Do NOT repeat items from previous briefings unless there is genuinely new information
- If something looks completed (confirmation email, reservation made), do not list it as a to-do
- Warm, short, direct. Like a friend catching you up over coffee.`,
   },
   {
      name: "evening-recap",
      description: "End-of-day recap — what happened, what's tomorrow",
      cron_schedule: "0 19 * * *",
      source: "default" as const,
      prompt: `You are writing an evening recap. Use the tools to gather today's data, then output ONLY the recap. No preamble, no narration. Just the recap.

Steps:
1. Use get_source_stats, then get_recent_items for each active source
2. Focus on what happened TODAY — not last week, not tomorrow's full schedule
3. If synced data is missing or incomplete, use run_command to get fresh data:
   - Calendar: run_command("gws calendar list --today") for today's events
   - Email: run_command("gws gmail list --after today --limit 20") for today's emails
   - GitHub: run_command("gh api /notifications?since=TODAY") for today's activity
4. Output using EXACTLY these headings:

## Today
What happened today in 2-3 sentences. Key meetings, decisions, accomplishments.

## Highlights
1-2 standout moments. A good conversation, a breakthrough, something notable. Skip if nothing stands out.

## Emails
Emails from today still needing attention. Include bills or deadlines spotted. Skip if nothing important.

## Tomorrow
Quick preview — meetings, prereads to review tonight, deadlines. If clear, say so.

## To-do
Follow-ups from today + prep for tomorrow as bullets.
Format: - **Task title** — brief context

Rules:
- Do NOT narrate your process. No "Let me check..." or "I can see..."
- Do NOT include empty sections. Skip anything with nothing to report.
- Only report on TODAY. Do not rehash old items unless there is new activity today.
- Deduplicate: if two items refer to the same task, merge into one bullet
- Do NOT carry forward stale to-dos. Only include items with fresh evidence they are pending.
- Short, warm, direct.`,
   },
   {
      name: "memory-curator",
      description: "Maintain a living knowledge base of useful context",
      cron_schedule: "0 10 * * *",
      source: "default" as const,
      prompt: `You are the memory curator. Your system prompt already contains ALL active memories. Use that to avoid duplicates. No narration — just do it.

Steps:
1. Review your system prompt's "Known Memories" section — this is the authoritative list of what already exists
2. Use get_source_stats and get_recent_items to review recent synced activity
3. Use get_recent_threads to see recent conversations, then get_thread_messages to read through them — these are the richest source of context about the user
4. For each new thing worth remembering:
   a. Check your Known Memories section — does a memory for this person/topic/project already exist?
   b. If YES: use update_memory with the existing ID to add new info. Do NOT create a second entry.
   c. If NO: use create_memory
5. Archive stale memories: any memory marked ⚠️ STALE in your Known Memories section (30+ days since last update) should be archived with archive_memory UNLESS it still has active relevance (ongoing project, active relationship, current preference)
6. Archive completed items: past events, finished projects, resolved topics — archive these regardless of age

What to look for in conversations:
- People the user mentioned or asked about — who are they, what's the relationship?
- Projects or goals discussed — what are they working on?
- Preferences revealed ("I prefer X", "don't do Y", decisions made)
- Plans or commitments mentioned (trips, deadlines, events)
- Topics they keep coming back to

What to save:
- **People**: who they are, what you're working on together, communication style
- **Projects**: current state, next steps, key decisions made
- **Plans**: upcoming trips, deadlines, commitments
- **Preferences**: how they like things done, tools they use
- **Topics**: things they're actively thinking about or learning

After updating memories, output a brief summary of what you changed (created/updated/archived).

Rules:
- Keep each memory body to 2-5 sentences
- The test: "Would this help me assist better next time?" If not, don't save it.
- NEVER create a memory if one already exists for the same person/topic — use update_memory instead
- Use search_memories as a fallback check if you're unsure whether a memory exists (e.g. searching by alias or nickname)
- DO NOT save: browsing patterns, judgmental observations, obvious calendar/inbox info
- DO NOT narrate your process. Just do the work and report what changed.`,
   },
   {
      name: "workflow-suggestor",
      description: "Suggest new automations based on actual patterns",
      cron_schedule: "30 9 * * *",
      source: "default" as const,
      prompt: `You analyze the user's data to find patterns and create genuinely useful workflow suggestions. Your goal is to understand what matters most to this person and build automations around their real priorities.

Steps:
1. Use get_source_stats to understand what data sources are active
2. Use get_recent_items for each source to see actual activity patterns
3. Use search_memory to dig into specific patterns (frequent contacts, recurring topics, repeated tasks)
4. Use list_memories to understand known context — who are the important people, what projects matter, what are they working toward?
5. Use list_workflows to check what already exists — do NOT suggest duplicates
6. Build a mental model of this person:
   - What are they trying to accomplish right now? (job search, project launch, school, etc.)
   - Who are the most important people in their life and work?
   - What do they spend the most time on? What drains their time?
   - What keeps falling through the cracks? Unanswered messages, missed follow-ups?
   - What meetings happen regularly? Do they need prep or follow-up?
   - What emails pile up? Are there categories that could be auto-handled?
   - What deadlines or commitments are they tracking?
   - What would make their day meaningfully easier?
7. Use create_workflow for each suggestion — prioritize high-impact automations that match their actual priorities, not generic productivity hacks

When calling create_workflow, write a DETAILED prompt. The prompt is the most important part — it is the full instruction set the agent receives when the workflow runs. A good prompt:
- Tells the agent exactly which tools to use (get_recent_items, search_memory, run_command, etc.)
- Specifies concrete actions to take, not just things to report
- References specific patterns you observed (actual names, actual frequencies, actual sources)
- Includes formatting instructions for the output
- Handles edge cases ("if nothing found, skip this section")
- Is at least 500+ characters — thorough, not generic
- Is tailored to THIS user, not a generic template

Set source to "suggested" on every create_workflow call.

After creating all suggestions, output:

## Suggestions Created

For each workflow:
- **name** — what it does, why it matters for THIS person specifically, and what pattern you observed that led to the suggestion

Be specific. "You message Grace almost daily but sometimes go 2-3 days without responding" is useful. "You communicate with people" is not.`,
   },
];
