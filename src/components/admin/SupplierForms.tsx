"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/utils";
import {
  manualImportAction,
  saveCredentialsAction,
  saveSupplierAction,
  testConnectionAction,
  type SupplierFormState,
  type TestResultState,
} from "@/server/suppliers/admin-actions";

type AdapterOption = { key: string; label: string; description: string; credentialFields: string[] };

export type SupplierFormValues = {
  id?: string;
  code: string;
  name: string;
  status: string;
  integrationType: string;
  adapterKey: string;
  priority: number;
  defaultLeadTimeDays: number;
  safetyStock: number;
  stockSyncIntervalMin: number;
  catalogSyncIntervalMin: number;
  autoSubmitOrders: boolean;
  notes: string;
  config: string;
};

/** Config şablonları. URL'ler bilerek yer tutucudur; gerçek tedarikçi bilgisi girilmeden kaydedilemez. */
const CONFIG_TEMPLATES: Record<string, object> = {
  mock: { mock: true, dataset: "mock-a", simulateFailure: "none", tickMinutes: 15 },
  "b2b-portal": {
    baseUrl: "TEDARIKCI_PANEL_ADRESI",
    login: {
      url: "/giris",
      usernameSelector: "input[name=email]",
      passwordSelector: "input[type=password]",
      submitSelector: "button[type=submit]",
      successSelector: "a[href*=cikis]",
    },
    products: {
      mode: "scrape",
      listUrls: ["/urunler?sayfa={page}"],
      pagination: { type: "urlTemplate", startPage: 1, maxPages: 50 },
      itemSelector: ".urun-kart",
      fields: {
        supplierSku: { selector: ".stok-kodu", regex: "([A-Z0-9-]+)" },
        title: { selector: ".urun-adi" },
        costPrice: { selector: ".bayi-fiyat" },
        stock: { selector: ".stok", regex: "(\\d+)" },
        gtin: { selector: ".barkod" },
        brand: { selector: ".marka" },
      },
    },
    priceFormat: { decimalSeparator: ",", vatIncluded: true, vatRateBps: 2000 },
    throttleMs: 1500,
  },
  "generic-feed": {
    format: "xml",
    productsUrl: "TEDARIKCI_FEED_URL",
    itemPath: "Urunler.Urun",
    fieldMap: { supplierSku: "StokKodu", title: "UrunAdi", costPrice: "AlisFiyati", stock: "Stok", gtin: "Barkod", brand: "Marka", mpn: "UreticiKodu", images: "Resimler" },
    priceFormat: { decimalSeparator: ",", vatIncluded: true, vatRateBps: 2000 },
    auth: { type: "none" },
  },
  "generic-rest": {
    baseUrl: "TEDARIKCI_API_URL",
    auth: { type: "bearer" },
    pagination: { type: "page", pageParam: "page", sizeParam: "limit", size: 200 },
    products: { path: "products", itemsPath: "data" },
    fieldMap: { supplierSku: "sku", title: "name", costPrice: "price", stock: "quantity", gtin: "barcode", brand: "brand" },
  },
};

function Err({ list }: { list?: string[] }) {
  return list?.length ? <p className="field-error">{list[0]}</p> : null;
}

function Status({ state }: { state: { ok?: boolean; message?: string } }) {
  if (!state.message) return null;
  return <p role="status" className={cn("text-sm", state.ok ? "text-ok" : "text-bad")}>{state.message}</p>;
}

