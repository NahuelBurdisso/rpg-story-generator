import { type LLMOptions } from "../llm/providers";

export type SceneType = "combat" | "exploration" | "dialogue" | "stealth" | "emotional" | "investigation" | "social";

const SCENE_PARAMS: Record<SceneType, { temperature: number; topP: number }> = {
  combat:        { temperature: 0.5, topP: 0.85 },
  exploration:   { temperature: 0.8, topP: 0.95 },
  dialogue:      { temperature: 0.7, topP: 0.92 },
  stealth:       { temperature: 0.6, topP: 0.88 },
  emotional:     { temperature: 0.75, topP: 0.93 },
  investigation: { temperature: 0.65, topP: 0.90 },
  social:        { temperature: 0.8, topP: 0.95 },
};

// ── Combat (EN + ES) ────────────────────────────────────────────────────────
const COMBAT_PATTERNS = /\b(attack|fight|strike|slash|shoot|dodge|block|parry|kill|stab|punch|kick|draw (my |the )?(sword|weapon|blaster|gun|lightsaber|saber)|cast (a )?spell|charge|defend|wrestle|grapple|throw .* at|swing|fire at|aim at|execute|behead|gut|cleave|smash|crush|ambush|tackle|choke|bite|claw|backstab|force push|force choke|force lightning|lightsaber|sable.* luz|atac[oa]r?|pele[oa]r?|golpe[oa]r?|dispar[oa]r?|esquiv[oa]r?|bloque[oa]r?|mat[oa]r?|apu[ñn]al[oa]r?|patear?|lanz[oa]r? (un |el )?(hechizo|conjuro)|desenvain[oa]r?|defend[eéi]r|embestir?|cortarle?|aplast[oa]r?|emboscar?|morder|arra[ñn]ar?|atacalo|le pego|lo ataco|la ataco|empuj[oó]n.* fuerza|uso la fuerza.* contra)\b/i;

// ── Stealth (EN + ES) ───────────────────────────────────────────────────────
const STEALTH_PATTERNS = /\b(sneak|hide|stealth|creep|shadow|silent|pickpocket|lockpick|infiltrate|disguise|avoid detection|slip past|tail|follow .* quietly|pick the lock|tiptoe|prowl|skulk|case the joint|plant .* on|cloak|jam .* sensor|disable .* camera|mind trick|escond[eéi]r|esconderme|ocultar|sigilo|sigilosa?mente|me escondo|escabullir|infiltrar|disfraz|pasar desapercibido|forzar .* cerradura|abrir .* cerradura|me muevo .* silencio|en las sombras|sin que me vean|robar .* bolsillo|truco mental|desactivar .* sensor)\b/i;

// ── Emotional (EN + ES) ─────────────────────────────────────────────────────
const EMOTIONAL_PATTERNS = /\b(cry|mourn|confess|beg|plead|apologize|forgive|betray|love|hate|grieve|comfort|embrace|kiss|weep|flirt|romance|hold .* hand|whisper .* to|open up|break down|llor[oa]r?|llorar|duelo|confes[oa]r?|suplic[oa]r?|pedir perd[oó]n|perdon[oa]r?|traicion[oa]r?|am[oa]r|odi[oa]r?|consol[oa]r?|abraz[oa]r?|bes[oa]r?|coquete[oa]r?|me abrazo|le beso|lo beso|la beso)\b/i;

// ── Dialogue (EN + ES) ──────────────────────────────────────────────────────
const DIALOGUE_PATTERNS = /\b(say|tell|ask|speak|talk|persuade|negotiate|bargain|intimidate|convince|lie to|question|interrogate|greet|threaten|bluff|demand|challenge|insult|mock|taunt|bribe|sweet-talk|charm|dec[ií]r|le digo|pregunt[oa]r?|habl[oa]r?|convers[oa]r?|persuad[ií]r?|negoci[oa]r?|regat[eé][oa]r?|intimid[oa]r?|convenc[eé]r?|mentir|interrogar?|salud[oa]r?|amenaz[oa]r?|exig[ií]r?|desafi[oa]r?|insult[oa]r?|burl[oa]r?|sobornr?|le hablo|le pregunto|le cuento)\b/i;

// ── Investigation (EN + ES) ─────────────────────────────────────────────────
const INVESTIGATION_PATTERNS = /\b(search|examine|inspect|investigate|look for|check for|analyze|study|read|decipher|detect|scan|probe|search .* body|look .* over|look .* around|look .* trap|sense|perceive|appraise|identify|look .* clue|smell|taste|touch|feel .* for|busc[oa]r?|examin[oa]r?|inspeccion[oa]r?|investig[oa]r?|analiz[oa]r?|estudi[oa]r?|le[eé]r|descifr[oa]r?|detect[oa]r?|revis[oa]r?|busco trampas|busco pistas|reviso el cuerpo|miro alrededor|huelo|saboreo|toco|palpo|observo .* deteni)\b/i;

// ── Social (EN + ES) ────────────────────────────────────────────────────────
const SOCIAL_PATTERNS = /\b(drink|eat|celebrate|feast|party|gamble|play .* game|dance|sing|perform|entertain|buy .* drink|share .* meal|toast|cheers|haggle|shop|browse|visit .* market|go to .* tavern|enter .* inn|relax|unwind|sit .* down|join .* them|tom[oa]r?|beb[eé]r?|com[eé]r?|celebr[oa]r?|fest[eé]j[oa]r?|apost[oa]r?|bail[oa]r?|cant[oa]r?|actu[oa]r?|brindar?|comprar? .* trago|ir .* taberna|entrar .* posada|relaj[oa]r?|descansar?|me siento|me uno|voy .* mercado|voy .* bar|vamos .* taberna|pido .* cerveza|pido .* trago)\b/i;

export function classifyScene(
  playerMessage: string,
  sceneState?: { situation?: string; pendingThreats?: string[] } | null
): SceneType {
  const text = playerMessage.toLowerCase();
  const situation = sceneState?.situation?.toLowerCase() ?? "";

  if (COMBAT_PATTERNS.test(text)) return "combat";
  if (STEALTH_PATTERNS.test(text)) return "stealth";
  if (EMOTIONAL_PATTERNS.test(text)) return "emotional";
  if (INVESTIGATION_PATTERNS.test(text)) return "investigation";
  if (SOCIAL_PATTERNS.test(text)) return "social";
  if (DIALOGUE_PATTERNS.test(text)) return "dialogue";
  if (COMBAT_PATTERNS.test(situation)) return "combat";
  if (STEALTH_PATTERNS.test(situation)) return "stealth";

  return "exploration";
}

export function getSceneOptions(sceneType: SceneType): LLMOptions {
  const params = SCENE_PARAMS[sceneType];
  return {
    temperature: params.temperature,
    maxTokens: 1024,
    topP: params.topP,
    topK: 40,
    // Same as the orchestrator's NARRATOR_OPTIONS: higher values starve Spanish
    // of its function words ("de", "la", "que") and push the model into glued
    // words, Portuguese and stray quotes/asterisks.
    repeatPenalty: 1.1,
    repeatLastN: 64,
  };
}
