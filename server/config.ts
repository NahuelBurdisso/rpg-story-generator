import { join } from "path";
import { z } from "zod";

/**
 * Server-only configuration. Never import this from client code (components/,
 * hooks/, pages, lib/): it reads process.env and Node's `path`.
 */
/** An empty string (e.g. `COMFYUI_URL=` in a .env) counts as unset. */
const emptyAsUnset = (v: unknown) => (v === "" ? undefined : v);
const field = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(emptyAsUnset, schema);

const Env = z.object({
  OLLAMA_URL: field(z.string().url().default("http://localhost:11434")),
  COMFYUI_URL: field(z.string().url().default("http://localhost:8188")),
  COMFYUI_WS_URL: field(z.string().default("ws://localhost:8188/ws")),
  RPG_OUTPUT_DIR: field(z.string().default("D:/ai-output/rpg")),
  COMFYUI_INPUT_DIR: field(z.string().default("D:/ai-input")),
  DB_PATH: field(z.string().optional()),
  /**
   * Fixed context window for every request. Ollama reloads the whole model when
   * num_ctx changes between requests, so a per-request size makes it thrash;
   * reloads kill in-flight calls with HTTP 500.
   */
  OLLAMA_NUM_CTX: field(z.coerce.number().int().positive().default(12288)),
});

export interface AppConfig {
  ollamaUrl: string;
  comfyuiUrl: string;
  comfyuiWsUrl: string;
  outputDir: string;
  comfyuiInputDir: string;
  dbPath: string;
  ollamaNumCtx: number;
}

type EnvVars = Record<string, string | undefined>;

/** Parses one env var on its own, so a bad value only breaks the field that uses it. */
function readVar<K extends keyof z.infer<typeof Env>>(env: EnvVars, key: K): z.infer<typeof Env>[K] {
  const result = Env.shape[key].safeParse(env[key]);
  if (!result.success) {
    throw new Error(`Invalid ${key}: ${result.error.issues.map((i) => i.message).join("; ")}`);
  }
  return result.data as z.infer<typeof Env>[K];
}

const resolvers: { [K in keyof AppConfig]: (env: EnvVars) => AppConfig[K] } = {
  ollamaUrl: (env) => readVar(env, "OLLAMA_URL"),
  comfyuiUrl: (env) => readVar(env, "COMFYUI_URL"),
  comfyuiWsUrl: (env) => readVar(env, "COMFYUI_WS_URL"),
  outputDir: (env) => readVar(env, "RPG_OUTPUT_DIR"),
  comfyuiInputDir: (env) => readVar(env, "COMFYUI_INPUT_DIR"),
  dbPath: (env) => readVar(env, "DB_PATH") ?? join(process.cwd(), "data", "rpg.db"),
  ollamaNumCtx: (env) => readVar(env, "OLLAMA_NUM_CTX"),
};

/** Validates every field at once (tests, startup checks). */
export function readConfig(env: EnvVars): AppConfig {
  return Object.fromEntries(
    (Object.keys(resolvers) as (keyof AppConfig)[]).map((k) => [k, resolvers[k](env)]),
  ) as unknown as AppConfig;
}

/**
 * Process-wide config. Each field is resolved from `process.env` when it is
 * read (not frozen at import) and validated on its own: a stubbed env var
 * still takes effect, and a bad COMFYUI_URL only breaks code that reads it
 * (never the DB path at boot).
 */
export const config: AppConfig = Object.defineProperties(
  {} as AppConfig,
  Object.fromEntries(
    (Object.keys(resolvers) as (keyof AppConfig)[]).map((key) => [
      key,
      { enumerable: true, get: () => resolvers[key](process.env) },
    ]),
  ),
);

/** The single user-settings row id (single-user app). */
export const SETTINGS_ID = "default";
