/** POST /api/feedback — forward feedback to Formspree */

const FORMSPREE_URL = "https://formspree.io/f/xpqjnlzz";

export async function handleFeedback(req: Request) {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await req.json();
  const { type, message } = body as { type: string; message: string };

  if (!message?.trim()) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const subjectMap: Record<string, string> = {
    bug: "Bug Report",
    feature: "Feature Request",
    general: "General Feedback",
  };

  try {
    const res = await fetch(FORMSPREE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _subject: `[Kent Feedback] ${subjectMap[type] || "General Feedback"}`,
        type,
        message,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Formspree error:", err);
      return Response.json({ error: "Failed to send feedback" }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("Feedback send error:", e);
    return Response.json({ error: "Failed to send feedback" }, { status: 500 });
  }
}
