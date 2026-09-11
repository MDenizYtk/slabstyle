import "server-only";
import { cookies, headers } from "next/headers";
import { db } from "../db";
import { randomToken, sha256Hex } from "../security/crypto";

export const SESSION_COOKIE = "ss_session";

const ttlMs = () => Number(process.env.SESSION_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;

export async function getRequestMeta() {
  const h = await headers();
  // Cloudflare arkasında gerçek istemci IP'si CF-Connecting-IP'dedir. Başlık sahte
  // gönderilebileceği için yalnızca site gerçekten Cloudflare arkasındaysa güvenilir.
  const cfIp = process.env.TRUST_CLOUDFLARE === "1" ? h.get("cf-connecting-ip") : null;
  const ip = cfIp || h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

/**
 * Yeni oturum açar. Cookie'de rastgele token bulunur, veritabanında yalnızca
 * hash'i saklanır: veritabanı sızsa bile oturumlar ele geçirilemez.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ttlMs());
  const meta = await getRequestMeta();

  await db.session.create({
    data: { userId, tokenHash: sha256Hex(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent },
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN";
};

export async function readSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    select: {
      expiresAt: true,
      user: { select: { id: true, email: true, name: true, role: true, disabledAt: true } },
    },
  });

  if (!session || session.expiresAt <= new Date() || session.user.disabledAt) return null;
  const { disabledAt: _disabled, ...user } = session.user;
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  store.delete(SESSION_COOKIE);
}

/** Şifre değişikliği vb. durumlarda kullanıcının tüm oturumlarını kapatır. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}
