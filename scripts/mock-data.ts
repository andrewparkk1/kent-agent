#!/usr/bin/env bun

/**
 * Populates Convex with realistic fake data for demos.
 *
 * Usage:
 *   bun run scripts/mock-data.ts
 *
 * Requires CONVEX_URL in .env or environment.
 */

const CONVEX_URL = process.env["CONVEX_URL"];
if (!CONVEX_URL) {
  console.error("CONVEX_URL not set. Add it to .env or export it.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_URL = `${CONVEX_URL.replace(/\/$/, "")}/api/mutation`;

async function insertItem(item: {
  deviceToken: string;
  source: string;
  externalId: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}): Promise<void> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "items:insert",
      args: item,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`  Failed to insert ${item.source}/${item.externalId}: ${text}`);
  }
}

function daysAgo(n: number, hourOffset = 0): number {
  return Math.floor((Date.now() - n * 86400000 - hourOffset * 3600000) / 1000);
}

function hoursAgo(n: number): number {
  return Math.floor((Date.now() - n * 3600000) / 1000);
}

// ---------------------------------------------------------------------------
// People (coherent across all sources)
// ---------------------------------------------------------------------------

const PEOPLE = {
  sarah: { name: "Sarah Chen", email: "sarah.chen@company.com", phone: "+1 (415) 555-0142", github: "sarahchen" },
  alex: { name: "Alex Rivera", email: "alex.rivera@company.com", phone: "+1 (415) 555-0187", github: "arivera" },
  david: { name: "David Kim", email: "david.kim@company.com", phone: "+1 (415) 555-0203", github: "dkim" },
  maya: { name: "Maya Patel", email: "maya.patel@company.com", phone: "+1 (415) 555-0291", github: "mayap" },
  james: { name: "James Wu", email: "james.wu@company.com", phone: "+1 (415) 555-0315", github: "jameswu" },
  lisa: { name: "Lisa Thompson", email: "lisa.t@vendor.io", phone: "+1 (650) 555-0422", github: "lisat" },
  mike: { name: "Mike Johnson", email: "mike.j@client.co", phone: "+1 (510) 555-0538", github: "mikej" },
};

// Device token for demo user (matches what kent init would generate)
const DEVICE_TOKEN = "demo-device-token-for-testing";

// ---------------------------------------------------------------------------
// iMessage data (50 messages)
// ---------------------------------------------------------------------------

