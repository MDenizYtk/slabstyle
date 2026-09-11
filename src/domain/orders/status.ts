/** Durum kodlarının müşteri/admin arayüzündeki Türkçe karşılıkları. */

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Ödeme bekleniyor",
  PAID: "Ödendi",
  PROCESSING: "Hazırlanıyor",
  PARTIALLY_SHIPPED: "Kısmen kargoda",
  SHIPPED: "Kargoda",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal edildi",
  PARTIALLY_REFUNDED: "Kısmen iade edildi",
  REFUNDED: "İade edildi",
};

export const SUPPLIER_ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Beklemede",
  AWAITING_MANUAL: "Manuel gönderim bekliyor",
  SUBMITTING: "Gönderiliyor",
  SUBMITTED: "Tedarikçiye iletildi",
  ACCEPTED: "Onaylandı",
  REJECTED: "Reddedildi",
  SHIPPED: "Kargoda",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal",
  FAILED: "Hata",
};

/** Müşteri, tedarikçi ayrıntısını görmez; paket durumunu sade haliyle görür. */
export const PACKAGE_STATUS_LABEL: Record<string, string> = {
  PENDING: "Hazırlanıyor",
  AWAITING_MANUAL: "Hazırlanıyor",
  SUBMITTING: "Hazırlanıyor",
  SUBMITTED: "Hazırlanıyor",
  ACCEPTED: "Hazırlanıyor",
  REJECTED: "İşlemde",
  FAILED: "İşlemde",
  SHIPPED: "Kargoda",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal edildi",
};

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  LABEL_CREATED: "Kargo etiketi oluşturuldu",
  IN_TRANSIT: "Yolda",
  OUT_FOR_DELIVERY: "Dağıtımda",
  DELIVERED: "Teslim edildi",
  RETURNED: "Göndericiye iade",
  EXCEPTION: "Teslimat sorunu",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Bekliyor",
  AUTHORIZED: "Provizyon",
  CAPTURED: "Tahsil edildi",
  FAILED: "Başarısız",
  CANCELLED: "İptal",
  PARTIALLY_REFUNDED: "Kısmi iade",
  REFUNDED: "İade edildi",
};

export const RETURN_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Talep alındı",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  RECEIVED: "Ürün teslim alındı",
  REFUNDED: "Ücret iade edildi",
  CANCELLED: "İptal edildi",
};

export const SYNC_STATUS_LABEL: Record<string, string> = {
  QUEUED: "Kuyrukta",
  RUNNING: "Çalışıyor",
  SUCCEEDED: "Başarılı",
  PARTIAL: "Kısmen başarılı",
  FAILED: "Başarısız",
  CANCELLED: "İptal",
};

/** Ödenmiş sayılan sipariş durumları (ciro ve kâr hesabı için). */
export const PAID_ORDER_STATUSES = ["PAID", "PROCESSING", "PARTIALLY_SHIPPED", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"] as const;

export function toneFor(status: string): "ok" | "warn" | "bad" | "muted" {
  if (["PAID", "DELIVERED", "SUCCEEDED", "CAPTURED", "ACCEPTED", "APPROVED", "REFUNDED", "ACTIVE", "MANUAL_MATCHED", "AUTO_MATCHED"].includes(status)) return "ok";
  if (["FAILED", "REJECTED", "CANCELLED", "EXCEPTION", "DISABLED", "REMOVED"].includes(status)) return "bad";
  if (["PENDING_PAYMENT", "AWAITING_MANUAL", "PARTIAL", "PENDING_REVIEW", "REQUESTED", "PAUSED", "RUNNING", "QUEUED", "PENDING"].includes(status)) return "warn";
  return "muted";
}
