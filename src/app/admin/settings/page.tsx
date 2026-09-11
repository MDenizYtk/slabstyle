import { Flash, PageHeader } from "@/components/admin/ui";
import { formatIban, isValidTrIban } from "@/domain/payments/iban";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import { saveBankTransferAction, saveShippingSettingsAction } from "@/server/settings-actions";
import { getBankTransferSettings, getShippingSettings } from "@/server/settings";
import { isCardPaymentAvailable } from "@/server/payments/registry";

export const metadata = { title: "Ayarlar" };

const tl = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");

export default async function SettingsPage(props: PageProps<"/admin/settings">) {
  const user = await requireStaff();
  const flash = readFlash(await props.searchParams);
  const [bank, shipping] = await Promise.all([getBankTransferSettings(db), getShippingSettings(db)]);
  const isAdmin = user.role === "ADMIN";

  return (
    <>
      <PageHeader title="Ayarlar" description="Ödeme ve kargo ayarları. Değişiklikler hemen mağazaya yansır." />
      <Flash message={flash.message} tone={flash.tone} />

      <div className="grid gap-6 xl:grid-cols-2">
        <form action={saveBankTransferAction} className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Havale / EFT</h2>
            <span className={`badge ${bank.enabled && isValidTrIban(bank.iban) ? "bg-ok/15 text-ok" : "bg-panel-2 text-muted"}`}>
              {bank.enabled && isValidTrIban(bank.iban) ? "Müşterilere açık" : "Kapalı"}
            </span>
          </div>
          <p className="text-xs text-subtle">
            Müşteri siparişten sonra bu bilgileri görür. Para gelince Siparişler → sipariş detayı → &quot;Havale geldi, onayla&quot;.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={bank.enabled} className="accent-accent" disabled={!isAdmin} /> Havale/EFT ile ödemeyi aç
          </label>
          <div>
            <label className="label" htmlFor="accountHolder">Hesap sahibi (ad soyad / şirket unvanı)</label>
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
              <label className="label" htmlFor="note">Müşteriye not (isteğe bağlı)</label>
              <input id="note" name="note" defaultValue={bank.note} className="input" disabled={!isAdmin} />
            </div>
            <div>
              <label className="label" htmlFor="expireHours">Ödeme süresi (saat)</label>
              <input id="expireHours" name="expireHours" type="number" min={1} max={168} defaultValue={bank.expireHours} className="input" disabled={!isAdmin} />
            </div>
          </div>
          {isAdmin && <button className="btn-primary">Havale ayarlarını kaydet</button>}
        </form>

        <form action={saveShippingSettingsAction} className="card space-y-4 p-5">
          <h2 className="font-semibold">Kargo</h2>
          <div>
            <label className="label" htmlFor="freeShippingThreshold">Ücretsiz kargo alt limiti (TL, standart kargo)</label>
            <input id="freeShippingThreshold" name="freeShippingThreshold" defaultValue={tl(shipping.freeShippingThreshold)} inputMode="decimal" className="input" disabled={!isAdmin} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="standardFee">Standart kargo ücreti (TL)</label>
              <input id="standardFee" name="standardFee" defaultValue={tl(shipping.methods.standard.fee)} inputMode="decimal" className="input" disabled={!isAdmin} />
            </div>
            <div>
              <label className="label" htmlFor="standardEta">Standart teslim süresi</label>
              <input id="standardEta" name="standardEta" defaultValue={shipping.methods.standard.etaDays} className="input" disabled={!isAdmin} />
            </div>
            <div>
              <label className="label" htmlFor="expressFee">Hızlı kargo ücreti (TL)</label>
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

        <section className="card space-y-2 p-5 text-sm xl:col-span-2">
          <h2 className="font-semibold">Kartla ödeme</h2>
          <p className="text-muted">
            {isCardPaymentAvailable()
              ? "Kartla ödeme açık."
              : "Kapalı: gerçek ödeme sağlayıcısı (iyzico/PayTR) henüz bağlanmadı. Bağlandığında burada açık görünecek."}
          </p>
        </section>
      </div>
    </>
  );
}
