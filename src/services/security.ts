import { type SanitizeResult } from '../types/index.js';

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|previous\s+|above\s+|prior\s+)?instructions/i,
  /you\s+are\s+now/i,
  /system\s+prompt/i,
  /disregard/i,
  /forget\s+(everything|what|your)/i,
  /\bact\s+as\b/i,
  /\bjailbreak\b/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /new\s+persona/i,
  /respond\s+only\s+in/i,
  /<[^>]+>/,
  /\[INST\]/i,
  /^###/m,
];

export function sanitizeInput(text: string): SanitizeResult {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { clean: false, blockedPattern: pattern.source };
    }
  }
  return { clean: true };
}