export function SupplierForm({ adapters, initial }: { adapters: AdapterOption[]; initial: SupplierFormValues }) {
  const [state, action, pending] = useActionState<SupplierFormState, FormData>(saveSupplierAction, {});
  const [adapterKey, setAdapterKey] = useState(initial.adapterKey);
  const [config, setConfig] = useState(initial.config);
  const fe = state.fieldErrors ?? {};
  const selected = adapters.find((a) => a.key === adapterKey);

  return (
    <form action={action} className="card grid gap-4 p-5 md:grid-cols-2">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div>
        <label className="label" htmlFor="name">Ad</label>
        <input id="name" name="name" defaultValue={initial.name} className="input" required />
        <Err list={fe.name} />
      </div>
      <div>
        <label className="label" htmlFor="code">Kod</label>
        <input id="code" name="code" defaultValue={initial.code} className="input" required />
        <Err list={fe.code} />
      </div>
      <div>
        <label className="label" htmlFor="adapterKey">Adapter</label>
        <select id="adapterKey" name="adapterKey" value={adapterKey} onChange={(e) => setAdapterKey(e.target.value)} className="input">
          {adapters.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        {selected && <p className="mt-1 text-xs text-subtle">{selected.description}</p>}
      </div>
      <div>
        <label className="label" htmlFor="integrationType">Entegrasyon türü</label>
        <select id="integrationType" name="integrationType" defaultValue={initial.integrationType} className="input">
          {["REST_API", "XML_FEED", "CSV_FEED", "JSON_FEED", "MANUAL_IMPORT", "CUSTOM", "MOCK"].map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="status">Durum</label>
        <select id="status" name="status" defaultValue={initial.status} className="input">
          <option value="ACTIVE">Aktif</option>
          <option value="PAUSED">Duraklatıldı (sync çalışmaz, ürünler satılmaz)</option>
          <option value="DISABLED">Devre dışı</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="priority">Öncelik</label>
          <input id="priority" name="priority" type="number" defaultValue={initial.priority} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="safetyStock">Safety stock</label>
          <input id="safetyStock" name="safetyStock" type="number" min={0} defaultValue={initial.safetyStock} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="defaultLeadTimeDays">Teslim (gün)</label>
          <input id="defaultLeadTimeDays" name="defaultLeadTimeDays" type="number" min={0} defaultValue={initial.defaultLeadTimeDays} className="input" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="stockSyncIntervalMin">Stok sync (dk)</label>
          <input id="stockSyncIntervalMin" name="stockSyncIntervalMin" type="number" min={5} defaultValue={initial.stockSyncIntervalMin} className="input" />
          <Err list={fe.stockSyncIntervalMin} />
        </div>
        <div>
          <label className="label" htmlFor="catalogSyncIntervalMin">Katalog sync (dk)</label>
          <input id="catalogSyncIntervalMin" name="catalogSyncIntervalMin" type="number" min={30} defaultValue={initial.catalogSyncIntervalMin} className="input" />
          <Err list={fe.catalogSyncIntervalMin} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted md:col-span-2">
        <input type="checkbox" name="autoSubmitOrders" defaultChecked={initial.autoSubmitOrders} className="accent-accent" />
        Ödeme sonrası siparişleri API ile otomatik gönder (adapter destekliyorsa; aksi halde manuel)
      </label>
      <div className="md:col-span-2">
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="config">Config (JSON, gizli bilgi içermez)</label>
          {CONFIG_TEMPLATES[adapterKey] && (
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setConfig(JSON.stringify(CONFIG_TEMPLATES[adapterKey], null, 2))}>
              Şablonu yükle
            </button>
          )}
        </div>
        <textarea id="config" name="config" rows={14} value={config} onChange={(e) => setConfig(e.target.value)} className="input font-mono text-xs" spellCheck={false} />
        <Err list={fe.config} />
      </div>
      <div className="md:col-span-2">
        <label className="label" htmlFor="notes">Notlar</label>
        <textarea id="notes" name="notes" rows={2} defaultValue={initial.notes} className="input" />
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <button disabled={pending} className="btn-primary">{pending ? "Kaydediliyor…" : "Kaydet"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function CredentialsForm({ supplierId, fields, storedKeys }: { supplierId: string; fields: string[]; storedKeys: string[] }) {
  const [state, action, pending] = useActionState<SupplierFormState, FormData>(saveCredentialsAction, {});
  const all = [...fields, "webhookSecret"];
  return (
    <form action={action} className="card space-y-3 p-5" autoComplete="off">
      <input type="hidden" name="supplierId" value={supplierId} />
      <h2 className="font-semibold">Kimlik bilgileri</h2>
      <p className="text-xs text-subtle">Şifreli saklanır, bir daha gösterilmez. Boş bırakılan alan mevcut değeri korur.</p>
      {all.map((f) => (
        <div key={f}>
          <label className="label" htmlFor={`cred-${f}`}>
            {f} {storedKeys.includes(f) && <span className="text-ok">· kayıtlı</span>}
          </label>
          <input id={`cred-${f}`} name={f} type="password" autoComplete="new-password" className="input" placeholder={storedKeys.includes(f) ? "••••••••" : ""} />
        </div>
      ))}
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="clear" className="accent-accent" /> Tüm kayıtlı bilgileri sil
      </label>
      <button disabled={pending} className="btn-secondary">{pending ? "Kaydediliyor…" : "Kimlik bilgilerini kaydet"}</button>
      <Status state={state} />
    </form>
  );
}

export function TestConnectionForm({ supplierId }: { supplierId: string }) {
  const [state, action, pending] = useActionState<TestResultState, FormData>(testConnectionAction, {});
  return (
    <form action={action} className="card space-y-3 p-5">
      <input type="hidden" name="supplierId" value={supplierId} />
      <h2 className="font-semibold">Bağlantı testi</h2>
      <button disabled={pending} className="btn-secondary">{pending ? "Test ediliyor…" : "Bağlantıyı test et"}</button>
      <Status state={state} />
      {state.sample && state.sample.length > 0 && (
        <pre className="max-h-64 overflow-auto rounded bg-panel-2 p-3 text-xs text-muted">{JSON.stringify(state.sample, null, 2)}</pre>
      )}
    </form>
  );
}

export function ImportForm({ supplierId }: { supplierId: string }) {
  const [state, action, pending] = useActionState<SupplierFormState, FormData>(manualImportAction, {});
  return (
    <form action={action} className="card space-y-3 p-5">
      <input type="hidden" name="supplierId" value={supplierId} />
      <h2 className="font-semibold">Manuel içe aktarım (CSV / Excel / XML / JSON)</h2>
      <p className="text-xs text-subtle">Config&apos;teki fieldMap ile eşlenir. En fazla 20 MB.</p>
      <input name="file" type="file" accept=".csv,.txt,.xlsx,.xml,.json" className="input" required />
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="removeMissing" className="accent-accent" /> Dosyada olmayan ürünleri kaldırılmış işaretle
      </label>
      <button disabled={pending} className="btn-secondary">{pending ? "İçe aktarılıyor…" : "İçe aktar"}</button>
      <Status state={state} />
    </form>
  );
}
