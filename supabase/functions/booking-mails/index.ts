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
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL")!; // e.g., support@applywizz.com
const PROJECT_URL = Deno.env.get("PROJECT_URL")!;    // https://<ref>.supabase.co
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || ""; // required on webhook calls

// ✅ Use the exact mentor dashboard route you provided
const MENTOR_DASHBOARD_URL = "https://mentor-loop-zeta.vercel.app/dashboard/mentor";

type Mode = "book" | "confirm" | "cancel" | "mentor-invite";

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
// mentors.user_id -> profiles.email (fallback to auth.users.email)
async function getMentorContact(mentorId: string) {
  const { data: mentor, error } = await sb
    .from("mentors")
    .select("id, user_id, name")
    .eq("id", mentorId)
    .single();
  if (error || !mentor) throw new Error(error?.message || "Mentor not found");

  let mentorEmail: string | null = null;

  if (mentor.user_id) {
    const { data: profile, error: pErr } = await sb
      .from("profiles")
      .select("email")
      .eq("id", mentor.user_id)
      .single();
    if (!pErr && profile?.email) mentorEmail = profile.email;

    if (!mentorEmail) {
      const { data, error: uErr } = await sb.auth.admin.getUserById(mentor.user_id);
      if (!uErr && data?.user?.email) mentorEmail = data.user.email as string;
    }
  }

  return { mentor, mentorEmail };
}

// ===== DB Webhook helpers =====
function isDbWebhookPayload(x: any) {
  // Supabase row webhooks: { type, table, record, old_record, ... }
  return x && typeof x === "object" && "type" in x && "table" in x && "record" in x;
}

// Map your schema/statuses to internal modes
function mapWebhookToMode(payload: any) {
  const rec = payload.record || {};
  const old = payload.old_record || {};
  const norm = (v: any) => (v ?? "").toString().trim().toLowerCase();

  const status    = norm(rec.status);
  const oldStatus = norm(old?.status);

  if (payload.table !== "bookings") return null;

  // Treat 'pending', 'requested', and the common typo 'penidng' as "book"
  const isNewBooking =
    payload.type === "INSERT" &&
    (status === "pending" || status === "requested" || status === "penidng");

  if (isNewBooking) {
    return {
      mode:        "book" as const,
      bookingId:   rec.id,            // <— we capture bookingId for deep-link
      mentorId:    rec.mentor_id,
      clientId:    rec.client_id,
      slotId:      rec.slot_id,
      menteeName:  rec.mentee_name,
      menteeEmail: rec.mentee_email,
    };
  }

  // Status changed → confirm/cancel
  if (payload.type === "UPDATE" && oldStatus !== status) {
    if (status === "confirmed") return { mode: "confirm" as const, bookingId: rec.id };
    if (status === "cancel" || status === "cancelled" || status === "canceled" || status === "rejected") {
      return { mode: "cancel" as const, bookingId: rec.id };
    }
  }
  return null;
}

