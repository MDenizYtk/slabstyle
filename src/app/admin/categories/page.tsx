import { DeleteCategoryButton } from "@/components/admin/DeleteCategoryButton";
import { Flash, PageHeader } from "@/components/admin/ui";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { saveCategoryAction } from "@/server/catalog/category-actions";
import { db } from "@/server/db";

export const metadata = { title: "Kategoriler" };

export default async function CategoriesPage(props: PageProps<"/admin/categories">) {
  await requireStaff();
  const flash = readFlash(await props.searchParams);
  const categories = await db.category.findMany({
    orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { position: "asc" }],
    include: { _count: { select: { products: true, children: true } }, parent: { select: { name: true } } },
  });
  const roots = categories.filter((c) => !c.parentId);

  return (
    <>
      <PageHeader title="Kategoriler" description="Mağazanın üst menüsünde ana kategoriler görünür." />
      <Flash message={flash.message} tone={flash.tone} />
      <div className="grid gap-6 2xl:grid-cols-[1fr_380px]">
        <div className="space-y-2">
          {categories.map((c) => (
            <form
              key={c.id}
              action={saveCategoryAction}
              className="card grid items-end gap-3 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)_80px_auto] xl:grid-cols-[minmax(0,1fr)_220px_80px_auto_auto_auto_auto]"
            >
              <input type="hidden" name="id" value={c.id} />
              <div className="min-w-0">
                <label className="label" htmlFor={`n-${c.id}`}>{c.parent ? `${c.parent.name} ›` : "Ana kategori"}</label>
                <input id={`n-${c.id}`} name="name" defaultValue={c.name} className="input" required />
              </div>
              <div>
                <label className="label" htmlFor={`p-${c.id}`}>Üst kategori</label>
                <select id={`p-${c.id}`} name="parentId" defaultValue={c.parentId ?? ""} className="input">
                  <option value="">— Ana kategori —</option>
                  {roots.filter((r) => r.id !== c.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor={`s-${c.id}`}>Sıra</label>
                <input id={`s-${c.id}`} name="position" type="number" defaultValue={c.position} className="input" />
              </div>
              <label className="flex items-center gap-1.5 pb-3 text-xs text-muted">
                <input type="checkbox" name="isVisible" defaultChecked={c.isVisible} className="accent-accent" /> Görünür
              </label>
              <span className="pb-3 text-xs whitespace-nowrap text-subtle">
                {c._count.products} ürün{c._count.children ? ` · ${c._count.children} alt` : ""}
              </span>
              <button className="btn-secondary text-xs">Kaydet</button>
              <DeleteCategoryButton name={c.name} productCount={c._count.products} childCount={c._count.children} />
            </form>
          ))}
        </div>

        <form action={saveCategoryAction} className="card h-fit space-y-3 p-5">
          <h2 className="font-semibold">Yeni kategori</h2>
          <input name="name" placeholder="Kategori adı" className="input" required aria-label="Kategori adı" />
          <select name="parentId" className="input" aria-label="Üst kategori" defaultValue="">
            <option value="">— Ana kategori —</option>
            {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <textarea name="description" rows={2} placeholder="Açıklama (isteğe bağlı)" className="input" aria-label="Açıklama" />
          <div>
            <label className="label" htmlFor="new-position">Sıra</label>
            <input id="new-position" name="position" type="number" defaultValue={categories.length} className="input" />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="isVisible" defaultChecked className="accent-accent" /> Mağazada görünür</label>
          <button className="btn-primary">Kategori ekle</button>
        </form>
      </div>
    </>
  );
}