const IMESSAGES: Array<{
  id: number;
  from: string;
  text: string;
  hoursAgo: number;
  isFromMe: boolean;
  chatName?: string;
}> = [
  // Thread with Sarah about PR review
  { id: 1001, from: "sarah", text: "Hey, I left some comments on your API migration PR", hoursAgo: 4, isFromMe: false },
  { id: 1002, from: "sarah", text: "Mostly looks good but the retry logic in the auth middleware needs work", hoursAgo: 4, isFromMe: false },
  { id: 1003, from: "sarah", text: "Can you take a look today?", hoursAgo: 4, isFromMe: false },
  { id: 1004, from: "sarah", text: "Will do, looking at it now", hoursAgo: 3, isFromMe: true },
  { id: 1005, from: "sarah", text: "Actually I think the exponential backoff is fine, the issue is the max retries config", hoursAgo: 2, isFromMe: true },
  { id: 1006, from: "sarah", text: "Ah you're right. Can you just add a comment explaining the 5-retry default?", hoursAgo: 2, isFromMe: false },

  // Thread with Alex about vendor contract
  { id: 1007, from: "alex", text: "Forwarded you the vendor contract from Lisa", hoursAgo: 6, isFromMe: false },
  { id: 1008, from: "alex", text: "Can you review the SLA section? Particularly the uptime guarantees", hoursAgo: 6, isFromMe: false },
  { id: 1009, from: "alex", text: "I'll take a look this afternoon", hoursAgo: 5, isFromMe: true },
  { id: 1010, from: "alex", text: "Cool. Lisa needs our response by Thursday", hoursAgo: 5, isFromMe: false },
  { id: 1011, from: "alex", text: "The 99.9% uptime clause looks standard. My concern is the penalty structure.", hoursAgo: 3, isFromMe: true },
  { id: 1012, from: "alex", text: "Good catch. Can you draft a counter-proposal?", hoursAgo: 3, isFromMe: false },

  // Thread with David about Q1 planning
  { id: 1013, from: "david", text: "Great meeting today. Can you own the timeline doc?", hoursAgo: 8, isFromMe: false },
  { id: 1014, from: "david", text: "Sure, I'll have a draft by Friday", hoursAgo: 8, isFromMe: true },
  { id: 1015, from: "david", text: "Perfect. Loop in Maya for the frontend estimates", hoursAgo: 7, isFromMe: false },
  { id: 1016, from: "david", text: "Already pinged her", hoursAgo: 7, isFromMe: true },
  { id: 1017, from: "david", text: "Also the headcount request is pending VP approval", hoursAgo: 5, isFromMe: false },
  { id: 1018, from: "david", text: "Should hear back by Monday", hoursAgo: 5, isFromMe: false },

  // Thread with Maya about frontend work
  { id: 1019, from: "maya", text: "David said you need frontend estimates for Q1?", hoursAgo: 6, isFromMe: false },
  { id: 1020, from: "maya", text: "Yeah, specifically the dashboard redesign and the new onboarding flow", hoursAgo: 6, isFromMe: true },
  { id: 1021, from: "maya", text: "Dashboard is ~3 weeks, onboarding ~2 weeks. I'll write it up formally.", hoursAgo: 5, isFromMe: false },
  { id: 1022, from: "maya", text: "That includes the accessibility audit?", hoursAgo: 5, isFromMe: true },
  { id: 1023, from: "maya", text: "Yes, baked in. We learned our lesson last quarter.", hoursAgo: 5, isFromMe: false },

  // Thread with James about deploy issue
  { id: 1024, from: "james", text: "Heads up: staging deploy just failed", hoursAgo: 2, isFromMe: false },
  { id: 1025, from: "james", text: "Error in the auth middleware, looks like it's your recent commit", hoursAgo: 2, isFromMe: false },
  { id: 1026, from: "james", text: "Commit abc123 right?", hoursAgo: 2, isFromMe: true },
  { id: 1027, from: "james", text: "Yeah. The token validation is throwing on null tokens instead of returning 401", hoursAgo: 1, isFromMe: false },
  { id: 1028, from: "james", text: "Fixing now, should have a patch in 10 min", hoursAgo: 1, isFromMe: true },
  { id: 1029, from: "james", text: "Nice, I'll keep an eye on the deploy", hoursAgo: 1, isFromMe: false },

  // Casual threads
  { id: 1030, from: "sarah", text: "Lunch at the usual place?", hoursAgo: 26, isFromMe: false },
  { id: 1031, from: "sarah", text: "Sure, 12:30?", hoursAgo: 26, isFromMe: true },
  { id: 1032, from: "sarah", text: "Perfect", hoursAgo: 25, isFromMe: false },
  { id: 1033, from: "alex", text: "Did you see the Warriors game last night?", hoursAgo: 14, isFromMe: false },
  { id: 1034, from: "alex", text: "Curry was insane in the 4th quarter", hoursAgo: 14, isFromMe: true },
  { id: 1035, from: "alex", text: "Right?? That step-back three with 30 seconds left", hoursAgo: 14, isFromMe: false },

  // Group chat
  { id: 1036, from: "david", text: "Team happy hour Friday at 5?", hoursAgo: 28, isFromMe: false, chatName: "Engineering Team" },
  { id: 1037, from: "maya", text: "I'm in!", hoursAgo: 28, isFromMe: false, chatName: "Engineering Team" },
  { id: 1038, from: "sarah", text: "+1", hoursAgo: 27, isFromMe: false, chatName: "Engineering Team" },
  { id: 1039, from: "james", text: "Same place as last time?", hoursAgo: 27, isFromMe: false, chatName: "Engineering Team" },
  { id: 1040, from: "david", text: "Yeah, Zeitgeist. I'll book the back area.", hoursAgo: 27, isFromMe: false, chatName: "Engineering Team" },
  { id: 1041, from: "sarah", text: "Sounds good!", hoursAgo: 27, isFromMe: true, chatName: "Engineering Team" },

  // More work threads
  { id: 1042, from: "maya", text: "The component library PR is ready for review when you get a chance", hoursAgo: 10, isFromMe: false },
  { id: 1043, from: "maya", text: "Added dark mode support and the new date picker", hoursAgo: 10, isFromMe: false },
  { id: 1044, from: "james", text: "I updated the CI config to run tests in parallel. Build time went from 8min to 3min.", hoursAgo: 12, isFromMe: false },
  { id: 1045, from: "james", text: "That's amazing, great work", hoursAgo: 11, isFromMe: true },
  { id: 1046, from: "david", text: "Budget meeting moved to Thursday 2pm", hoursAgo: 30, isFromMe: false },
  { id: 1047, from: "alex", text: "Can you send me the updated architecture diagram?", hoursAgo: 20, isFromMe: false },
  { id: 1048, from: "alex", text: "Sent, check your email", hoursAgo: 20, isFromMe: true },
  { id: 1049, from: "sarah", text: "The new monitoring dashboards look great btw", hoursAgo: 16, isFromMe: false },
  { id: 1050, from: "sarah", text: "Thanks! Grafana makes it pretty easy once you get the queries right", hoursAgo: 16, isFromMe: true },
];

