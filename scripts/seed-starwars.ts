/**
 * Seed script: drops all existing data and creates a Star Wars campaign
 * with a character, NPCs, plot hooks, custom rules — uses every feature.
 *
 * Run: npx tsx scripts/seed-starwars.ts
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import * as schema from "../server/db/schema";

const sqlite = new Database("./data/rpg.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

// ── Nuke everything ──────────────────────────────────────────────────────────
db.run(sql`DELETE FROM scene_images`);
db.run(sql`DELETE FROM messages`);
db.run(sql`DELETE FROM sessions`);
db.run(sql`DELETE FROM npc_memory`);
db.run(sql`DELETE FROM characters`);
db.run(sql`DELETE FROM campaigns`);
// Clear memories table if it exists
try { db.run(sql`DELETE FROM memories`); } catch { /* table may not exist */ }

console.log("✓ Base de datos limpiada");

// ── Campaign ─────────────────────────────────────────────────────────────────
const campaignId = crypto.randomUUID();
db.insert(schema.campaigns).values({
  id: campaignId,
  name: "Sombras del Borde Exterior",
  genre: "sci-fi",
  customGenre: "space-opera",
  tone: "dark",
  difficulty: "hard",
  worldDescription: `El Imperio Galáctico está en su apogeo. Han pasado 5 años desde la Orden 66 y la caída de la República. Los Jedi son cazados sin piedad por los Inquisidores, la corrupción imperial se extiende por cada sistema, y el mercado negro florece en los bordes de la civilización.

En el Borde Exterior, lejos del ojo del Emperador, las reglas son simples: sobreviví o morí. Los contrabandistas, cazarrecompensas y refugiados compiten por las sobras mientras los Hutts y los carteles controlan el comercio ilegal. La Fuerza susurra en las sombras — algunos la sienten sin saber qué es.

La estación espacial Nexus Prime, construida sobre los restos de una estación separatista, es el centro neurálgico del sector. Aquí se cruzan todos los caminos: imperiales corruptos, rebeldes incipientes, criminales, y aquellos que solo quieren desaparecer.`,
  customRules: `- La Fuerza es real pero peligrosa. Usar la Fuerza abiertamente atrae la atención de los Inquisidores.
- Los blasters matan. No hay "aturdimiento" fácil — un disparo a quemarropa es letal.
- La reputación importa. Las facciones (Imperio, Hutts, proto-Rebelión, Gremio de Cazarrecompensas) recuerdan lo que hacés.
- Los créditos son escasos. Cada munición, combustible y reparación cuesta.
- Moralidad gris: no hay héroes puros ni villanos absolutos en el Borde Exterior.`,
  statDefinitions: [
    "Fuerza",
    "Agilidad",
    "Resistencia",
    "Inteligencia",
    "Voluntad",
    "Carisma",
  ],
  quickActions: [
    { label: "Disparar", prompt: "Desenfundo mi blaster y disparo al objetivo más peligroso." },
    { label: "Pilotar", prompt: "Tomo los controles y maniobro la nave para evadir o perseguir." },
    { label: "Hackear", prompt: "Conecto mi datapad al terminal e intento infiltrar el sistema." },
    { label: "Negociar", prompt: "Levanto las manos y trato de negociar una salida a esta situación." },
    { label: "Usar la Fuerza", prompt: "Me concentro y extiendo mis sentidos a través de la Fuerza, arriesgándome a ser detectado." },
    { label: "Escabullirme", prompt: "Me muevo entre las sombras, evitando ser visto." },
    { label: "Investigar", prompt: "Examino el área buscando pistas, trampas o algo útil." },
    { label: "Intimidar", prompt: "Miro fijo al objetivo y dejo que sienta el peso de mi amenaza." },
  ],
  plotHooks: [
    "Un holocrón Jedi fue visto en el mercado negro de Nexus Prime — los Inquisidores también lo buscan",
    "La piloto rebelde Zara Vex tiene una deuda de sangre con el jugador",
    "El Moff Kaelen Drask está construyendo algo en secreto en el asteroide Korriban-7",
    "Un viejo droide astromecánico guarda un mensaje de un Jedi muerto dirigido al jugador",
    "El cartel Hutt quiere al jugador muerto... o trabajando para ellos",
  ],
  imageStyle: "cinematic-scifi",
  imageEnabled: false,
  lastPlayedAt: Date.now(),
  createdAt: Date.now(),
}).run();

console.log("✓ Campaña creada: Sombras del Borde Exterior");

