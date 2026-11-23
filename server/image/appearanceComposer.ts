export interface AppearanceTraits {
  gender?: string;
  build?: string;
  height?: string;
  age?: string;
  skinTone?: string;
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  eyeFeature?: string;
  clothing?: string;
  features?: string;
  /** Body type descriptors (curvy, athletic, slender, muscular) */
  bodyType?: string;
  /** Scars, tattoos, piercings, markings */
  bodyMarkings?: string;
  /** Facial structure (sharp jawline, round face, high cheekbones) */
  faceShape?: string;
}

/**
 * Compose structured appearance traits into an SD-ready description string.
 * Produces clean, comma-separated visual descriptors.
 */
export function composeAppearance(traits: AppearanceTraits | null | undefined): string | null {
  if (!traits) return null;

  const parts: string[] = [];

  // Gender — first token with emphasis for maximum SD influence
  if (traits.gender) parts.push(`(${traits.gender}:1.3)`);

  // Physical build
  const physique = [traits.build, traits.height, traits.age].filter(Boolean).join(" ");
  if (physique) parts.push(physique);

  // Body type
  if (traits.bodyType) parts.push(`${traits.bodyType} body`);

  // Face
  if (traits.faceShape) parts.push(traits.faceShape);

  // Skin
  if (traits.skinTone) parts.push(`${traits.skinTone} skin`);

  // Hair
  const hair = [traits.hairStyle, traits.hairColor].filter(Boolean).join(" ");
  if (hair) parts.push(`${hair} hair`);

  // Eyes
  if (traits.eyeColor || traits.eyeFeature) {
    const eyeParts = [traits.eyeColor, traits.eyeFeature].filter(Boolean).join(" ");
    parts.push(`${eyeParts} eyes`);
  }

  // Clothing
  if (traits.clothing) parts.push(traits.clothing);

  // Body markings (scars, tattoos, piercings)
  if (traits.bodyMarkings) parts.push(traits.bodyMarkings);

  // Distinguishing features
  if (traits.features) parts.push(traits.features);

  if (parts.length === 0) return null;

  // Apply SDXL emphasis to visually distinctive traits that need reinforcement
  return parts.map(part => {
    const lower = part.toLowerCase();
    // Boost non-standard features that SDXL tends to ignore
    if (/(?:scar|tattoo|piercing|cybernetic|prosthetic|horn|tail|wing|glowing|patch|brand|rune|antler|crystal|fang|claw)/.test(lower)) {
      return `(${part}:1.3)`;
    }
    // Moderate boost for distinctive coloring
    if (/(?:white hair|silver hair|red eyes|golden eyes|heterochromia|albino|dark skin|pale skin)/.test(lower)) {
      return `(${part}:1.15)`;
    }
    return part;
  }).join(", ");
}

/**
 * Extract visual damage/state descriptors from character status notes.
 * Converts game-state descriptions into SD-friendly visual tags.
 */
export function composeDamageState(statusNotes: string | null | undefined): string | null {
  if (!statusNotes) return null;
  const lower = statusNotes.toLowerCase();
  const tags: string[] = [];

  // Wounds and blood
  if (/blood|bleeding|wound|cut|slash|gash/.test(lower)) tags.push("bloodied");
  if (/bruise|beaten|battered/.test(lower)) tags.push("bruised face");
  if (/burn|scorch|sear/.test(lower)) tags.push("burn marks on skin");
  if (/broken\s+(?:arm|leg|rib|bone)/.test(lower)) tags.push("injured limb");

  // Physical state
  if (/exhaust|tired|fatigue|weary/.test(lower)) tags.push("exhausted expression, sweat");
  if (/unconscious|passed out|fainted/.test(lower)) tags.push("unconscious, closed eyes, limp body");
  if (/poison|sick|ill|nausea/.test(lower)) tags.push("pale sickly skin, sweat");
  if (/rage|berserk|fury|enraged/.test(lower)) tags.push("rage expression, veins visible, clenched teeth");

  // Clothing state
  if (/torn|ripped|tattered|damaged\s+(?:armor|cloth|clothes)/.test(lower)) tags.push("torn clothing");
  if (/wet|soaked|drenched/.test(lower)) tags.push("wet skin, wet hair, dripping");

  return tags.length > 0 ? tags.join(", ") : null;
}
