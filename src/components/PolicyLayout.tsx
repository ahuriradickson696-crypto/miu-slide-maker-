import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { MIU_FACTS } from "@/lib/miu-facts";
import logo from "@/assets/miu-logo.png";

export function PolicyLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a href="/" className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Home</span>
          </a>
          <div className="flex-1" />
          <nav className="flex items-center gap-3 text-xs text-muted-foreground">
            <a href="/privacy-policy" className="hover:text-primary transition">Privacy</a>
            <a href="/data-protection" className="hover:text-primary transition">Data Protection</a>
            <a href="/academic-policy" className="hover:text-primary transition">Academic Policy</a>
            <a href="/terms" className="hover:text-primary transition">Terms</a>
            <a href="/accessibility" className="hover:text-primary transition">Accessibility</a>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-center gap-3 mb-2">
          <img src={logo} alt="" className="h-10 w-10 object-contain" />
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              {title}
            </h1>
            <p className="text-xs text-muted-foreground">
              {MIU_FACTS.legalName} • Last updated {lastUpdated}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            <strong>Draft, pending legal review.</strong> This page gives real structure and sourced background,
            not final legal text. It should not be treated as binding until MIU's registrar/legal office
            reviews it and confirms the open items noted at the bottom of this page.
          </p>
        </div>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-700 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-primary [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:pt-4 [&_h2]:border-t [&_h2]:first:border-t-0 [&_h2]:first:pt-0 [&_h2]:first:mt-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_strong]:text-slate-900 [&_a]:text-primary [&_a]:underline [&_a]:decoration-dotted">
          {children}
        </div>

        <div className="mt-10 border-t pt-4 text-[11px] text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <span>
            {MIU_FACTS.legalName} • {MIU_FACTS.accreditation}
          </span>
          <span>{MIU_FACTS.website} • {MIU_FACTS.campusesShort}</span>
        </div>
      </div>
    </div>
  );
}

export function OpenItems({ items }: { items: string[] }) {
  return (
    <div className="mt-8 rounded-lg border bg-white p-4">
      <h2 className="text-sm font-semibold mb-2">Open items to confirm with MIU before this is final</h2>
      <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
