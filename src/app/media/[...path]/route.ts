import { readMedia } from "@/server/storage";

/** Yüklenen ürün fotoğraflarını sunar. Yol ve tür sıkı biçimde doğrulanır. */
export async function GET(_request: Request, ctx: RouteContext<"/media/[...path]">) {
  const { path } = await ctx.params;
  const file = await readMedia(path.join("/"));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
