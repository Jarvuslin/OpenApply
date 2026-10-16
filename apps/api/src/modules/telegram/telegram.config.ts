export const TELEGRAM_CONFIG = Symbol("TelegramConfig");
export interface TelegramConfigHolder {
  telegram: null | {
    botToken: string;
    botUsername: string;
    webhookSecret: string;
    pairingKey: string;
    updates: "webhook" | "polling";
    deliveryEnabled: boolean;
    webUrl: string;
  };
}