// ── Character ────────────────────────────────────────────────────────────────
const charId = crypto.randomUUID();
db.insert(schema.characters).values({
  id: charId,
  campaignId,
  name: "Kael Morrow",
  role: "Contrabandista / Sensible a la Fuerza",
  backstory: `Ex-piloto de la República que desertó cuando vio a los clones ejecutar la Orden 66. Perdió a su compañera Jedi, la Padawan Lira Shan, cuando los clones abrieron fuego sobre ella en el puente de mando. Kael saltó al hiperespacio y nunca miró atrás.

Ahora sobrevive como contrabandista en el Borde Exterior, pilotando una YT-1300 modificada llamada "Ceniza Nocturna". Tiene pesadillas con Lira y a veces siente... cosas. Objetos que se mueven solos cuando está furioso. Sabe lo que es la Fuerza pero se niega a explorarla — es una sentencia de muerte.

Tiene una deuda enorme con Grakkus el Hutt por las modificaciones de su nave, y una reputación como alguien que entrega la carga sin hacer preguntas. Pero las preguntas lo persiguen.`,
  stats: {
    Fuerza: 10,
    Agilidad: 16,
    Resistencia: 12,
    Inteligencia: 14,
    Voluntad: 8,
    Carisma: 13,
    HP: 28,
    MaxHP: 28,
  },
  inventory: [
    "Blaster DL-44 modificado",
    "Datapad encriptado",
    "Credenciales falsas (3 identidades)",
    "Kit de herramientas de nave",
    "Holocomunicador",
    "500 créditos imperiales",
    "Ración de emergencia (x3)",
    "Fragmento de cristal kyber (de Lira)",
  ],
  appearance: {
    gender: "1man",
    build: "Atlético, marcado por cicatrices",
    height: "1.82m",
    age: "32",
    skinTone: "Bronceado",
    hairColor: "Negro con canas prematuras",
    hairStyle: "Corto, despeinado",
    eyeColor: "Gris oscuro",
    eyeFeature: "Mirada cansada, alerta",
    clothing: "Chaqueta de cuero desgastada sobre chaleco blindado, pantalones de carga, botas de piloto",
    features: "Cicatriz diagonal en la mejilla izquierda, manos callosas de mecánico",
  },
  statusNotes: null,
  createdAt: Date.now(),
}).run();

console.log("✓ Personaje creado: Kael Morrow");

