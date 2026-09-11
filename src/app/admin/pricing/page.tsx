import { Flash, PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { calculatePrice } from "@/domain/pricing/engine";
import { formatBps, formatMoney, parseTlInput } from "@/lib/money";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import { deleteRuleAction, saveRuleAction, saveSettingsAction } from "@/server/pricing/admin-actions";
import { getPricingSettings } from "@/server/settings";

export const metadata = { title: "Fiyat kuralları" };

const tl = (minor: number | null) => (minor == null ? "" : (minor / 100).toFixed(2).replace(".", ","));
const ROUNDING = { NONE: "Yok", WHOLE: "Tam lira", END_90: ",90", END_99: ",99" } as const;

export default async function PricingPage(props: PageProps<"/admin/pricing">) {
  const user = await requireStaff();
  const sp = await props.searchParams;
  const flash = readFlash(sp);
  const previewCost = parseTlInput(typeof sp.cost === "string" ? sp.cost : "");

  const [rules, settings, suppliers, categories, brands] = await Promise.all([
    db.pricingRule.findMany({
      orderBy: [{ priority: "desc" }, { scope: "asc" }, { minCost: { sort: "asc", nulls: "first" } }],
      include: { supplier: { select: { name: true } }, category: { select: { name: true } }, brand: { select: { name: true } } },
    }),
    getPricingSettings(db),
    db.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.category.findMany({ select: { id: true, name: true }, orderBy: { position: "asc" } }),
    db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const isAdmin = user.role === "ADMIN";
  const preview =
    previewCost != null && !Number.isNaN(previewCost) ? calculatePrice({ cost: previewCost, supplierId: "" }, rules, settings) : null;

  return (
    <>
      <PageHeader title="Fiyat kuralları" description="Satış fiyatı = maliyet + marj (+ sabit ek). Alış fiyatı müşteriye hiçbir yerde gösterilmez." />
      <Flash message={flash.message} tone={flash.tone} />

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section className="card overflow-x-auto">
          <table className="table-x">
            <thead><tr><th>Kural</th><th>Kapsam</th><th>Maliyet aralığı</th><th>Marj</th><th>Ek</th><th>Öncelik</th><th>Yuvarlama</th><th>Durum</th>{isAdmin && <th />}</tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.name}</td>
                  <td className="text-xs">{r.scope}{r.supplier ? ` · ${r.supplier.name}` : ""}{r.category ? ` · ${r.category.name}` : ""}{r.brand ? ` · ${r.brand.name}` : ""}</td>
                  <td className="text-xs">{r.minCost != null ? formatMoney(r.minCost) : "0"} – {r.maxCost != null ? formatMoney(r.maxCost) : "∞"}</td>
                  <td>{formatBps(r.marginBps)}</td>
                  <td>{r.fixedMarkup ? formatMoney(r.fixedMarkup) : "—"}</td>
                  <td>{r.priority}</td>
                  <td>{ROUNDING[r.rounding]}</td>
                  <td><StatusBadge status={r.isActive ? "ACTIVE" : "PAUSED"} label={r.isActive ? "Aktif" : "Pasif"} /></td>
                  {isAdmin && (
                    <td>
                      <form action={deleteRuleAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn-ghost text-xs text-bad">Sil</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line p-3 text-xs text-subtle">
            Seçim sırası: yüksek öncelik → daha özel kapsam (tedarikçi &gt; kategori &gt; marka &gt; genel) → daha dar maliyet aralığı.
            Alt sınır dahil, üst sınır hariçtir.
          </p>
        </section>

        <div className="space-y-6">
          <form className="card space-y-3 p-5">
            <h2 className="font-semibold">Fiyat önizleme</h2>
            <div className="flex gap-2">
              <input name="cost" defaultValue={typeof sp.cost === "string" ? sp.cost : ""} placeholder="Maliyet (TL)" className="input" inputMode="decimal" aria-label="Maliyet" />
              <button className="btn-secondary">Hesapla</button>
            </div>
            {preview && (
              <p className="text-sm">
                Satış: <strong>{formatMoney(preview.amount)}</strong> · Kâr {formatMoney(preview.profit)} ({formatBps(preview.effectiveMarginBps)})
                {preview.floorApplied !== "NONE" && <span className="text-warn"> · taban uygulandı: {preview.floorApplied}</span>}
                <br />
                <span className="text-xs text-muted">Kural: {rules.find((r) => r.id === preview.ruleId)?.name ?? "varsayılan marj"} (genel kapsam için)</span>
              </p>
            )}
          </form>

          <form action={saveSettingsAction} className="card space-y-3 p-5">
            <h2 className="font-semibold">Genel ayarlar</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="minMarginPercent">Minimum marj (%)</label>
                <input id="minMarginPercent" name="minMarginPercent" defaultValue={settings.minMarginBps / 100} className="input" disabled={!isAdmin} />
              </div>
              <div>
                <label className="label" htmlFor="minProfit">Minimum kâr (TL)</label>
                <input id="minProfit" name="minProfit" defaultValue={tl(settings.minProfit)} className="input" disabled={!isAdmin} />
              </div>
              <div>
                <label className="label" htmlFor="defaultMarginPercent">Varsayılan marj (%)</label>
                <input id="defaultMarginPercent" name="defaultMarginPercent" defaultValue={settings.defaultMarginBps / 100} className="input" disabled={!isAdmin} />
              </div>
              <div>
                <label className="label" htmlFor="defaultRounding">Varsayılan yuvarlama</label>
                <select id="defaultRounding" name="defaultRounding" defaultValue={settings.defaultRounding} className="input" disabled={!isAdmin}>
                  {Object.entries(ROUNDING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            {isAdmin && <button className="btn-secondary">Ayarları kaydet</button>}
          </form>

          {isAdmin && (
            <form action={saveRuleAction} className="card space-y-3 p-5">
              <h2 className="font-semibold">Yeni kural</h2>
              <input name="name" placeholder="Kural adı (ör. Maliyet < 500 TL)" className="input" required aria-label="Kural adı" />
              <div className="grid grid-cols-2 gap-3">
                <select name="scope" className="input" aria-label="Kapsam" defaultValue="GLOBAL">
                  <option value="GLOBAL">Genel</option>
                  <option value="SUPPLIER">Tedarikçi</option>
                  <option value="CATEGORY">Kategori</option>
                  <option value="BRAND">Marka</option>
                </select>
                <select name="supplierId" className="input" aria-label="Tedarikçi" defaultValue="">
                  <option value="">Tedarikçi (kapsam tedarikçiyse)</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select name="categoryId" className="input" aria-label="Kategori" defaultValue="">
                  <option value="">Kategori (kapsam kategoriyse)</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select name="brandId" className="input" aria-label="Marka" defaultValue="">
                  <option value="">Marka (kapsam markaysa)</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input name="minCost" placeholder="Alt maliyet (TL, dahil)" className="input" inputMode="decimal" aria-label="Alt maliyet" />
                <input name="maxCost" placeholder="Üst maliyet (TL, hariç)" className="input" inputMode="decimal" aria-label="Üst maliyet" />
                <input name="marginPercent" placeholder="Marj (%)" className="input" inputMode="decimal" required aria-label="Marj yüzdesi" />
                <input name="fixedMarkup" placeholder="Sabit ek (TL)" className="input" inputMode="decimal" aria-label="Sabit ek" />
                <input name="priority" type="number" defaultValue={0} className="input" aria-label="Öncelik" />
                <select name="rounding" defaultValue="END_90" className="input" aria-label="Yuvarlama">
                  {Object.entries(ROUNDING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" name="isActive" defaultChecked className="accent-accent" /> Aktif
              </label>
              <button className="btn-primary">Kuralı ekle</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
