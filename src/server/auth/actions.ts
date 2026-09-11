"use server";

import { redirect } from "next/navigation";
import { db } from "../db";
import { audit } from "../audit";
import { rateLimit } from "../rate-limit";
import { safeRedirectPath } from "@/lib/utils";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, getRequestMeta } from "./session";
import { loginSchema, registerSchema, type FormState } from "./validation";
import { mergeGuestCartIntoUser } from "../cart/service";

const GENERIC_LOGIN_ERROR = "E-posta veya şifre hatalı";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values: { email: raw.email } };
  }

  const { ip } = await getRequestMeta();
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`login:ip:${ip ?? "unknown"}`, 20, 15 * 60),
    rateLimit(`login:email:${parsed.data.email}`, 8, 15 * 60),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    await audit({ action: "auth.login_rate_limited", metadata: { email: parsed.data.email }, ip });
    return { error: "Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.", values: { email: raw.email } };
  }

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, passwordHash: true, disabledAt: true, role: true },
  });

  if (!user) {
    await burnPasswordCheck(parsed.data.password);
    return { error: GENERIC_LOGIN_ERROR, values: { email: raw.email } };
  }

  const ok = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!ok || user.disabledAt) {
    await audit({ action: "auth.login_failed", actorType: "USER", actorId: user.id, ip });
    return { error: GENERIC_LOGIN_ERROR, values: { email: raw.email } };
  }

  await createSession(user.id);
  await mergeGuestCartIntoUser(user.id);
  await audit({ action: "auth.login", actorType: "USER", actorId: user.id, ip });

  const fallback = user.role === "CUSTOMER" ? "/account" : "/admin";
  redirect(safeRedirectPath(formData.get("next"), fallback));
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    passwordConfirm: String(formData.get("passwordConfirm") ?? ""),
  };
  const values = { name: raw.name, email: raw.email };
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };

  const { ip } = await getRequestMeta();
  const limited = await rateLimit(`register:ip:${ip ?? "unknown"}`, 5, 60 * 60);
  if (!limited.allowed) return { error: "Çok fazla kayıt denemesi. Daha sonra tekrar deneyin.", values };

  const existing = await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } });
  if (existing) {
    return { fieldErrors: { email: ["Bu e-posta ile kayıtlı bir hesap var"] }, values };
  }

  // Rol her zaman CUSTOMER: kayıt formundan rol yükseltmesi mümkün değildir.
  const user = await db.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      role: "CUSTOMER",
    },
    select: { id: true },
  });

  await createSession(user.id);
  await mergeGuestCartIntoUser(user.id);
  await audit({ action: "auth.register", actorType: "USER", actorId: user.id, ip });
  redirect(safeRedirectPath(formData.get("next"), "/account"));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
