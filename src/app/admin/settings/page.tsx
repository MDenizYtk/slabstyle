import { Flash, PageHeader } from "@/components/admin/ui";
import { isShop } from "@/config/mode";
import { formatIban, isValidTrIban } from "@/domain/payments/iban";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import { saveBankTransferAction, saveContactAction, saveShippingSettingsAction } from "@/server/settings-actions";
import { getBankTransferSettings, getContactSettings, getShippingSettings } from "@/server/settings";
import { isCardPaymentAvailable } from "@/server/payments/registry";

export const metadata = { title: "Ayarlar" };

const tl = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");

export default async function SettingsPage(props: PageProps<"/admin/settings">) {
  const user = await requireStaff();
  const flash = readFlash(await props.searchParams);
  const [contact, bank, shipping] = await Promise.all([
    getContactSettings(db),
    isShop ? getBankTransferSettings(db) : null,
    isShop ? getShippingSettings(db) : null,
  ]);
  const isAdmin = user.role === "ADMIN";

  return (
    <>
      <PageHeader
        title="Ayarlar"
        description={isShop ? "Ödeme, kargo ve iletişim ayarları." : "İletişim bilgileri. Ziyaretçiler ürün sayfasından bu bilgilerle sana ulaşır."}
      />
      <Flash message={flash.message} tone={flash.tone} />

      <div className="grid gap-6 xl:grid-cols-2">
        <form action={saveContactAction} className="card space-y-4 p-5">
          <h2 className="font-semibold">İletişim</h2>
          <p className="text-xs text-subtle">WhatsApp numarası girilirse ürün sayfasında &quot;WhatsApp ile sipariş ver&quot; butonu çıkar.</p>
          <div>
            <label className="label" htmlFor="whatsapp">WhatsApp numarası</label>
            <input id="whatsapp" name="whatsapp" defaultValue={contact.whatsapp} placeholder="0555 111 22 33" className="input" disabled={!isAdmin} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="phone">Telefon</label>
              <input id="phone" name="phone" defaultValue={contact.phone} className="input" disabled={!isAdmin} />
            </div>
            <div>
              <label className="label" htmlFor="email">E-posta</label>
              <input id="email" name="email" type="email" defaultValue={contact.email} className="input" disabled={!isAdmin} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="address">Adres</label>
            <input id="address" name="address" defaultValue={contact.address} className="input" disabled={!isAdmin} />
          </div>
          <div>
            <label className="label" htmlFor="note">Ürün sayfasında görünecek not</label>
            <input id="note" name="note" defaultValue={contact.note} placeholder="Kargo aynı gün çıkar, stok durumu için yazın." className="input" disabled={!isAdmin} />
          </div>
          {isAdmin && <button className="btn-primary">İletişim bilgilerini kaydet</button>}
        </form>

        {isShop && bank && (
          <form action={saveBankTransferAction} className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Havale / EFT</h2>
              <span className={`badge ${bank.enabled && isValidTrIban(bank.iban) ? "bg-ok/15 text-ok" : "bg-panel-2 text-muted"}`}>
                {bank.enabled && isValidTrIban(bank.iban) ? "Müşterilere açık" : "Kapalı"}
              </span>
            </div>
            <p className="text-xs text-subtle">Para gelince: Siparişler → sipariş detayı → &quot;Havale geldi, onayla&quot;.</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={bank.enabled} className="accent-accent" disabled={!isAdmin} /> Havale/EFT ile ödemeyi aç
            </label>
            <div>
              <label className="label" htmlFor="accountHolder">Hesap sahibi</label>
              <input id="accountHolder" name="accountHolder" defaultValue={bank.accountHolder} className="input" disabled={!isAdmin} />
            </div>
            <div>
              <label className="label" htmlFor="bankName">Banka</label>
              <input id="bankName" name="bankName" defaultValue={bank.bankName} className="input" disabled={!isAdmin} />
            </div>
            <div>
              <label className="label" htmlFor="iban">IBAN</label>
              <input id="iban" name="iban" defaultValue={bank.iban ? formatIban(bank.iban) : ""} placeholder="TR00 0000 0000 0000 0000 0000 00" className="input font-mono" disabled={!isAdmin} />
            </div>
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <div>
                <label className="label" htmlFor="bankNote">Müşteriye not</label>
                <input id="bankNote" name="note" defaultValue={bank.note} className="input" disabled={!isAdmin} />
              </div>
              <div>
                <label className="label" htmlFor="expireHours">Ödeme süresi (saat)</label>
                <input id="expireHours" name="expireHours" type="number" min={1} max={168} defaultValue={bank.expireHours} className="input" disabled={!isAdmin} />
              </div>
            </div>
            {isAdmin && <button className="btn-primary">Havale ayarlarını kaydet</button>}
          </form>
        )}

        {isShop && shipping && (
          <form action={saveShippingSettingsAction} className="card space-y-4 p-5">
            <h2 className="font-semibold">Kargo</h2>
            <div>
              <label className="label" htmlFor="freeShippingThreshold">Ücretsiz kargo alt limiti (TL)</label>
              <input id="freeShippingThreshold" name="freeShippingThreshold" defaultValue={tl(shipping.freeShippingThreshold)} inputMode="decimal" className="input" disabled={!isAdmin} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="standardFee">Standart kargo (TL)</label>
                <input id="standardFee" name="standardFee" defaultValue={tl(shipping.methods.standard.fee)} inputMode="decimal" className="input" disabled={!isAdmin} />
              </div>
              <div>
                <label className="label" htmlFor="standardEta">Standart teslim süresi</label>
                <input id="standardEta" name="standardEta" defaultValue={shipping.methods.standard.etaDays} className="input" disabled={!isAdmin} />
              </div>
              <div>
                <label className="label" htmlFor="expressFee">Hızlı kargo (TL)</label>
                <input id="expressFee" name="expressFee" defaultValue={tl(shipping.methods.express.fee)} inputMode="decimal" className="input" disabled={!isAdmin} />
              </div>
              <div>
                <label className="label" htmlFor="expressEta">Hızlı teslim süresi</label>
                <input id="expressEta" name="expressEta" defaultValue={shipping.methods.express.etaDays} className="input" disabled={!isAdmin} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" name="expressEnabled" defaultChecked={shipping.methods.express.enabled} className="accent-accent" disabled={!isAdmin} /> Hızlı kargo seçeneğini göster
            </label>
            {isAdmin && <button className="btn-primary">Kargo ayarlarını kaydet</button>}
          </form>
        )}

        <section className="card space-y-2 p-5 text-sm xl:col-span-2">
          <h2 className="font-semibold">Site modu</h2>
          {isShop ? (
            <p className="text-muted">
              Tam mağaza modu açık: sepet, ödeme, sipariş ve stok takibi çalışıyor.
              {isCardPaymentAvailable() ? " Kartla ödeme açık." : " Kartla ödeme kapalı (gerçek ödeme sağlayıcısı bağlanmadı); müşteriler havale ile öder."}
            </p>
          ) : (
            <p className="text-muted">
              Vitrin modu açık: ziyaretçiler ürünleri ve fotoğrafları görür, WhatsApp veya telefonla sipariş verir.
              Sepet, ödeme, stok takibi ve tedarikçi bağlantısı kapalıdır. Kod duruyor; mağazaya geçmek istediğinde
              sunucudaki <code className="text-fg">STORE_MODE</code> ayarını <code className="text-fg">shop</code> yapmak yeterli.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
