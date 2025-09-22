// @ts-nocheck

/// <reference lib="deno.ns" />
/// <reference lib="dom" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ===== ENV =====
const TENANT_ID = Deno.env.get("TENANT_ID")!;
const CLIENT_ID = Deno.env.get("CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("CLIENT_SECRET")!;
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL")!; // support@applywizz.com
const PROJECT_URL = Deno.env.get("PROJECT_URL")!;   // e.g. https://your-site.vercel.app
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "";

// Supabase admin client
const sb = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

// ===== Microsoft Graph helpers =====
async function getGraphToken(): Promise<string> {
  const body = new URLSearchParams();
  body.set("client_id", CLIENT_ID);
  body.set("client_secret", CLIENT_SECRET);
  body.set("scope", "https://graph.microsoft.com/.default");
  body.set("grant_type", "client_credentials");

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body }
  );
  if (!res.ok) throw new Error(`Token error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.access_token as string;
}

async function sendGraphMail(
  to: string,
  subject: string,
  body: string,
  kind: "Text" | "HTML" = "Text"
) {
  const token = await getGraphToken();
  const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    SENDER_EMAIL
  )}/sendMail`;

  const payload = {
    message: {
      subject,
      body: { contentType: kind, content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`sendMail failed ${res.status}: ${await res.text()}`);
}

// ===== HTTP handler =====
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { mode, email, password, name, mobile } = body;

    if (mode !== "client-signup") {
      return new Response(JSON.stringify({ error: "mode must be client-signup" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || !password) {
      return new Response(JSON.stringify({ error: "email and password required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Create UNCONFIRMED user
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { role: "client", phone: mobile ?? null, name: name ?? email.split("@")[0] },
    });
    if (createErr) throw createErr;
    const uid = created.user?.id;

    // 2) Upsert profile with verified=false
    if (uid) {
      const { error: upsertErr } = await sb.from("profiles").upsert(
        {
          id: uid,
          user_id: uid,
          name: name ?? email.split("@")[0],
          email,
          role: "client",
          phone: mobile ?? null,
          verified: false,
        },
        { onConflict: "id" }
      );
      if (upsertErr) throw upsertErr;
    }

    // 3) Generate official confirmation link (redirect → /login)
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: { redirectTo: `${PROJECT_URL}/login` },
    });
    if (linkErr) throw linkErr;
    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) throw new Error("No action_link from generateLink");

    // 4) Send confirmation email
    const subject = "Confirm your ApplyWizz account";
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.6">
        <h2>Welcome to ApplyWizz 👋</h2>
        <p>Hi ${name ?? "there"}, please confirm your email to finish creating your account.</p>
        <p>
          <a href="${actionLink}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#111;color:#fff;text-decoration:none">
            Confirm my email
          </a>
        </p>
        <p>If the button doesn't work, copy and paste this link:</p>
        <p style="word-break:break-all">${actionLink}</p>
        <hr/>
        <p>After confirming, you'll be redirected to the login page.</p>
        <p>— ApplyWizz Support</p>
      </div>
    `;
    await sendGraphMail(email, subject, html, "HTML");

    return new Response(JSON.stringify({ ok: true, user_id: uid }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[client-signup-mails] error:", e?.message || e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
