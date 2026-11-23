import { describe, it, expect } from "vitest";
import { cleanRecap, streamBeforeMarker } from "../../server/pipeline/utils";

describe("cleanRecap", () => {
  it("keeps a plain recap untouched", () => {
    const recap = "Ilse bajó al pozo sellado y encontró el pañuelo del alcalde. Ahora Vargas sabe que ella sabe.";
    expect(cleanRecap(recap)).toBe(recap);
  });

  it("keeps only the first option when the model offers several", () => {
    // Shape captured from a local gemma model.
    const raw =
      "Acá te van un par de opciones, dependiendo del tono que busques:\n\n" +
      "**Opción 1 (Más épica/misterio):**\n\n" +
      "> Ilse confrontó al Alcalde Vargas con el pañuelo. Ahora la escalera la espera.\n\n" +
      "**Opción 2 (Más directa/acción):**\n\n> Otra cosa.";
    expect(cleanRecap(raw)).toBe("Ilse confrontó al Alcalde Vargas con el pañuelo. Ahora la escalera la espera.");
  });

  it("handles the same shape in English", () => {
    const raw =
      "Here are a couple of options:\n\n**Option 1 (Mystery):**\n\n> Ilse confronted the mayor.\n\n**Option 2 (Action):**\n\n> Something else.";
    expect(cleanRecap(raw)).toBe("Ilse confronted the mayor.");
  });
});

describe("streamBeforeMarker", () => {
  function collect(chunks: string[]) {
    const out: string[] = [];
    const sink = streamBeforeMarker((t) => out.push(t));
    return Promise.all(chunks.map((c) => sink(c))).then(() => out.join(""));
  }

  it("forwards everything when there is no marker", async () => {
    expect(await collect(["You open ", "the hatch."])).toBe("You open the hatch.");
  });

  it("stops at a marker split across chunks", async () => {
    expect(await collect(["You reach for the latch [MEC", "HANIC:stat_check:Agility:DC12] as it ", "swings."])).toBe(
      "You reach for the latch "
    );
  });

  it("releases a bracket that turns out not to be a marker", async () => {
    expect(await collect(["The sign reads [M", "AINTENANCE] in red."])).toBe("The sign reads [MAINTENANCE] in red.");
  });
});

describe("streamBeforeMarker control blocks", () => {
  it("stops before a STATE_UPDATE block split across chunks", async () => {
    const out: string[] = [];
    const sink = streamBeforeMarker((t) => out.push(t));
    for (const c of ["The core hums.\n\n<!", "-- STATE_UP", "DATE\n{}\nSTATE_UPDATE -->"]) await sink(c);
    expect(out.join("")).toBe("The core hums.\n\n");
  });

  it("stops before a bare STATE_UPDATE tag", async () => {
    const out: string[] = [];
    const sink = streamBeforeMarker((t) => out.push(t));
    for (const c of ["Done. STATE_UP", "DATE: {}"]) await sink(c);
    expect(out.join("")).toBe("Done. ");
  });
});