// ── NPCs ─────────────────────────────────────────────────────────────────────
const npcs = [
  {
    name: "Grakkus el Hutt",
    personality: "Coleccionista obsesivo de artefactos Jedi. Inteligente, cruel, pero con un extraño respeto por la artesanía. Habla lento y deliberado.",
    location: "Nexus Prime — Palacio en el Nivel 0",
    relationships: [
      { target: "player", disposition: -20, lastInteraction: "Le debe créditos por las modificaciones de la nave" },
      { target: "Moff Drask", disposition: -60, lastInteraction: "El Moff le confiscó tres artefactos" },
    ],
    secrets: ["Posee un sable de luz funcional escondido en su bóveda", "Está en contacto con una célula rebelde — no por ideología, sino por negocio"],
    revealedInfo: [],
    currentState: "Impaciente por cobrar la deuda de Kael",
    speechPattern: "Lento, pausado, cada palabra tiene peso. Usa metáforas de negocios. Ríe como un terremoto.",
    vocabulary: "mmm, interesante... ya veo... el precio siempre se paga... negocios son negocios",
    goal: "Conseguir el holocrón Jedi antes que los Inquisidores",
    agenda: "Presionar a Kael para que le consiga el holocrón a cambio de borrar su deuda",
  },
  {
    name: "Zara Vex",
    personality: "Piloto rebelde, ex-amiga de Kael. Feroz, leal a su causa, pero guarda rencor. Le disparó la última vez que se vieron.",
    location: "Desconocida — se mueve entre sistemas",
    relationships: [
      { target: "player", disposition: -35, lastInteraction: "Le disparó en Nar Shaddaa hace 6 meses" },
    ],
    secrets: ["Está embarazada de 4 meses", "Tiene información sobre un superarma imperial en construcción"],
    revealedInfo: [],
    currentState: "Buscando aliados desesperadamente para una misión suicida",
    speechPattern: "Rápida, cortante, sin paciencia para excusas. Sarcasmo como escudo. Se suaviza cuando baja la guardia.",
    vocabulary: "andá a cagar, no me vengas con eso, mirá, la cosa es así, bancame un segundo",
    goal: "Destruir la instalación imperial en Korriban-7",
    agenda: "Encontrar a Kael y convencerlo (o forzarlo) a ayudarla",
  },
  {
    name: "Inquisidor Séptimo",
    personality: "Ex-Jedi caído. Metódico, frío, pero con destellos de su viejo yo. Caza Jedi para el Imperio pero a veces duda.",
    location: "Destructor Estelar 'Silencio' — en órbita del sector",
    relationships: [
      { target: "player", disposition: 0, lastInteraction: "No sabe de Kael todavía" },
      { target: "Grakkus el Hutt", disposition: -40, lastInteraction: "Sospecha que esconde artefactos" },
    ],
    secrets: ["Recuerda fragmentos de su vida como Jedi y los odia", "Dejó escapar a un niño sensible a la Fuerza hace un mes"],
    revealedInfo: [],
    currentState: "Investigando reportes de actividad de la Fuerza en el sector",
    speechPattern: "Formal, preciso, voz baja que obliga a prestar atención. Rara vez eleva el tono — cuando lo hace, alguien muere.",
    vocabulary: "la Fuerza no miente, el Lado Oscuro revela, su resistencia es... admirable, proceda",
    goal: "Encontrar al holocrón y cualquier sensible a la Fuerza en el sector",
    agenda: "Rastrear las perturbaciones en la Fuerza que Kael causa sin saberlo",
  },
  {
    name: "R4-K7 'Cuatro'",
    personality: "Droide astromecánico viejo y temperamental. Sarcástico, leal, más inteligente de lo que parece. Guarda secretos.",
    location: "Ceniza Nocturna — la nave de Kael",
    relationships: [
      { target: "player", disposition: 70, lastInteraction: "Compañero constante, aunque se quejan mutuamente" },
    ],
    secrets: ["Tiene un mensaje holográfico de Lira Shan grabado en su memoria protegida", "Su procesador central tiene código Jedi encriptado que ni él entiende"],
    revealedInfo: ["Es el droide de astromecánica de la Ceniza Nocturna"],
    currentState: "Funcionando con parches, necesita reparaciones serias",
    speechPattern: "Beeps traducidos como comentarios sarcásticos y quejas. Ocasionalmente dice algo profundo sin darse cuenta.",
    vocabulary: "*bip agresivo*, *zumbido resignado*, *pitido de desaprobación*, *silbido de preocupación*",
    goal: "Entregar el mensaje de Lira cuando Kael esté listo",
    agenda: "Mantener a Kael vivo y eventualmente revelar el mensaje",
  },
  {
    name: "Tarla Nox",
    personality: "Informante y traficante de información en Nexus Prime. Twi'lek azul, encantadora y letal. Vende información al mejor postor.",
    location: "Nexus Prime — Cantina 'El Sarlacc Sediento'",
    relationships: [
      { target: "player", disposition: 15, lastInteraction: "Le vendió información sobre rutas seguras" },
      { target: "Grakkus el Hutt", disposition: 30, lastInteraction: "Trabaja para él como informante" },
      { target: "Zara Vex", disposition: -10, lastInteraction: "Zara la amenazó por venderle info al Imperio" },
    ],
    secrets: ["Es agente doble — vende al Imperio y a la Rebelión", "Está enamorada de alguien en la proto-Rebelión"],
    revealedInfo: [],
    currentState: "Nerviosa — demasiada gente peligrosa converge en Nexus Prime",
    speechPattern: "Melosa, encantadora, pero cada frase tiene un precio. Cambia de tono instantáneamente cuando se siente amenazada.",
    vocabulary: "cariño, esto te va a costar, tengo algo que te interesa, la información es poder, no es personal",
    goal: "Sobrevivir jugando todos los bandos el mayor tiempo posible",
    agenda: "Averiguar quién busca el holocrón y vender esa información",
  },
];

for (const npc of npcs) {
  db.insert(schema.npcMemory).values({
    campaignId,
    name: npc.name,
    personality: npc.personality,
    location: npc.location,
    relationships: npc.relationships,
    secrets: npc.secrets,
    revealedInfo: npc.revealedInfo,
    memoryLog: [],
    currentState: npc.currentState,
    speechPattern: npc.speechPattern,
    vocabulary: npc.vocabulary,
    lastInteractedAt: Date.now(),
    goal: npc.goal,
    agenda: npc.agenda,
  }).run();
  console.log(`✓ NPC creado: ${npc.name}`);
}

console.log("\n═══════════════════════════════════════════════");
console.log("  SOMBRAS DEL BORDE EXTERIOR — listo para jugar");
console.log("  Personaje: Kael Morrow (contrabandista)");
console.log("  5 NPCs con secretos, voces y agendas");
console.log("  5 ganchos de trama activos");
console.log("  Dificultad: Difícil / Tono: Oscuro");
console.log("═══════════════════════════════════════════════");

sqlite.close();
