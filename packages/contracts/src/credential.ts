import { z } from "zod/v4";

/** Captcha-solving services whose API key can be stored as a service credential. */
export const SERVICE_PROVIDERS = ["2captcha", "capsolver"] as const;
export type ServiceProvider = (typeof SERVICE_PROVIDERS)[number];

/** The single login row's scope. Captcha keys live beside it under their provider name. */
export const LOGIN_SCOPE = "default";

/** The one login an account uses on every employer site, plus an optional captcha key. */
export const jobLoginSchema = z.strictObject({
  email: z.string().nullable(),
  hasPassword: z.boolean(),
  captchaProvider: z.enum(SERVICE_PROVIDERS).nullable(),
  hasCaptchaKey: z.boolean(),
});

/** Omitted password or captcha key keeps the saved secret; a null provider clears the captcha key. */
export const saveJobLoginSchema = z.strictObject({
  email: z.email().max(320),
  password: z.string().min(1).max(1024).optional(),
  captchaProvider: z.enum(SERVICE_PROVIDERS).nullable(),
  captchaApiKey: z.string().min(1).max(1024).optional(),
});

export const revealedPasswordSchema = z.strictObject({ password: z.string().nullable() });

export type JobLogin = z.infer<typeof jobLoginSchema>;
export type SaveJobLogin = z.infer<typeof saveJobLoginSchema>;
