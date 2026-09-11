"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_QTY_PER_LINE } from "@/domain/cart/totals";
import { rateLimit } from "../rate-limit";
import { getRequestMeta } from "../auth/session";
import { addItem, CartError, removeItem, setItemQuantity } from "./service";

export type CartActionState = { ok?: boolean; message?: string };

const idSchema = z.string().min(1).max(40).regex(/^[a-z0-9]+$/i);
const addSchema = z.object({ variantId: idSchema, quantity: z.coerce.number().int().min(1).max(MAX_QTY_PER_LINE) });
const qtySchema = z.object({ itemId: idSchema, quantity: z.coerce.number().int().min(0).max(MAX_QTY_PER_LINE) });

async function guard(): Promise<string | null> {
  const { ip } = await getRequestMeta();
  const rl = await rateLimit(`cart:${ip ?? "unknown"}`, 120, 60);
  return rl.allowed ? null : "Çok fazla istek. Lütfen biraz bekleyin.";
}

export async function addToCartAction(_prev: CartActionState, formData: FormData): Promise<CartActionState> {
  const limited = await guard();
  if (limited) return { ok: false, message: limited };
  const parsed = addSchema.safeParse({ variantId: formData.get("variantId"), quantity: formData.get("quantity") ?? 1 });
  if (!parsed.success) return { ok: false, message: "Geçersiz istek" };

  try {
    await addItem(parsed.data.variantId, parsed.data.quantity);
    revalidatePath("/", "layout");
    return { ok: true, message: "Sepete eklendi" };
  } catch (error) {
    revalidatePath("/", "layout");
    if (error instanceof CartError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function updateCartItemAction(formData: FormData): Promise<void> {
  if (await guard()) return;
  const parsed = qtySchema.safeParse({ itemId: formData.get("itemId"), quantity: formData.get("quantity") });
  if (!parsed.success) return;
  try {
    await setItemQuantity(parsed.data.itemId, parsed.data.quantity);
  } catch (error) {
    if (!(error instanceof CartError)) throw error;
  }
  revalidatePath("/", "layout");
}

export async function removeCartItemAction(formData: FormData): Promise<void> {
  if (await guard()) return;
  const parsed = idSchema.safeParse(formData.get("itemId"));
  if (!parsed.success) return;
  await removeItem(parsed.data);
  revalidatePath("/", "layout");
}
