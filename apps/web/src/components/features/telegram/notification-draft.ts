import { type TelegramSettings, telegramSettingsInputSchema } from "@openapply/contracts/telegram";
import { z } from "zod/v4";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const notificationDraftSchema = z
  .object({
    digestEnabled: z.boolean(),
    digestHour: z.number().int().min(0).max(23),
    timeZone: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, "Enter a supported time zone, such as America/Toronto."),
    quietEnabled: z.boolean(),
    quietStart: time,
    quietEnd: time,
  })
  .refine(
    (value) => !value.quietEnabled || value.quietStart !== value.quietEnd,
    "Quiet hours need different start and end times.",
  );
const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function notificationDraft(settings: TelegramSettings) {
  return {
    digestEnabled: settings.digestEnabled,
    digestHour: settings.digestHour,
    timeZone: settings.timeZone,
    quietEnabled: settings.quietHours !== null,
    quietStart: formatTime(settings.quietHours?.startMinute ?? 1320),
    quietEnd: formatTime(settings.quietHours?.endMinute ?? 420),
  };
}
export function notificationInput(
  draft: z.infer<typeof notificationDraftSchema>,
  basis: TelegramSettings,
  current: TelegramSettings,
) {
  if (basis.revision !== current.revision)
    throw new Error("Reload saved notification settings before editing again.");
  const value = notificationDraftSchema.parse(draft);
  return telegramSettingsInputSchema.omit({ requestId: true }).parse({
    expectedRevision: basis.revision,
    digestEnabled: value.digestEnabled,
    digestHour: value.digestHour,
    timeZone: value.timeZone,
    quietHours: value.quietEnabled
      ? { startMinute: minutes(value.quietStart), endMinute: minutes(value.quietEnd) }
      : null,
  });
}
