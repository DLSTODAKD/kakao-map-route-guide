import type { BusPlanResult } from "../types/index.js";
import { buildKakaoMessage, buildReminderMessage } from "../services/messageService.js";

export interface ElderlyMessageInput {
  bus_plan: BusPlanResult;
  elderly_name?: string | null;
  reminder_minutes?: number | null;
}

export interface ElderlyMessageResult {
  success: boolean;
  simple_message: string;
  reminder_message: string;
}

export function makeElderlyMessage(input: ElderlyMessageInput): ElderlyMessageResult {
  const { bus_plan, elderly_name } = input;

  let simpleMessage = buildKakaoMessage(bus_plan, true);

  if (elderly_name) {
    simpleMessage = `${elderly_name}님,\n\n${simpleMessage}`;
  }

  const reminderMessage = buildReminderMessage(bus_plan);

  return {
    success: true,
    simple_message: simpleMessage,
    reminder_message: reminderMessage,
  };
}
