import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { readSessionUser, type SessionUser } from "./session";

/**
 * Data Access Layer: yetki kontrolünün tek noktası. Proxy yalnızca iyimser bir
 * cookie kontrolü yapar; gerçek yetkilendirme burada, her sayfa, server action
 * ve route handler içinde tekrar yapılır.
 */

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => readSessionUser());

export const isStaff = (user: Pick<SessionUser, "role"> | null) => user?.role === "ADMIN" || user?.role === "STAFF";

export async function requireUser(nextPath = "/account"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

/** Admin paneli erişimi. Yetkisiz kullanıcıya panelin varlığı bile gösterilmez. */
export async function requireStaff(nextPath = "/admin"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!isStaff(user)) notFound();
  return user;
}

/** Tedarikçi kimlik bilgileri, fiyat kuralları gibi kritik işlemler yalnızca ADMIN. */
export async function requireAdmin(nextPath = "/admin"): Promise<SessionUser> {
  const user = await requireStaff(nextPath);
  if (user.role !== "ADMIN") notFound();
  return user;
}

/** Route handler'lar için: yönlendirme yerine null döner. */
export async function getApiUser(roles?: SessionUser["role"][]): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (roles && !roles.includes(user.role)) return null;
  return user;
}
