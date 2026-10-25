import "server-only";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type PushMessage = { title: string; body: string; url?: string; tag?: string };

export function getPushPublicKey(): string {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("Notifications push non configurées");
  return key;
}

function configurePush() {
  const publicKey = getPushPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!privateKey || !subject) throw new Error("Notifications push non configurées");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendPushToUsers(userIds: string[], message: PushMessage): Promise<number> {
  if (!userIds.length || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return 0;
  configurePush();
  const uniqueIds = [...new Set(userIds)];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("push_subscriptions").select("endpoint,user_id,p256dh,auth").in("user_id", uniqueIds);
  if (error) throw error;
  const payload = JSON.stringify({ title: message.title, body: message.body, url: message.url ?? "/dashboard", tag: message.tag });
  const results = await Promise.all((data ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 60 * 60 });
      return true;
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", subscription.user_id);
      } else {
        console.error("Web Push delivery failed", statusCode || "unknown");
      }
      return false;
    }
  }));
  return results.filter(Boolean).length;
}
