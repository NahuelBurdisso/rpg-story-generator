import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql, type InferSelectModel } from "drizzle-orm";
import {
  GENRES, TONES, DIFFICULTIES, IMAGE_STYLES, LLM_PROVIDERS, TRIGGER_TYPES, IMAGE_STATUSES,
  SESSION_STATUSES, MESSAGE_ROLES, MEMORY_KINDS, MEMORY_SOURCES, MEMORY_STATUSES,
} from "@/lib/enums";
import type {
  Appearance, CampaignStoryState, ConsequenceSeed, ContextSnapshot, CustomImageConfig,
  MessageMetadata, NpcMemoryLogEntry, NpcRelationship, QuickAction, SceneState, SessionStoryState,
} from "./jsonTypes";

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  genre: text("genre", { enum: GENRES }).notNull(),
  customGenre: text("custom_genre"),
  tone: text("tone", { enum: TONES }).notNull(),
  difficulty: text("difficulty", { enum: DIFFICULTIES }).notNull(),
  worldDescription: text("world_description").notNull().default(""),
  customRules: text("custom_rules"),
  campaignJournal: text("campaign_journal"),
  storyState: text("story_state", { mode: "json" }).$type<CampaignStoryState | null>(),
  statDefinitions: text("stat_definitions", { mode: "json" }).$type<string[]>().notNull().default([]),
  quickActions: text("quick_actions", { mode: "json" }).$type<QuickAction[]>().notNull().default([]),
  plotHooks: text("plot_hooks", { mode: "json" }).$type<string[]>().notNull().default([]),
  imageStyle: text("image_style", { enum: IMAGE_STYLES }).default("painterly-fantasy"),
  imageEnabled: integer("image_enabled", { mode: "boolean" }).default(false),
  customImageConfig: text("custom_image_config", { mode: "json" }).$type<CustomImageConfig | null>(),
  lastPlayedAt: integer("last_played_at"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index("idx_campaigns_last_played").on(table.lastPlayedAt),
]);

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  backstory: text("backstory").notNull(),
  stats: text("stats", { mode: "json" }).$type<Record<string, number>>().notNull(),
  inventory: text("inventory", { mode: "json" }).$type<string[]>().notNull(),
  appearance: text("appearance", { mode: "json" }).$type<Appearance | null>(),
  statusNotes: text("status_notes"),
  portraitUrl: text("portrait_url"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index("idx_characters_campaign").on(table.campaignId),
]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  summary: text("summary"),
  contextSummary: text("context_summary"),
  status: text("status", { enum: SESSION_STATUSES }).notNull().default("active"),
  processingStartedAt: integer("processing_started_at"),
  lastSummaryAt: integer("last_summary_at"),
  consequenceSeeds: text("consequence_seeds", { mode: "json" }).$type<ConsequenceSeed[]>().notNull().default([]),
  storyState: text("story_state", { mode: "json" }).$type<SessionStoryState | null>(),
  sceneState: text("scene_state", { mode: "json" }).$type<SceneState | null>(),
  lastImageMessageCount: integer("last_image_message_count"),
  startedAt: integer("started_at").notNull().$defaultFn(() => Date.now()),
  endedAt: integer("ended_at"),
}, (table) => [
  index("idx_sessions_campaign_started").on(table.campaignId, table.startedAt),
]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: MESSAGE_ROLES }).notNull(),
  content: text("content").notNull(),
  streamingText: text("streaming_text"),
  isStreaming: integer("is_streaming", { mode: "boolean" }).default(false),
  metadata: text("metadata", { mode: "json" }).$type<MessageMetadata>(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index("idx_messages_session_created").on(table.sessionId, table.createdAt),
]);

