/** Small text helpers shared across the pipeline. */

// The mechanic-marker helpers live in lib/narrative (client-safe, shared with the chat UI).
export { MECHANIC_MARKER_RE, stripMechanicMarkers, stripMechanicMarkersLoose } from "@/lib/narrative";

/** Case- and edge-whitespace-insensitive name equality. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