// ===== HTTP handler =====
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Parse body safely
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    // If this is a DB webhook call, enforce shared secret
    if (isDbWebhookPayload(body)) {
      if (WEBHOOK_SECRET) {
        const provided = req.headers.get("x-webhook-secret");
        if (provided !== WEBHOOK_SECRET) {
          return new Response(JSON.stringify({ error: "Unauthorized webhook" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Support BOTH: direct mode calls and DB webhook payloads
    let {
      mode,              // "book" | "confirm" | "cancel" | "mentor-invite"
      mentorId,
      clientId,
      slotId,
      menteeName,
      menteeEmail,
      bookingId,
      htmlClient,
      htmlMentor,
    }: {
      mode?: Mode;
      mentorId?: string;
      clientId?: string;
      slotId?: string;
      menteeName?: string;
      menteeEmail?: string;
      bookingId?: string;
      htmlClient?: string;
      htmlMentor?: string;
    } = body;

    // Translate webhook payload → internal fields
    if (isDbWebhookPayload(body)) {
      const translated = mapWebhookToMode(body);
      if (!translated) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      mode        = translated.mode;
      mentorId    = translated.mentorId    ?? mentorId;
      clientId    = translated.clientId    ?? clientId;
      slotId      = translated.slotId      ?? slotId;
      menteeName  = translated.menteeName  ?? menteeName;
      menteeEmail = translated.menteeEmail ?? menteeEmail;
      bookingId   = translated.bookingId   ?? bookingId;  // <— ensure we keep it
    }

    if (!mode) {
      return new Response(JSON.stringify({ error: "mode required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- MENTOR INVITE ----
    if (mode === "mentor-invite") {
      if (!mentorId || !menteeEmail) {
        return new Response(
          JSON.stringify({
            error: "mentorId and menteeEmail are required for mode=mentor-invite",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load mentor details (name and email)
      const { mentor, mentorEmail } = await getMentorContact(mentorId);

      // Send the mentor invite email
      const passwordLink = `https://mentor-loop-zeta.vercel.app/set-password?mentorId=${mentorId}`;

      if (mentorEmail) {
        await sendGraphMail(
          mentorEmail,
          "Welcome to Mentor Platform",
          `Please set your password to get started: ${passwordLink}`
        );
      }

      // Return success
      return new Response(JSON.stringify({ ok: true, mentorEmail }), { headers: corsHeaders });
    }

    // ---- BOOK ----
    if (mode === "book") {
      if (!mentorId || !clientId || !slotId || !menteeEmail) {
        return new Response(
          JSON.stringify({
            error: "mentorId, clientId, slotId, menteeEmail are required for mode=book",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load mentor + resolve email from profiles/auth.users
      const { mentor, mentorEmail } = await getMentorContact(mentorId);

      // If direct call (not via webhook), insert booking with status 'pending'
      if (!isDbWebhookPayload(body)) {
        const { data: ins, error: bErr } = await sb.from("bookings").insert([{
          mentor_id:    mentorId,
          client_id:    clientId,
          slot_id:      slotId,
          mentee_name:  menteeName || null,
          mentee_email: menteeEmail,
          status:       "pending",
        }]).select("id").single();
        if (bErr) throw new Error(bErr.message);
        // use the fresh id for deep link
        bookingId = ins?.id ?? bookingId;
      }

      // Notifications (best-effort)
      const { error: nErr } = await sb.from("notifications").insert([
        { user_id: mentor.user_id, message: `New session booked by ${menteeEmail}`, read: false, type: "mentor" },
        { user_id: clientId,       message: `Your session with ${mentor.name ?? "your mentor"} is requested.`, read: false, type: "client" },
      ]);
      if (nErr) console.warn("[booking-mails] notifications insert failed:", nErr.message);

      // Emails via Graph
      // To client
      if (htmlClient) {
        await sendGraphMail(menteeEmail, "Session Booked", htmlClient, "HTML");
      } else {
        await sendGraphMail(
          menteeEmail,
          "Session Booking request ",
          "Your session booking request has been sent  successfully. Please wait for confirmation from your mentor.",
          "Text"
        );
      }

      // To mentor (if we found a contact email) — build clickable HTML link with bookingId
      if (mentorEmail) {
        const sep = MENTOR_DASHBOARD_URL.includes("?") ? "&" : "?";
        const confirmUrl = `${MENTOR_DASHBOARD_URL}${sep}bookingId=${encodeURIComponent(bookingId ?? "")}`;

        const mentorHtml = htmlMentor ?? `
          <html>
            <body style="font-family: Arial, sans-serif; line-height:1.6; color:#222;">
              <p>A client has booked a session with you.</p>
              <p>
                Please confirm or delete the request using this link:<br/>
                <a href="${confirmUrl}" target="_blank" rel="noopener noreferrer">${confirmUrl}</a>
              </p>
            </body>
          </html>
        `;

        await sendGraphMail(mentorEmail, "New Session Booking Request", mentorHtml, "HTML");
      } else {
        console.warn(`[booking-mails] mentor ${mentorId} has no email in profiles/auth.users — skipped mentor email`);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- CONFIRM ----
    if (mode === "confirm") {
      if (!bookingId) {
        return new Response(JSON.stringify({ error: "bookingId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // If direct call, perform the status update; webhook path already did it.
      if (!isDbWebhookPayload(body)) {
        const { error } = await sb
          .from("bookings")
          .update({ status: "confirmed" })
          .eq("id", bookingId);
        if (error) throw new Error(error.message);
      }

      // Read mentee_email to send email
      const { data: b, error: selErr } = await sb
        .from("bookings")
        .select("mentee_email")
        .eq("id", bookingId)
        .single();
      if (selErr) throw new Error(selErr.message);

      await sendGraphMail(
        b.mentee_email,
        "Session Confirmed",
        "Your session has been confirmed by your mentor.",
        "Text"
      );

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- CANCEL ----
    if (mode === "cancel") {
      if (!bookingId) {
        return new Response(JSON.stringify({ error: "bookingId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!isDbWebhookPayload(body)) {
        const { error } = await sb
          .from("bookings")
          .update({ status: "cancel" })
          .eq("id", bookingId);
        if (error) throw new Error(error.message);
      }

      const { data: b, error: selErr } = await sb
        .from("bookings")
        .select("mentee_email")
        .eq("id", bookingId)
        .single();
      if (selErr) throw new Error(selErr.message);

      await sendGraphMail(
        b.mentee_email,
        "Session Cancelled",
        "Unfortunately, your mentor has cancelled this session request.",
        "Text"
      );

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback
    return new Response(JSON.stringify({ error: "invalid mode" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[booking-mails] error:", e?.message || e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
