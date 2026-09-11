import { describe, expect, it } from "vitest";
import { formatIban, isValidTrIban, normalizeIban } from "@/domain/payments/iban";

describe("IBAN", () => {
  it("geçerli TR IBAN (boşluklu/küçük harf) kabul edilir", () => {
    expect(isValidTrIban("TR330006100519786457841326")).toBe(true);
    expect(isValidTrIban("tr33 0006 1005 1978 6457 8413 26")).toBe(true);
  });
  it("kontrol hanesi tutmayan, eksik veya yabancı IBAN reddedilir", () => {
    expect(isValidTrIban("TR330006100519786457841327")).toBe(false);
    expect(isValidTrIban("TR3300061005197864578413")).toBe(false);
    expect(isValidTrIban("DE89370400440532013000")).toBe(false);
    expect(isValidTrIban("")).toBe(false);
  });
  it("biçimlendirme", () => {
    expect(normalizeIban(" tr33 0006 ")).toBe("TR330006");
    expect(formatIban("TR330006100519786457841326")).toBe("TR33 0006 1005 1978 6457 8413 26");
  });
});
