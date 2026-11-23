import { type InputComplexity } from "@/types";

const TRIVIAL_PATTERNS = [
  /^(OOC|\/|\()/i,
  // English
  /^what('s| is) my (hp|health|inventory|stats|level)/i,
  /^where am i$/i,
  /^(recap|summary|what happened)$/i,
  /^(how much|how many) (hp|gold|coins|arrows)/i,
  /^show (my )?(stats|inventory|character)/i,
  // Spanish
  /^(cu[aá]l|cu[aá]nto|cu[aá]nta) (es )?(mi |mis )?(hp|vida|inventario|stats|nivel)/i,
  /^d[oó]nde estoy$/i,
  /^(resumen|resum[ií]|que pas[oó]|qu[eé] pas[oó])$/i,
  /^(cu[aá]nto|cu[aá]nta|cu[aá]ntos|cu[aá]ntas) (hp|oro|monedas|flechas|vida)/i,
  /^(mostrar?|ver) (mi |mis )?(stats|inventario|personaje)/i,
];

// Session openers always get the full pipeline
const SESSION_START_PATTERN = /^\[SESSION START/i;

// Short inputs that ARE meaningful RP actions — should NOT be trivial
const SHORT_RP_PATTERNS = [
  // English
  /^i (nod|shake|shrug|smile|frown|wink|laugh|sigh|groan|wave|bow|kneel|stand|sit|wait|listen|watch)\b/i,
  /^(nod|shake|shrug|smile|frown|wink|laugh|sigh|groan|wave|bow|kneel)\b/i,
  /^"[^"]+"/,                    // Dialogue in quotes
  /^\*[^*]+\*/,                  // Action in asterisks
  /^(yes|no|ok|sure|fine|agreed|deal|never|refuse|accept|deny)\b.+/i,
  // Spanish
  /^(asiento|niego|me encojo|sonr[ií]o|frunzo|gui[ñn]o|r[ií]o|suspiro|saludo|me arrodillo|me levanto|me siento|espero|escucho|observo)\b/i,
  /^(s[ií]|no|ok|dale|bien|de acuerdo|trato|nunca|rechazo|acepto|niego)\b.+/i,
  /^«[^»]+»/,                   // Spanish dialogue in guillemets
  /^—[^\n]+/,                   // Spanish dialogue with em-dash
];

// Bare acknowledgments — trivial only with NO additional context
const BARE_ACK = /^(yes|no|ok|sure|s[ií]|no|dale|bueno|vale|ok|bien)$/i;

export function classifyInput(message: string): InputComplexity {
  const trimmed = message.trim();

  // Session openers always standard
  if (SESSION_START_PATTERN.test(trimmed)) return "standard";

  // Obvious trivial: meta-queries and OOC
  if (TRIVIAL_PATTERNS.some((p) => p.test(trimmed))) return "trivial";

  // Short RP actions are standard, not trivial
  if (SHORT_RP_PATTERNS.some((p) => p.test(trimmed))) return "standard";

  // Bare acknowledgments with no context
  if (BARE_ACK.test(trimmed)) return "trivial";

  return "standard";
}
