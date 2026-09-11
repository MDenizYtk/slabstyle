import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Geçerli bir e-posta adresi girin" }))
  .pipe(z.string().max(254));

export const passwordSchema = z
  .string()
  .min(10, "Şifre en az 10 karakter olmalı")
  .max(128, "Şifre en fazla 128 karakter olabilir")
  .refine((v) => /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(v) && /\d/.test(v), {
    message: "Şifre en az bir harf ve bir rakam içermeli",
  });

export const loginSchema = z.object({
  email: emailSchema,
  // Giriş sırasında karmaşıklık kuralı uygulanmaz; sadece boş olmamalı.
  password: z.string().min(1, "Şifre gerekli").max(128),
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı").max(100),
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: "Şifreler eşleşmiyor",
    path: ["passwordConfirm"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  values?: Record<string, string>;
};
