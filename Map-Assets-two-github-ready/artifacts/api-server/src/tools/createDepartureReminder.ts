import type { BusPlanResult } from "../types/index.js";
import { buildReminderMessage } from "../services/messageService.js";

export interface ReminderInput {
  bus_plan: BusPlanResult;
  reminder_minutes?: number | null;
}

export interface ReminderResult {
  success: boolean;
  reminder_time: string;
  reminder_message: string;
}

export function createDepartureReminder(input: ReminderInput): ReminderResult {
  const { bus_plan, reminder_minutes = 30 } = input;

  const reminderMin = reminder_minutes ?? 30;
  const reminderTime = bus_plan.reminder_time ?? calculateReminderTime(
    bus_plan.recommended_departure_time,
    reminderMin
  );

  const reminderMessage = buildReminderMessage(bus_plan);

  return {
    success: true,
    reminder_time: reminderTime,
    reminder_message: reminderMessage,
  };
}

function calculateReminderTime(
  departureTime: string | null,
  minutesBefore: number
): string {
  if (!departureTime) return "알 수 없음";

  const [h, m] = departureTime.split(":").map(Number);
  const totalMinutes = (h ?? 0) * 60 + (m ?? 0) - minutesBefore;
  const clampedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hh = Math.floor(clampedMinutes / 60);
  const mm = clampedMinutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
