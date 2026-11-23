import { type ReactNode } from "react";
import { AppHeader } from "@/components/layout/app-header";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
