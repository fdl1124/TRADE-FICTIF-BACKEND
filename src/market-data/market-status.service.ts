import { Injectable } from '@nestjs/common';
import { AssetDefinition } from '../common/constants/assets';
import { NYSE_HOLIDAYS } from './market-holidays';

const NY_TIME_ZONE = 'America/New_York';
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;

interface NewYorkTimeParts {
  dateIso: string;
  weekday: string;
  minutesOfDay: number;
}

function newYorkParts(now: Date): NewYorkTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    parts[part.type] = part.value;
  }
  const dateIso = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number.parseInt(parts.hour ?? '0', 10);
  const minute = Number.parseInt(parts.minute ?? '0', 10);
  return {
    dateIso,
    weekday: parts.weekday ?? '',
    minutesOfDay: hour * 60 + minute,
  };
}

@Injectable()
export class MarketStatusService {
  isStockMarketOpen(now: Date = new Date()): boolean {
    const parts = newYorkParts(now);
    const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday);
    if (!isWeekday) {
      return false;
    }
    if (NYSE_HOLIDAYS.includes(parts.dateIso)) {
      return false;
    }
    return parts.minutesOfDay >= MARKET_OPEN_MINUTES && parts.minutesOfDay < MARKET_CLOSE_MINUTES;
  }

  isMarketOpen(asset: AssetDefinition, now: Date = new Date()): boolean {
    if (asset.type === 'crypto') {
      return true;
    }
    return this.isStockMarketOpen(now);
  }
}
