import { type CountryCode, parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod/v4";

const PHONE_ERROR = "Enter a valid phone number (e.g. +1 415 555 2671)";

export function normalizePhone(value: string, country?: CountryCode): string {
  const parsed = parsePhoneNumberFromString(value.trim(), country);
  return parsed?.isValid() ? parsed.number : value.trim();
}

const phoneSchema = z
  .string()
  .trim()
  .refine((v) => parsePhoneNumberFromString(v)?.isValid(), { message: PHONE_ERROR })
  .transform((v) => normalizePhone(v));

export const optionalPhoneSchema = z
  .union([z.literal(""), phoneSchema])
  .optional()
  .nullable();