// ---------------------------------------------------------------------------
// Granola meetings (5 meetings)
// ---------------------------------------------------------------------------

const GRANOLA_MEETINGS = [
  {
    id: "granola-q1-planning",
    title: "Q1 Planning — Engineering",
    participants: [PEOPLE.david.name, PEOPLE.maya.name, PEOPLE.sarah.name, PEOPLE.james.name],
    summary: "Discussed Q1 priorities: dashboard redesign, API migration, and new onboarding flow. David wants timeline doc by Friday. Maya estimated 3 weeks for dashboard, 2 weeks for onboarding. Headcount request pending VP approval — should hear by Monday. Need to finalize vendor selection for monitoring tools.",
    notes: "- Dashboard redesign: Maya leading, 3 week estimate\n- API migration: already in progress, PR #247 open\n- Onboarding flow: 2 weeks, includes accessibility audit\n- ACTION: Draft timeline doc by Friday (assigned to me)\n- ACTION: Loop in Maya for frontend estimates\n- Headcount: 2 senior engineers requested, pending VP approval\n- Next sync: Monday 10am",
    daysAgo: 0,
    hourOffset: 8,
  },
  {
    id: "granola-vendor-review",
    title: "Vendor Review — Monitoring Tools",
    participants: [PEOPLE.alex.name, PEOPLE.lisa.name],
    summary: "Reviewed three monitoring vendors: DataDog, Grafana Cloud, and New Relic. Grafana Cloud is the most cost-effective at our scale. Lisa from vendor.io presented their enterprise SLA. Key concern: uptime guarantee penalty structure needs renegotiation.",
    notes: "- Grafana Cloud: $2.4k/mo, best fit for our scale\n- DataDog: $5.1k/mo, feature-rich but expensive\n- New Relic: $3.2k/mo, good but migration cost high\n- Lisa's SLA: 99.9% uptime, but penalty caps at 10% — we need 25%\n- ACTION: Draft counter-proposal for SLA penalties\n- Decision deadline: Thursday",
    daysAgo: 1,
    hourOffset: 6,
  },
  {
    id: "granola-sprint-retro",
    title: "Sprint 23 Retrospective",
    participants: [PEOPLE.david.name, PEOPLE.maya.name, PEOPLE.sarah.name, PEOPLE.james.name],
    summary: "Sprint 23 velocity was 34 points (target: 30). Shipped the auth middleware refactor, new search API, and started the dashboard redesign. CI build time improvement by James was a major win. Concern: too many context switches between projects.",
    notes: "- Shipped: auth middleware refactor, search API v2, CI parallelization\n- In progress: dashboard redesign, API migration\n- Velocity: 34/30 (113%)\n- What went well: CI improvements, pair programming on auth\n- What to improve: too many parallel workstreams, need to limit WIP\n- ACTION: Limit WIP to 2 items per person next sprint\n- ACTION: James to document CI config for other teams",
    daysAgo: 3,
    hourOffset: 4,
  },
  {
    id: "granola-1on1-david",
    title: "1:1 with David",
    participants: [PEOPLE.david.name],
    summary: "Discussed career growth path and Q1 goals. David supportive of taking on more architecture ownership. Talked about the tech lead role opening — he'll put in a recommendation. Need to document more of my system design decisions.",
    notes: "- Career: tech lead role opening in Q2\n- David will recommend me if I'm interested\n- Need to: document architecture decisions, mentor junior devs, lead more design reviews\n- Q1 goals: ship API migration, own monitoring rollout\n- Feedback: doing well on execution, need more visibility on cross-team work\n- Next 1:1: in 2 weeks",
    daysAgo: 5,
    hourOffset: 3,
  },
  {
    id: "granola-incident-review",
    title: "Incident Review — Production Outage Feb 12",
    participants: [PEOPLE.sarah.name, PEOPLE.james.name, PEOPLE.david.name],
    summary: "Reviewed the 47-minute production outage caused by a misconfigured rate limiter. Root cause: environment variable not propagated to new deployment. James's monitoring caught it within 3 minutes. Fix: add env var validation to deploy pipeline.",
    notes: "- Incident duration: 47 minutes (3min detection, 44min resolution)\n- Root cause: RATE_LIMIT_MAX env var missing from production deploy\n- Impact: 2,340 users saw 503 errors\n- Detection: James's new Grafana alert triggered at 2:03am\n- Fix: Added env var validation step to CI/CD pipeline\n- ACTION: Sarah to add integration test for rate limiter config\n- ACTION: James to add pre-deploy env var check\n- Blameless — process issue, not people issue",
    daysAgo: 7,
    hourOffset: 2,
  },
];

