import { hash, verify } from "@node-rs/argon2";

// OWASP önerisi: Argon2id, m=19 MiB, t=2, p=1 (kütüphane varsayılanı Argon2id).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Kullanıcı bulunamadığında da aynı süreyi harcamak için (kullanıcı adı keşfini zorlaştırır).
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("slabstyle-timing-guard");
  await verifyPassword(await dummyHash, password);
}
