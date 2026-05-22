import { EmailMessage } from "cloudflare:email";

const FROM_ADDRESS = "hello@kitchenexplored.com";
const TO_ADDRESS   = "hello@kitchenexplored.com";

const ALLOWED_ORIGINS = [
  "https://kitchenexplored.com",
  "https://www.kitchenexplored.com",
  "http://localhost:4321",
  "http://localhost:4322",
  "http://localhost:4323",
];

const SUBJECT_LABELS = {
  "product-suggestion": "Product suggestion",
  "question":           "Question about a comparison",
  "partnership":        "Partnership or collaboration",
  "correction":         "Correction or feedback",
  "other":              "Other",
};

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function buildRawEmail({ replyTo, subject, body }) {
  return [
    `MIME-Version: 1.0`,
    `From: Kitchen Explored <${FROM_ADDRESS}>`,
    `To: ${TO_ADDRESS}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");
}

function toStream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors   = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, cors);
    }

    // Parse form fields
    let name, email, subject, message, honeypot;
    try {
      const fd = await request.formData();
      name     = (fd.get("name")     ?? "").toString().trim();
      email    = (fd.get("email")    ?? "").toString().trim();
      subject  = (fd.get("subject")  ?? "other").toString();
      message  = (fd.get("message")  ?? "").toString().trim();
      honeypot = (fd.get("_gotcha")  ?? "").toString(); // spam trap
    } catch {
      return json({ ok: false, error: "Invalid request body" }, 400, cors);
    }

    // Honeypot — bots fill hidden fields, humans don't
    if (honeypot) {
      return json({ ok: true }); // silently discard
    }

    if (!name || !email || !message) {
      return json({ ok: false, error: "Name, email, and message are required." }, 400, cors);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Please enter a valid email address." }, 400, cors);
    }

    const subjectLabel = SUBJECT_LABELS[subject] ?? "Other";
    const emailSubject = `[Kitchen Explored] ${subjectLabel} — from ${name}`;
    const emailBody = [
      `Name:    ${name}`,
      `Email:   ${email}`,
      `Subject: ${subjectLabel}`,
      ``,
      `--- Message ---`,
      message,
    ].join("\n");

    try {
      const raw = buildRawEmail({
        replyTo: `${name} <${email}>`,
        subject: emailSubject,
        body:    emailBody,
      });

      const msg = new EmailMessage(FROM_ADDRESS, TO_ADDRESS, toStream(raw));
      await env.SEND_EMAIL.send(msg);

      return json({ ok: true }, 200, cors);
    } catch (err) {
      console.error("send_email error:", err);
      return json({ ok: false, error: "Failed to send message. Please email us directly." }, 500, cors);
    }
  },
};
