/** Drop a trailing meta note like "(Para discernir la naturaleza del objeto)". */
function stripMetaNote(text: string): string {
  return text.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

export function parseSnippets(response: string): Map<number, string> {
  const snippets = new Map<number, string>();
  const lines = response.split("\n");
  let currentIdx: number | null = null;
  let currentText = "";
  let afterBlank = false;

  for (const line of lines) {
    const match = line.match(/^#(\d+):\s*(.*)$/);
    if (match) {
      // Save previous snippet if any
      if (currentIdx !== null && currentText) {
        snippets.set(currentIdx, stripMetaNote(currentText));
      }
      currentIdx = parseInt(match[1]);
      currentText = match[2];
      afterBlank = false;
    } else if (currentIdx !== null && line.trim()) {
      // Continuation line for current snippet. Paragraph breaks and dialogue
      // lines are kept: the outcome-aware rewrite spans several paragraphs.
      const text = line.trim();
      const breakBefore = currentText && (afterBlank || text.startsWith(">"));
      currentText += breakBefore ? "\n\n" + text : (currentText ? " " : "") + text;
      afterBlank = false;
    } else if (currentIdx !== null) {
      afterBlank = true;
    }
  }
  // Save last snippet
  if (currentIdx !== null && currentText) {
    snippets.set(currentIdx, stripMetaNote(currentText));
  }

  return snippets;
}

export function getMarkerContext(
  text: string,
  startIndex: number,
  endIndex: number
): { before: string; after: string } {
  const beforeStart = Math.max(0, startIndex - 100);
  const afterEnd = Math.min(text.length, endIndex + 100);
  return {
    before: text.slice(beforeStart, startIndex) || "[start of text]",
    after: text.slice(endIndex, afterEnd) || "[end of text]",
  };
}
