export function redactPII(text: string): string {
  if (!text) return text;
  let t = text;
  t = t.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]");
  t = t.replace(/(\+?\d[\d\-\s]{8,}\d)/g, "[phone]");
  t = t.replace(/\b([A-Z]{5}\d{4}[A-Z])\b/g, "[pan]");
  t = t.replace(/\b(\d{4}\s?\d{4}\s?\d{4})\b/g, "[aadhaar]");
  return t;
}