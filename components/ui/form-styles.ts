import { cn } from "@/lib/utils";

export const inputClass = cn(
  "w-full px-3 py-2 text-sm rounded-md",
  "bg-background border border-input",
  "focus:outline-none focus:ring-1 focus:ring-ring",
  "placeholder:text-muted-foreground"
);

export const labelClass = "block text-xs font-medium text-muted-foreground mb-1.5";

export const selectClass = cn(
  "w-full px-3 py-2 text-sm rounded-md appearance-none",
  "bg-background border border-input",
  "focus:outline-none focus:ring-1 focus:ring-ring"
);
