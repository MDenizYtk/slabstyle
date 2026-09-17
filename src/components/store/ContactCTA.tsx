import type { ContactSettings } from "@/server/settings";

/** WhatsApp numarasını wa.me biçimine çevirir: 0555 111 22 33 → 905551112233 */
export function normalizeWhatsapp(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.startsWith("90")) return digits;
  if (digits.startsWith("0")) return `90${digits.slice(1)}`;
  if (digits.length === 10) return `90${digits}`;
  return digits;
}

/**
 * Vitrin modunda ürün sayfasındaki iletişim kutusu: sepet yerine doğrudan
 * WhatsApp / telefon ile sipariş.
 */
export function ContactCTA({ contact, productName }: { contact: ContactSettings; productName?: string }) {
  const wa = normalizeWhatsapp(contact.whatsapp);
  const text = productName ? `Merhaba, "${productName}" ürünü hakkında bilgi almak istiyorum.` : "Merhaba, ürünleriniz hakkında bilgi almak istiyorum.";

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Sipariş ve bilgi için bize ulaşın:</p>
      <div className="flex flex-wrap gap-2">
        {wa && (
          <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="btn-primary flex-1 justify-center">
            WhatsApp ile sipariş ver
          </a>
        )}
        {contact.phone && (
          <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="btn-secondary flex-1 justify-center">
            Telefon: {contact.phone}
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}?subject=${encodeURIComponent(productName ?? "Ürün bilgisi")}`} className="btn-ghost flex-1 justify-center">
            E-posta gönder
          </a>
        )}
      </div>
      {!wa && !contact.phone && !contact.email && (
        <p className="text-sm text-warn">İletişim bilgisi henüz girilmemiş (Admin → Ayarlar).</p>
      )}
      {contact.note && <p className="text-xs text-subtle">{contact.note}</p>}
    </div>
  );
}