export const userSettings = sqliteTable("user_settings", {
  id: text("id").primaryKey().default("default"),
  provider: text("provider", { enum: LLM_PROVIDERS }).notNull().default("ollama"),
  ollamaBaseUrl: text("ollama_base_url").default("http://localhost:11434"),
  openaiApiKey: text("openai_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  selectedModel: text("selected_model"),
  maxContextMessages: integer("max_context_messages").default(20),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

export const npcMemory = sqliteTable("npc_memory", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  personality: text("personality").notNull(),
  location: text("location").notNull(),
  relationships: text("relationships", { mode: "json" }).$type<NpcRelationship[]>().notNull(),
  secrets: text("secrets", { mode: "json" }).$type<string[]>().notNull(),
  revealedInfo: text("revealed_info", { mode: "json" }).$type<string[]>().notNull(),
  memoryLog: text("memory_log", { mode: "json" }).$type<NpcMemoryLogEntry[]>().notNull(),
  deepHistory: text("deep_history"),
  currentState: text("current_state").notNull(),
  speechPattern: text("speech_pattern"),
  vocabulary: text("vocabulary"),
  goal: text("goal"),
  agenda: text("agenda"),
  agendaThreadId: text("agenda_thread_id"),
  lastActedTurn: integer("last_acted_turn"),
  lastInteractedAt: integer("last_interacted_at"),
}, (table) => [
  index("idx_npc_memory_campaign").on(table.campaignId),
  index("idx_npc_memory_campaign_name").on(table.campaignId, table.name),
  uniqueIndex("uq_npc_memory_campaign_lname").on(table.campaignId, sql`lower(trim(name))`),
]);

export const sceneImages = sqliteTable("scene_images", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type", { enum: TRIGGER_TYPES }).notNull(),
  sdPrompt: text("sd_prompt").notNull(),
  sdNegativePrompt: text("sd_negative_prompt").notNull(),
  filePath: text("file_path"),
  status: text("status", { enum: IMAGE_STATUSES }).notNull().default("generating"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  progress: integer("progress").default(0),
  progressPhase: text("progress_phase").default("preparing"),
  characterId: text("character_id"),
  contextSnapshot: text("context_snapshot", { mode: "json" }).$type<ContextSnapshot | null>(),
  generationTimeMs: integer("generation_time_ms"),
  /** KSampler seed used for this generation — allows exact reproduction via "Variation" with same seed. */
  seed: integer("seed"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index("idx_scene_images_message").on(table.messageId),
  index("idx_scene_images_campaign_created").on(table.campaignId, table.createdAt),
  index("idx_scene_images_session_created").on(table.sessionId, table.createdAt),
]);

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  npcId: text("npc_id").notNull().references(() => npcMemory.id, { onDelete: "cascade" }),
  about: text("about").notNull(),
  kind: text("kind", { enum: MEMORY_KINDS }).notNull().default("episodic"),
  content: text("content").notNull(),
  valence: integer("valence").notNull(),
  salienceBase: integer("salience_base").notNull(),
  source: text("source", { enum: MEMORY_SOURCES }).notNull().default("witnessed"),
  confidence: integer("confidence").notNull().default(100),
  threadId: text("thread_id"),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
  introducedTurn: integer("introduced_turn").notNull(),
  lastReinforcedTurn: integer("last_reinforced_turn").notNull(),
  status: text("status", { enum: MEMORY_STATUSES }).notNull().default("active"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index("idx_memories_npc_status").on(table.npcId, table.status),
  index("idx_memories_campaign").on(table.campaignId),
  index("idx_memories_thread").on(table.threadId),
]);

// ---------------------------------------------------------------------------
// Drizzle inferred row types — use these instead of `any`
// ---------------------------------------------------------------------------
export type CampaignRow = InferSelectModel<typeof campaigns>;
export type CharacterRow = InferSelectModel<typeof characters>;
export type SessionRow = InferSelectModel<typeof sessions>;
export type MessageRow = InferSelectModel<typeof messages>;
export type UserSettingsRow = InferSelectModel<typeof userSettings>;
export type NpcMemoryRow = InferSelectModel<typeof npcMemory>;
export type SceneImageRow = InferSelectModel<typeof sceneImages>;
export type MemoryRow = InferSelectModel<typeof memories>;
