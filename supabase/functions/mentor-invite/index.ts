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
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL")!;
const PROJECT_URL = Deno.env.get("PROJECT_URL")!;
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
  const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER_EMAIL)}/sendMail`;

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

// ===== Mentor contact helper =====
async function getMentorContact(mentorId: string) {
  console.log(`Fetching mentor data for mentorId: ${mentorId}`);

  const { data: mentor, error } = await sb
    .from("mentors")
    .select("id, applicant_email, user_id, name") // Including applicant_email directly
    .eq("id", mentorId)
    .single();
  
  if (error || !mentor) {
    console.error(`Error fetching mentor: ${error?.message || "Mentor not found"}`);
    throw new Error(error?.message || "Mentor not found");
  }

  // Directly use the mentor's applicant_email
  let mentorEmail: string | null = mentor.applicant_email;
  console.log(`Found mentor email: ${mentorEmail}`);

  // If applicant_email is null or empty, check profiles table (fallback)
  if (!mentorEmail && mentor.user_id) {
    const { data: profile, error: pErr } = await sb
      .from("profiles")
      .select("email")
      .eq("id", mentor.user_id)
      .single();

    if (!pErr && profile?.email) {
      mentorEmail = profile.email;
      console.log(`Found mentor email from profiles: ${mentorEmail}`);
    }
  }

  // If still no email found, check Supabase Auth
  if (!mentorEmail && mentor.user_id) {
    const { data, error: uErr } = await sb.auth.admin.getUserById(mentor.user_id);
    if (!uErr && data?.user?.email) {
      mentorEmail = data.user.email as string;
      console.log(`Found mentor email from auth: ${mentorEmail}`);
    }
  }

  return { mentor, mentorEmail };
}

// ===== DB Webhook helpers =====
function isDbWebhookPayload(x: any) {
  return x && typeof x === "object" && "type" in x && "table" in x && "record" in x;
}

// Map your schema/statuses to internal modes
function mapWebhookToMode(payload: any) {
  const rec = payload.record || {};
  const norm = (v: any) => (v ?? "").toString().trim().toLowerCase();

  const status = norm(rec.status);

  if (payload.table !== "mentors") return null;

  // Handle mentor invite event
  if (payload.type === "INSERT" && status === "approved") {
    console.log(`Detected mentor invite for mentorId: ${rec.id}`);
    return {
      mode: "mentor-invite" as const,
      mentorId: rec.id,
    };
  }

  return null;
}

// ===== HTTP handler =====
Deno.serve(async (req: Request) => {
  console.log("Request received:", req);

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let body: any = {};
    try {
      body = await req.json();
      console.log("Parsed request body:", body);
    } catch {
      console.error("Failed to parse request body");
      body = {};
    }

    // If this is a DB webhook call, enforce shared secret
    if (isDbWebhookPayload(body)) {
      console.log("Received webhook payload");
      if (WEBHOOK_SECRET) {
        const provided = req.headers.get("x-webhook-secret");
        console.log("Webhook secret provided:", provided);
        if (provided !== WEBHOOK_SECRET) {
          console.error("Unauthorized webhook: invalid secret");
          return new Response(JSON.stringify({ error: "Unauthorized webhook" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Support BOTH: direct mode calls and DB webhook payloads
    let { mode, mentorId }: { mode?: "mentor-invite"; mentorId?: string } = body;

    if (isDbWebhookPayload(body)) {
      const translated = mapWebhookToMode(body);
      if (!translated) {
        console.log("Skipping invalid payload");
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      mode = translated.mode;
      mentorId = translated.mentorId;
    }

    if (!mode) {
      console.error("Missing mode in request");
      return new Response(JSON.stringify({ error: "mode required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- MENTOR INVITE ----
    if (mode === "mentor-invite") {
      console.log("Processing mentor invite for mentorId:", mentorId);

      if (!mentorId) {
        console.error("mentorId missing");
        return new Response(
          JSON.stringify({
            error: "mentorId is required for mode=mentor-invite",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load mentor details (name and email)
      const { mentor, mentorEmail } = await getMentorContact(mentorId);

      // Send the mentor invite email
      const passwordLink = `https://mentor-loop-zeta.vercel.app/set-password?mentorId=${mentorId}`;

      if (mentorEmail) {
        console.log("Sending mentor invite email to:", mentorEmail);
        await sendGraphMail(
          mentorEmail,
          "Welcome to Mentor Platform",
          `Please set your password to get started: ${passwordLink}`,
          "Text"
        );
      }

      // Return success
      console.log("Mentor invite sent successfully.");
      return new Response(JSON.stringify({ ok: true, mentorEmail }), { headers: corsHeaders });
    }

    // Fallback
    return new Response(JSON.stringify({ error: "invalid mode" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[mentor-invite-mails] error:", e?.message || e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
