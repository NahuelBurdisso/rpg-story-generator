import { router } from "./trpc";
import { campaignsRouter } from "./routers/campaigns";
import { charactersRouter } from "./routers/characters";
import { sessionsRouter } from "./routers/sessions";
import { messagesRouter } from "./routers/messages";
import { userSettingsRouter } from "./routers/userSettings";
import { npcMemoryRouter } from "./routers/npcMemory";
import { imagesRouter } from "./routers/images";

export const appRouter = router({
  campaigns: campaignsRouter,
  characters: charactersRouter,
  sessions: sessionsRouter,
  messages: messagesRouter,
  userSettings: userSettingsRouter,
  npcMemory: npcMemoryRouter,
  images: imagesRouter,
});

export type AppRouter = typeof appRouter;
