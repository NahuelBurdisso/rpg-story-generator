# Phase 4 — manual browser checks (collected from implementer reports)

Run the dev server from the worktree against a DB COPY (DB_PATH), never data/rpg.db.

## 4.1 (11412ce)
- Old session with [MECHANIC…]/STATE_UPDATE in narrator messages renders with no marker/STATE_UPDATE text.
- Streaming a turn: prose appears, no "resolving..." placeholder, character names still link to sheets.
- User message with a dice roll shows the dice card, no `[ROLL: …]` text. No stateParser console.warn.

## 4.2 (718e073)
- Edit a campaign with custom checkpoint/LoRA → preserved after save.
- Create/edit/delete campaign → dashboard list updates without reload; campaign header updates after edit.
- Create/edit/delete character → lists update without reload (campaign page + chat sidebar).
- Save settings with an API key → "has key" flips immediately.
- Double-click "New session" → one session; button disabled while pending; sessions list fresh.
- End session during a turn → red banner with server message; dismiss works. Normal end → "Ending..." then navigate, session completed.
- Server failure on a form → red error text shown.

## 4.3 (928f3ab)
- Campaign Delete → dialog with name; Esc/Cancel close; confirm shows "Deleting...", redirects. Failure → dialog closes, red "Could not delete the campaign: …".
- Chat End Session → "End this session?" → "Ending..." → campaign page; CONFLICT → banner.
- Character edit → Delete asks first; Cancel no-op.
- Campaign edit genre change → "Load genre presets?" dialog (Load/Keep). Create loads presets without dialog.
- Dialog focus lands on Cancel; Escape closes.

## 4.4 (3ad6998)
- ComfyUI up: Illustrate → progress bar immediately, ~2 s updates, image shows.
- ComfyUI down: amber "Image generation is unavailable right now…" note, dismissible, no stuck bar.
- Illustrate twice fast → "already being generated" note.
- Regenerate/Variation/Edit prompt (bubble) and Regenerate (lightbox): new image appears, old one gone, lightbox closes.
- Network: no /api/images/status/*; images.status batches only while generating.

## 4.3/4.4 fixes (2ae4947)
- Dialog open + window refocus → focus does NOT jump back to Cancel; closing restores focus to the opener button.
- Image status query error → "Generation failed / Retry", not endless "Preparing…". Illustrate server error → amber note.

## 4.5 (324e6a2)
- Session with >60 messages: "Load older" → no jump; play 3 turns, load again → no gaps/repeats; tab refocus doesn't refetch all pages.

## 4.6 (7662cc6)
- React Profiler while streaming: only container, MessageList and streaming bubble re-render per frame.
- End of turn: no blank frame, no duplicate, no repeated fade-in; indicator may linger until refetch (expected). Auto-scroll only when at bottom.
- Regression: Stop restores draft; Retry on error bubble works; new session opener runs once.

## 4.5/4.6 fixes (634d033)
- After done, "narrator is writing" indicator disappears immediately (even before refetch).
- Clicking "Load older" right as a turn finishes still brings in the new turn's messages.

## 4.7 (b08cb8b) + fixes (ec2549f)
- NEW session (dev/StrictMode): exactly one opening scene, no `[SESSION START…]` bubble; a transient "already processing/started" banner may flash, the opener retries once (~2 s). Old sessions still hide their opener.
- Failed opener (Ollama down): no retry loop; Retry on its error bubble resends and stays hidden.
- After a turn ends, input re-enables even if the tab was refocused mid-turn.

## 4.8 (832570d)
- Network: opening a session = one batched /api/trpc request (campaigns.get + sessions.get + characters.listByCampaign), messages in the same/adjacent batch.
- Nonexistent session/campaign id → "not found" immediately (verified by coordinator: ~0.6 s).

## 4.9 (afd5de8)
- Quick actions greyed out while the server is processing a turn.
- Lightbox edit mode: Copy button copies the edited prompt; textarea styling matches scene-image.
- Stats / plot hooks / inventory: Add disabled on empty input; duplicate stats rejected, duplicate inventory allowed.
- NPC page: Reveal/Hide secrets still works and survives collapsing a card.
- Chat toolbar/banners at mobile and desktop widths look as before.

## 4.10 (79781d9)
- Optional: `DB_PATH=<copy> npm run build` → all routes dynamic.

## Already verified by the coordinator (2026-10-23, DB copy, live Ollama)
- Pages render without console errors; no marker/STATE_UPDATE/opener leaks; live turn commits once, indicator clears, input re-enables; Stop restores draft and persists nothing; Load older adds history without duplicates; session not-found fast.
