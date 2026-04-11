/**
 * Channel registry — returns configured channel instances.
 *
 * To add a new channel:
 *   1. Create shared/channels/<name>.ts implementing Channel
 *   2. Add config fields to shared/config.ts
 *   3. Register it in getChannels() below
 */
export type { Channel, ChannelMessage } from "./types.ts";
export { TelegramChannel, TELEGRAM_DEFAULT_BOT } from "./telegram.ts";

import type { Config } from "@shared/config.ts";
import type { Channel } from "./types.ts";
import { TelegramChannel } from "./telegram.ts";

/** Get all configured (ready-to-use) channels. */
export function getChannels(config: Config): Channel[] {
  const channels: Channel[] = [];

  const tg = new TelegramChannel(config.telegram.bot_token, config.telegram.chat_id);
  if (tg.isConfigured()) channels.push(tg);

  // Future channels go here:
  // const slack = new SlackChannel(config.slack.webhook_url, ...);
  // if (slack.isConfigured()) channels.push(slack);

  return channels;
}