// ---------------------------------------------------------------------------
// Gmail data (20 emails)
// ---------------------------------------------------------------------------

const GMAIL_MESSAGES = [
  { id: "gmail-001", from: PEOPLE.alex.email, subject: "Fwd: Vendor Contract — SLA Review", snippet: "Hey, forwarding the contract from Lisa. Can you review the SLA section, particularly the uptime guarantees and penalty structure? Need our response by Thursday.", hoursAgo: 6, labels: ["INBOX", "IMPORTANT"] },
  { id: "gmail-002", from: PEOPLE.lisa.email, subject: "RE: Enterprise SLA Proposal", snippet: "Thanks for the feedback. We can adjust the penalty cap to 20% but 25% is outside our standard terms. Happy to schedule a call to discuss alternatives.", hoursAgo: 4, labels: ["INBOX"] },
  { id: "gmail-003", from: PEOPLE.david.email, subject: "Q1 Timeline — Please Review", snippet: "Attaching the Q1 timeline template. Can you fill in the backend milestones and share with Maya for frontend estimates? Due Friday.", hoursAgo: 8, labels: ["INBOX", "STARRED"] },
  { id: "gmail-004", from: "notifications@github.com", subject: "[kent-cli/backend] PR #247: API Migration — Review requested", snippet: "sarahchen requested your review on PR #247. 3 files changed, 247 additions, 89 deletions.", hoursAgo: 5, labels: ["INBOX", "github"] },
  { id: "gmail-005", from: "notifications@github.com", subject: "[kent-cli/backend] PR #247: Comment from sarahchen", snippet: "The retry logic in auth middleware needs exponential backoff with jitter. Currently it's linear which could cause thundering herd.", hoursAgo: 4, labels: ["INBOX", "github"] },
  { id: "gmail-006", from: PEOPLE.sarah.email, subject: "Monitoring Dashboard Access", snippet: "Can you add me to the Grafana Cloud org? I want to set up alerts for the new search API endpoints.", hoursAgo: 12, labels: ["INBOX"] },
  { id: "gmail-007", from: PEOPLE.james.email, subject: "CI Build Time Improvements", snippet: "Quick summary: parallelized test suites across 4 workers, added dependency caching, result: 8min -> 3min average build time. Details in the wiki.", hoursAgo: 14, labels: ["INBOX"] },
  { id: "gmail-008", from: "no-reply@convex.dev", subject: "Your Convex usage this week", snippet: "Your project kent-backend used 2.1M function calls this week. You're at 45% of your plan limit.", hoursAgo: 48, labels: ["INBOX"] },
  { id: "gmail-009", from: PEOPLE.maya.email, subject: "Component Library — Dark Mode PR", snippet: "PR is up for the dark mode support. Also added the new date picker component. Would love your review when you get a chance.", hoursAgo: 10, labels: ["INBOX"] },
  { id: "gmail-010", from: PEOPLE.david.email, subject: "Team Happy Hour — Friday", snippet: "Booking Zeitgeist for Friday 5pm. Back area reserved. Let me know if you have dietary restrictions for the food order.", hoursAgo: 28, labels: ["INBOX", "social"] },
  { id: "gmail-011", from: "hr@company.com", subject: "Benefits Open Enrollment Reminder", snippet: "Open enrollment closes March 31. Review your selections at benefits.company.com. Changes take effect April 1.", hoursAgo: 72, labels: ["INBOX"] },
  { id: "gmail-012", from: PEOPLE.mike.email, subject: "API Integration Questions", snippet: "We're integrating with your search API v2. A few questions about rate limits and pagination. Can we schedule a 30-min call this week?", hoursAgo: 18, labels: ["INBOX", "IMPORTANT"] },
  { id: "gmail-013", from: "notifications@github.com", subject: "[kent-cli/frontend] Issue #312: Dashboard performance regression", snippet: "Reported by mayap: Dashboard load time increased from 1.2s to 3.8s after the recent bundle update. Needs investigation.", hoursAgo: 16, labels: ["INBOX", "github"] },
  { id: "gmail-014", from: PEOPLE.sarah.email, subject: "RE: Architecture Diagram", snippet: "Got it, thanks. I'll use this for the design review on Wednesday. One question — is the caching layer in front of or behind the auth middleware?", hoursAgo: 20, labels: ["INBOX"] },
  { id: "gmail-015", from: "billing@e2b.dev", subject: "E2B Invoice — February 2025", snippet: "Your February invoice for $47.20 is ready. 1,240 sandbox hours used across 3 templates.", hoursAgo: 120, labels: ["INBOX", "receipts"] },
  { id: "gmail-016", from: PEOPLE.james.email, subject: "Staging Deploy Failed — Auth Middleware", snippet: "Deploy to staging failed at 2:14pm. Error in auth middleware — null token handling. Looks like commit abc123. Can you take a look?", hoursAgo: 2, labels: ["INBOX", "IMPORTANT"] },
  { id: "gmail-017", from: "notifications@github.com", subject: "[kent-cli/infra] PR #89: Add env var validation to deploy pipeline", snippet: "jameswu opened PR #89: Adds pre-deploy validation for required environment variables. Prevents the Feb 12 outage scenario.", hoursAgo: 36, labels: ["INBOX", "github"] },
  { id: "gmail-018", from: PEOPLE.david.email, subject: "Headcount Update", snippet: "VP approved one of the two senior engineer positions. We can open the req next week. Other position deferred to Q2.", hoursAgo: 24, labels: ["INBOX", "IMPORTANT"] },
  { id: "gmail-019", from: "newsletters@changelog.com", subject: "The Changelog — This week in open source", snippet: "Bun 1.2 released with Windows support. Convex adds vector search. TypeScript 5.4 beta drops.", hoursAgo: 50, labels: ["newsletters"] },
  { id: "gmail-020", from: PEOPLE.maya.email, subject: "Accessibility Audit Results", snippet: "Ran axe-core on the current dashboard. 12 issues found: 4 critical (missing alt text, low contrast), 8 minor. Full report attached.", hoursAgo: 22, labels: ["INBOX"] },
];

