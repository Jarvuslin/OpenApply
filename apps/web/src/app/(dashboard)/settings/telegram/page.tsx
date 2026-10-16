import type { ReactElement } from "react";
import type { Metadata } from "next";
import { TelegramSettingsView } from "@/components/features/telegram/telegram-settings-view";

export const metadata: Metadata = { title: "Telegram" };

export default function TelegramSettingsPage(): ReactElement {
  return <TelegramSettingsView />;
}
