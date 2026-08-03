import { NextResponse } from "next/server";
import { buildSystemPrompt, parseQualified } from "@/lib/chatPrompt";
import { callClaude } from "@/lib/claude";
import { sendTriggerEmail } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chat
 *  - action "trigger" : { brief, requesterEmail, source } -> envoie l'email de déclenchement (JSON)
 *  - sinon (conversation) : { messages, prenom, role } -> { text, qualified, brief } (JSON)
 *    (l'effet typewriter est géré côté client)
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Requête invalide", { status: 400 });
  }

  if (body.action === "trigger") {
    const brief = body.brief || {};
    const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
    const secret = process.env.WEBHOOK_SECRET;

    // Déclenchement instantané via Web App Apps Script (si configuré)
    if (webhookUrl && secret) {
      try {
        const r = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret, brief }),
        });
        const data: any = await r.json().catch(() => ({}));
        if (!r.ok || data.error) throw new Error(data.error || `Webhook HTTP ${r.status}`);
        return NextResponse.json({ ok: true, instant: true, ...data });
      } catch (e: any) {
        // Repli sur l'email de déclenchement si le webhook échoue
        try {
          const info = await sendTriggerEmail(brief, body.source || "Chat dashboard", body.requesterEmail || "inconnu");
          return NextResponse.json({ ok: true, instant: false, fallback: true, webhookError: e.message, ...info });
        } catch (e2: any) {
          return new NextResponse(e2.message || "Erreur déclenchement", { status: 500 });
        }
      }
    }

    // Sinon : ancien comportement (email de déclenchement, polling 15 min)
    try {
      const info = await sendTriggerEmail(brief, body.source || "Chat dashboard", body.requesterEmail || "inconnu");
      return NextResponse.json({ ok: true, instant: false, ...info });
    } catch (e: any) {
      return new NextResponse(e.message || "Erreur déclenchement", { status: 500 });
    }
  }

  try {
    const messages = (body.messages || []).filter((m: any) => m && m.content);
    const system = buildSystemPrompt(body.prenom || "", body.role || "");
    const reply = await callClaude(messages, system, 1024);
    const { qualified, brief, clean } = parseQualified(reply);
    // si qualifié, ne jamais renvoyer le bloc QUALIFIED brut (clean peut être vide)
    return NextResponse.json({ text: clean, qualified, brief });
  } catch (e: any) {
    return new NextResponse(e.message || "Erreur Claude", { status: 500 });
  }
}