// ---------------------------------------------------------------------------
// GitHub notifications (15 notifications)
// ---------------------------------------------------------------------------

const GITHUB_NOTIFICATIONS = [
  { id: "gh-001", reason: "review_requested", title: "API Migration — Phase 2", repo: "kent-cli/backend", type: "PullRequest", hoursAgo: 5 },
  { id: "gh-002", reason: "comment", title: "Retry logic needs exponential backoff", repo: "kent-cli/backend", type: "PullRequest", hoursAgo: 4 },
  { id: "gh-003", reason: "comment", title: "Max retries should be configurable", repo: "kent-cli/backend", type: "PullRequest", hoursAgo: 3 },
  { id: "gh-004", reason: "assign", title: "Dashboard performance regression after bundle update", repo: "kent-cli/frontend", type: "Issue", hoursAgo: 16 },
  { id: "gh-005", reason: "mention", title: "Add env var validation to deploy pipeline", repo: "kent-cli/infra", type: "PullRequest", hoursAgo: 36 },
  { id: "gh-006", reason: "review_requested", title: "Dark mode support + new date picker", repo: "kent-cli/frontend", type: "PullRequest", hoursAgo: 10 },
  { id: "gh-007", reason: "ci_activity", title: "Staging deploy failed — auth middleware null check", repo: "kent-cli/backend", type: "CheckRun", hoursAgo: 2 },
  { id: "gh-008", reason: "assign", title: "Document search API v2 rate limits", repo: "kent-cli/docs", type: "Issue", hoursAgo: 18 },
  { id: "gh-009", reason: "comment", title: "Search API pagination returns wrong cursor", repo: "kent-cli/backend", type: "Issue", hoursAgo: 24 },
  { id: "gh-010", reason: "review_requested", title: "Parallelize CI test suites", repo: "kent-cli/infra", type: "PullRequest", hoursAgo: 14 },
  { id: "gh-011", reason: "mention", title: "Sprint 24 planning", repo: "kent-cli/meta", type: "Issue", hoursAgo: 8 },
  { id: "gh-012", reason: "state_change", title: "Upgrade Convex SDK to v1.9", repo: "kent-cli/backend", type: "PullRequest", hoursAgo: 48 },
  { id: "gh-013", reason: "assign", title: "Add Grafana dashboard for search API", repo: "kent-cli/infra", type: "Issue", hoursAgo: 12 },
  { id: "gh-014", reason: "comment", title: "Rate limiter config should use env vars", repo: "kent-cli/backend", type: "Issue", hoursAgo: 40 },
  { id: "gh-015", reason: "security_alert", title: "Dependabot: lodash prototype pollution", repo: "kent-cli/frontend", type: "SecurityAdvisory", hoursAgo: 60 },
];

