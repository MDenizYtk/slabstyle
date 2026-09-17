import { NextResponse, type NextRequest } from "next/server";
import { isShop } from "@/config/mode";

const SESSION_COOKIE = "ss_session";
const PROTECTED = ["/account", "/admin", "/checkout"];

/**
 * İyimser kontrol: yalnızca oturum cookie'si var mı diye bakar ve yoksa login'e
 * yönlendirir. Veritabanına gitmez; asıl yetkilendirme server tarafındaki DAL'dadır.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Vitrin modunda sepet/ödeme/hesap kapalıdır: giriş istemek yerine sayfa 404 döner.
  const active = isShop ? PROTECTED : ["/admin"];
  const needsAuth = active.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (needsAuth && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*", "/checkout/:path*"],
};
