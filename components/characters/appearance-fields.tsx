"use client";

import type { Appearance } from "@/types";
import { cn } from "@/lib/utils";
import { inputClass, labelClass } from "@/components/ui/form-styles";

interface AppearanceFieldsProps {
  value: Appearance;
  onChange: (value: Appearance) => void;
}

type SelectKey = "gender" | "build" | "height" | "age" | "skinTone";
type TextKey = "hairColor" | "hairStyle" | "eyeColor" | "eyeFeature";

const SELECT_FIELDS: Array<{ key: SelectKey; label: string; options: Array<[string, string]> }> = [
  {
    key: "gender",
    label: "Gender",
    options: [
      ["1man", "Man"],
      ["1woman", "Woman"],
      ["1person, androgynous", "Non-binary"],
      ["1boy", "Boy"],
      ["1girl", "Girl"],
      ["1alien", "Alien"],
      ["1droid", "Droid"],
    ],
  },
  {
    key: "build",
    label: "Build",
    options: [
      ["lean", "Lean"],
      ["athletic", "Athletic"],
      ["muscular", "Muscular"],
      ["heavy", "Heavy"],
      ["slim", "Slim"],
      ["wiry", "Wiry"],
    ],
  },
  {
    key: "height",
    label: "Height",
    options: [
      ["short", "Short"],
      ["average height", "Average"],
      ["tall", "Tall"],
    ],
  },
  {
    key: "age",
    label: "Age",
    options: [
      ["young", "Young"],
      ["adult", "Adult"],
      ["middle-aged", "Middle-aged"],
      ["elderly", "Elderly"],
    ],
  },
  {
    key: "skinTone",
    label: "Skin",
    options: [
      ["pale", "Pale"],
      ["fair", "Fair"],
      ["olive", "Olive"],
      ["brown", "Brown"],
      ["dark", "Dark"],
      ["green", "Green"],
      ["blue", "Blue"],
    ],
  },
];

const TEXT_FIELDS: Array<{ key: TextKey; label: string; placeholder: string }> = [
  { key: "hairColor", label: "Hair Color", placeholder: "black, red, silver..." },
  { key: "hairStyle", label: "Hair Style", placeholder: "short, braided, shaved..." },
  { key: "eyeColor", label: "Eye Color", placeholder: "brown, green, amber..." },
  { key: "eyeFeature", label: "Eye Feature", placeholder: "cybernetic, scarred, glowing..." },
];

const WIDE_FIELDS: Array<{ key: "clothing" | "features"; label: string; placeholder: string }> = [
  { key: "clothing", label: "Clothing", placeholder: "worn leather duster, heavy boots, dark cloak..." },
  { key: "features", label: "Distinguishing Features", placeholder: "facial scar, cybernetic arm, tribal tattoos..." },
];

const traitLabelClass = "text-[10px] text-muted-foreground/70 mb-0.5 block";

export function AppearanceFields({ value, onChange }: AppearanceFieldsProps) {
  function updateTrait(key: keyof Appearance, next: string) {
    onChange({ ...value, [key]: next || undefined });
  }

  return (
    <div>
      <span className={labelClass}>Appearance <span className="font-normal text-muted-foreground/60">(for scene illustrations)</span></span>
      <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SELECT_FIELDS.map(({ key, label, options }) => (
          <div key={key}>
            <label className={traitLabelClass}>{label}</label>
            <select value={value[key] ?? ""} onChange={(e) => updateTrait(key, e.target.value)} className={cn(inputClass, "text-xs")}>
              <option value="">—</option>
              {options.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </div>
        ))}
        {TEXT_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className={traitLabelClass}>{label}</label>
            <input type="text" value={value[key] ?? ""} onChange={(e) => updateTrait(key, e.target.value)} placeholder={placeholder} className={cn(inputClass, "text-xs")} />
          </div>
        ))}
      </div>
      {WIDE_FIELDS.map(({ key, label, placeholder }) => (
        <div key={key} className="mt-2">
          <label className={traitLabelClass}>{label}</label>
          <input type="text" value={value[key] ?? ""} onChange={(e) => updateTrait(key, e.target.value)} placeholder={placeholder} className={cn(inputClass, "text-xs")} />
        </div>
      ))}
    </div>
  );
}