// ---------------------------------------------------------------------------
// Insert all data
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Populating Convex with demo data...\n");

  // iMessages
  console.log("  [imessage] Inserting 50 messages...");
  for (const msg of IMESSAGES) {
    const person = PEOPLE[msg.from as keyof typeof PEOPLE];
    await insertItem({
      deviceToken: DEVICE_TOKEN,
      source: "imessage",
      externalId: `imessage-${msg.id}`,
      content: msg.text,
      metadata: {
        isFromMe: msg.isFromMe,
        service: "iMessage",
        handle: msg.isFromMe ? null : person?.phone ?? msg.from,
        chatName: msg.chatName ?? null,
        chatIdentifier: msg.chatName ?? person?.phone ?? null,
        senderName: msg.isFromMe ? "Me" : person?.name ?? msg.from,
      },
      createdAt: hoursAgo(msg.hoursAgo),
    });
  }
  console.log("  [imessage] Done\n");

  // Granola meetings
  console.log("  [granola] Inserting 5 meetings...");
  for (const meeting of GRANOLA_MEETINGS) {
    const contentParts = [
      `# ${meeting.title}`,
      `Participants: ${meeting.participants.join(", ")}`,
      `## Summary\n${meeting.summary}`,
      `## Notes\n${meeting.notes}`,
    ];
    await insertItem({
      deviceToken: DEVICE_TOKEN,
      source: "granola",
      externalId: meeting.id,
      content: contentParts.join("\n\n"),
      metadata: {
        title: meeting.title,
        participants: meeting.participants,
        hasSummary: true,
        hasNotes: true,
        hasTranscript: false,
      },
      createdAt: daysAgo(meeting.daysAgo, meeting.hourOffset),
    });
  }
  console.log("  [granola] Done\n");

  // Gmail
  console.log("  [gmail] Inserting 20 emails...");
  for (const email of GMAIL_MESSAGES) {
    await insertItem({
      deviceToken: DEVICE_TOKEN,
      source: "gmail",
      externalId: email.id,
      content: `Subject: ${email.subject}\nFrom: ${email.from}\n${email.snippet}`,
      metadata: {
        subject: email.subject,
        from: email.from,
        labels: email.labels,
        hasAttachments: false,
      },
      createdAt: hoursAgo(email.hoursAgo),
    });
  }
  console.log("  [gmail] Done\n");

  // GitHub notifications
  console.log("  [github] Inserting 15 notifications...");
  for (const notif of GITHUB_NOTIFICATIONS) {
    await insertItem({
      deviceToken: DEVICE_TOKEN,
      source: "github",
      externalId: `github-notif-${notif.id}`,
      content: `[${notif.reason}] ${notif.title}`,
      metadata: {
        type: "notification",
        reason: notif.reason,
        repo: notif.repo,
        subjectType: notif.type,
        unread: notif.hoursAgo < 12,
      },
      createdAt: hoursAgo(notif.hoursAgo),
    });
  }
  console.log("  [github] Done\n");

  const total = IMESSAGES.length + GRANOLA_MEETINGS.length + GMAIL_MESSAGES.length + GITHUB_NOTIFICATIONS.length;
  console.log(`Inserted ${total} items across 4 sources.`);
  console.log("Device token for demo: " + DEVICE_TOKEN);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
