// staff-admin — privileged staff & member account management.
//
// The service role key lives ONLY here (auto-injected Edge Function env),
// never in the desktop bundle. Every call must carry the JWT of a logged-in
// user whose profile role is 'admin'.
//
// Actions (POST JSON body):
//   { action: 'create',  email, password, fullName, permissions }
//   { action: 'update-permissions', uid, permissions }
//   { action: 'delete',  uid }
//   { action: 'list-members' }                 → web/QR üyeleri (role='customer')
//   { action: 'set-points', uid, points }      → üyenin puan bakiyesini ayarla
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Sadece POST desteklenir" }, 405);

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Caller must be an authenticated admin ──
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Yetkisiz" }, 401);

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (callerProfile?.role !== "admin") {
      return json({ error: "Bu işlem için admin yetkisi gerekli" }, 403);
    }

    const body = await req.json();

    if (body.action === "create") {
      const { email, password, fullName, permissions = {} } = body;
      if (!email || !password) return json({ error: "email ve password zorunlu" }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) return json({ error: error.message }, 400);

      const uid = data.user.id;
      const { error: profileError } = await admin.from("profiles").upsert({
        id: uid,
        full_name: fullName,
        role: "waiter",
        can_take_orders: permissions.canTakeOrders ?? true,
        can_close_tables: permissions.canCloseTables ?? false,
        can_manage_products: permissions.canManageProducts ?? false,
      });
      if (profileError) {
        // Don't leave an orphaned auth user without a staff profile.
        await admin.auth.admin.deleteUser(uid);
        return json({ error: profileError.message }, 400);
      }
      return json({ uid });
    }

    if (body.action === "update-permissions") {
      const { uid, permissions = {} } = body;
      if (!uid) return json({ error: "uid zorunlu" }, 400);
      const { error } = await admin.from("profiles").update({
        can_take_orders: permissions.canTakeOrders,
        can_close_tables: permissions.canCloseTables,
        can_manage_products: permissions.canManageProducts,
      }).eq("id", uid);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "delete") {
      const { uid } = body;
      if (!uid) return json({ error: "uid zorunlu" }, 400);
      // Admin accounts can't be deleted through the POS — only waiters/members.
      const { data: target } = await admin
        .from("profiles").select("role").eq("id", uid).single();
      if (target?.role === "admin") {
        return json({ error: "Admin hesabı bu ekrandan silinemez" }, 403);
      }
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) return json({ error: error.message }, 400);
      // profile auto-deletes via ON DELETE CASCADE
      return json({ ok: true });
    }

    if (body.action === "list-members") {
      // Web/QR üyeleri: role='customer' profilleri + auth'tan e-posta ve kayıt tarihi
      const { data: profiles, error: pErr } = await admin
        .from("profiles")
        .select("id, full_name, loyalty_points")
        .eq("role", "customer");
      if (pErr) return json({ error: pErr.message }, 400);

      const emailById = new Map<string, { email: string; createdAt: string }>();
      let page = 1;
      // Kaydolan üye sayısı büyüyebilir — sayfalayarak topla (page başına 1000)
      for (;;) {
        const { data: usersPage, error: uErr } = await admin.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (uErr) return json({ error: uErr.message }, 400);
        for (const u of usersPage.users) {
          emailById.set(u.id, { email: u.email ?? "", createdAt: u.created_at });
        }
        if (usersPage.users.length < 1000) break;
        page++;
      }

      const members = (profiles ?? []).map((p) => ({
        uid: p.id,
        fullName: p.full_name ?? "",
        points: p.loyalty_points ?? 0,
        email: emailById.get(p.id)?.email ?? "",
        createdAt: emailById.get(p.id)?.createdAt ?? null,
      }));
      return json({ members });
    }

    if (body.action === "set-points") {
      const { uid, points } = body;
      if (!uid) return json({ error: "uid zorunlu" }, 400);
      const pts = Number(points);
      if (!Number.isInteger(pts) || pts < 0) {
        return json({ error: "points 0 veya daha büyük bir tam sayı olmalı" }, 400);
      }
      // Sadece üye (customer) bakiyesi düzenlenebilir — personel/admin hedeflenemez
      const { data: target } = await admin
        .from("profiles").select("role").eq("id", uid).single();
      if (!target || target.role !== "customer") {
        return json({ error: "Sadece üye hesaplarının puanı düzenlenebilir" }, 403);
      }
      const { error } = await admin
        .from("profiles")
        .update({ loyalty_points: pts })
        .eq("id", uid);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, points: pts });
    }

    return json({ error: "Bilinmeyen işlem" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
