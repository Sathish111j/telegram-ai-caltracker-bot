import { type Intent } from '../types/index.js';

const WEIGHT_PATTERNS = [/^\d+(\.\d+)?\s*(kg|lbs|lb|kilos?)$/i, /weigh(ed)?\s+\d+/i];

const SUPPLEMENT_GENERIC_PATTERNS = [
  /(took|taken|had|popped|drank)\s+(my\s+)?(supplement|vitamin|creatine|omega|protein|pill|capsule|tablet)/i,
];

const QUERY_PATTERNS = [/(what did|show me|did i eat|how much|what was)/i];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyIntent(message: string, userAliases: string[]): Intent {
  const lowered = message.toLowerCase();
  if (matchesAny(message, WEIGHT_PATTERNS)) {
    return 'weight';
  }
  if (userAliases.some((alias) => lowered.includes(alias.toLowerCase()))) {
    return 'supplement';
  }
  if (matchesAny(message, SUPPLEMENT_GENERIC_PATTERNS)) {
    return 'supplement';
  }
  if (matchesAny(message, QUERY_PATTERNS)) {
    return 'query';
  }
  return 'food_log';
}
