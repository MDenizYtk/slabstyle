import { connection } from "next/server";
import { Header } from "@/components/store/Header";
import { Footer } from "@/components/store/Footer";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  // Mağaza sayfaları kullanıcıya (sepet, oturum) ve güncel fiyat/stoğa bağlıdır; her istekte
  // sunucuda oluşturulur. Böylece build aşamasında veritabanına bağlanılmaz.
  await connection();
  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
