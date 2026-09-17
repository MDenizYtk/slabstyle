/**
 * Site modu.
 *
 *  - "showcase" (varsayılan): VİTRİN. Ziyaretçiler ürünleri ve fotoğrafları görür,
 *    iletişim butonuyla sipariş verir. Sepet, ödeme, sipariş, stok takibi ve
 *    tedarikçi entegrasyonu kapalıdır. Redis ve arka plan worker'ı gerekmez.
 *
 *  - "shop": TAM MAĞAZA. Sepet, ödeme (havale/kart), sipariş yönetimi, stok
 *    rezervasyonu, tedarikçi senkronizasyonu ve eşleştirme açılır.
 *
 * Kod her iki modda da aynıdır; mod yalnızca hangi ekranların görüneceğini belirler.
 * Mağazaya geçmek için STORE_MODE=shop yeterlidir (ayrıca Redis + worker çalıştırın).
 */
export const STORE_MODE: "showcase" | "shop" = process.env.STORE_MODE === "shop" ? "shop" : "showcase";

export const isShop = STORE_MODE === "shop";
export const isShowcase = !isShop;
