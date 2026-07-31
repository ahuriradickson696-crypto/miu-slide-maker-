// Sends transactional email via Resend (https://resend.com) — chosen for
// a dead-simple fetch-based REST API with no SDK/native deps, a free
// tier, and good deliverability. Optional: if RESEND_API_KEY isn't set,
// email-dependent flows (password reset, email verification) still run,
// but the email is logged server-side instead of delivered — good enough
// for local dev, but production deployments that want working password
// reset need to set this up (see DEPLOYMENT.md).

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "MIU Slide Studio <onboarding@resend.dev>";

  if (!apiKey) {
    // Server-side only — never surfaced to the client. Lets a developer
    // testing locally without RESEND_API_KEY still grab the link from logs.
    console.log(
      JSON.stringify({
        event: "email_not_sent_no_provider",
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
      }),
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(JSON.stringify({ event: "email_send_failed", status: res.status, body }));
    // Don't throw — a failed email shouldn't reveal to the client whether
    // the address exists or leak provider errors. The generic "check your
    // inbox" response still applies; this is a server-side-only failure.
  }
}
