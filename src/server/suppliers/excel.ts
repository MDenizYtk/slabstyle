import ExcelJS from "exceljs";

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text);
    if ("error" in value) return "";
  }
  return String(value).trim();
}

/** Excel dosyasının ilk sayfasını "başlık satırı → kayıt" biçiminde okur. */
export async function parseXlsx(data: ArrayBuffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs tipleri eski Buffer tanımını kullanıyor; çalışma zamanında Node Buffer kabul eder.
  await workbook.xlsx.load(Buffer.from(data) as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  const records: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values as ExcelJS.CellValue[];
    if (rowNumber === 1) {
      values.forEach((v, i) => (headers[i] = cellText(v)));
      return;
    }
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) record[h] = cellText(values[i]);
    });
    if (Object.values(record).some((v) => v !== "")) records.push(record);
  });
  return records;
}
