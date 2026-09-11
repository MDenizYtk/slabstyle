"use client";

import { useActionState } from "react";
import { loginAction, registerAction } from "@/server/auth/actions";
import type { FormState } from "@/server/auth/validation";

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? <p className="field-error">{errors[0]}</p> : null;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <p role="alert" className="rounded-md border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{state.error}</p>}
      <div>
        <label htmlFor="email" className="label">E-posta</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} className="input" />
        <FieldError errors={state.fieldErrors?.email} />
      </div>
      <div>
        <label htmlFor="password" className="label">Şifre</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        <FieldError errors={state.fieldErrors?.password} />
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? "Giriş yapılıyor…" : "Giriş Yap"}</button>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(registerAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <p role="alert" className="rounded-md border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{state.error}</p>}
      <div>
        <label htmlFor="name" className="label">Ad Soyad</label>
        <input id="name" name="name" autoComplete="name" required defaultValue={state.values?.name} className="input" />
        <FieldError errors={state.fieldErrors?.name} />
      </div>
      <div>
        <label htmlFor="email" className="label">E-posta</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} className="input" />
        <FieldError errors={state.fieldErrors?.email} />
      </div>
      <div>
        <label htmlFor="password" className="label">Şifre</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required className="input" />
        <FieldError errors={state.fieldErrors?.password} />
        <p className="mt-1 text-xs text-subtle">En az 10 karakter, harf ve rakam içermeli.</p>
      </div>
      <div>
        <label htmlFor="passwordConfirm" className="label">Şifre (tekrar)</label>
        <input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" required className="input" />
        <FieldError errors={state.fieldErrors?.passwordConfirm} />
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? "Hesap oluşturuluyor…" : "Hesap Oluştur"}</button>
    </form>
  );
}
