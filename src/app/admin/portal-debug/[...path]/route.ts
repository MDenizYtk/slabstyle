import { readFile } from "node:fs/promises";
import path from "node:path";
import { getApiUser } from "@/server/auth/dal";

const ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "debug");

/**
 * B2B panel hatalarında alınan ekran görüntüleri. Tedarikçi fiyatlarını
 * içerebileceği için yalnızca admin/personel görebilir.
 */
export async function GET(_request: Request, ctx: RouteContext<"/admin/portal-debug/[...path]">) {
  const user = await getApiUser(["ADMIN", "STAFF"]);
  if (!user) return new Response("Not found", { status: 404 });
  const key = (await ctx.params).path.join("/");
  if (!/^[a-z0-9-]+\/[A-Za-z0-9_-]+\.png$/.test(key)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(path.join(/* turbopackIgnore: true */ ROOT, key));
    return new Response(new Uint8Array(data), { headers: { "content-type": "image/png", "cache-control": "private, no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
