/** POST /api/feedback — send feedback email via Resend API */

const RESEND_API_KEY = "***REMOVED***";
const FROM_EMAIL = "feedback@meetkent.com";
const TO_EMAIL = "andysampark@gmail.com";

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
  const subject = `[Kent Feedback] ${subjectMap[type] || "General Feedback"}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Kent Feedback <${FROM_EMAIL}>`,
        to: [TO_EMAIL],
        subject,
        text: `Type: ${type}\n\n${message}`,
        html: `<div style="font-family: sans-serif; max-width: 600px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">${subjectMap[type] || "General"}</p>
          <div style="white-space: pre-wrap; font-size: 14px; line-height: 1.6; color: #1a1a1a;">${escapeHtml(message)}</div>
        </div>`,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend API error:", err);
      return Response.json({ error: "Failed to send feedback" }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("Feedback send error:", e);
    return Response.json({ error: "Failed to send feedback" }, { status: 500 });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
