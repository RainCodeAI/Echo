/**
 * Getting-started checklist and sample note (pure, tested).
 */

export type StepId = "profile" | "crew" | "share" | "firstNote" | "alerts";

export type Step = { id: StepId; done: boolean; optional: boolean };

/** Names users.store gives a new workspace before the owner renames it. */
export function isDefaultCompanyName(name: string): boolean {
  const n = name.trim();
  return n === "" || n === "My Company" || /'s Company$/.test(n);
}

export function computeSteps(input: {
  companyName: string;
  primaryTrade?: string;
  activeCrew: number;
  sharedAt?: number;
  crewNotes: number;
  alertsOn: boolean;
}): { steps: Step[]; requiredDone: number; requiredTotal: number; allRequiredDone: boolean } {
  const steps: Step[] = [
    { id: "profile", done: !isDefaultCompanyName(input.companyName) && !!input.primaryTrade, optional: false },
    { id: "crew", done: input.activeCrew > 0, optional: false },
    { id: "share", done: !!input.sharedAt, optional: false },
    { id: "firstNote", done: input.crewNotes > 0, optional: false },
    { id: "alerts", done: input.alertsOn, optional: true },
  ];
  const required = steps.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  return { steps, requiredDone, requiredTotal: required.length, allRequiredDone: requiredDone === required.length };
}

/**
 * A realistic memo to explore before any crew records: recorded in Spanish,
 * structured in English (the bilingual path), with materials and tasks.
 */
export const SAMPLE_NOTE = {
  rawTranscript:
    "Oye, aquí Luis en la casa de Ramírez. Ya quitamos las tejas del lado norte. Encontramos madera podrida cerca de la chimenea, como tres hojas de OSB. Necesitamos doce paquetes de tejas color carbón y una caja de clavos. Hay que llamar a la señora para avisarle de la madera. Mañana empezamos el underlayment si no llueve.",
  aiTitle: "North slope tear-off done; rot found by chimney",
  aiSummary:
    "Tear-off on the north slope is finished. The crew found rotted decking near the chimney (about 3 sheets of OSB) that needs replacing. Underlayment starts tomorrow if it doesn't rain. The homeowner should be told about the rot.",
  materials: [
    { name: "Architectural shingles", quantity: "12", unit: "bundles", notes: "Charcoal" },
    { name: "OSB sheathing", quantity: "3", unit: "sheets", notes: "Replace rotted decking by the chimney" },
    { name: "Roofing nails", quantity: "1", unit: "box" },
  ],
  actionItems: [
    { title: "Call the homeowner about the rotted decking", priority: "high" as const, assigneeHint: "office" },
    { title: "Order shingles and OSB for tomorrow", priority: "medium" as const },
  ],
  urgency: "medium" as const,
  timelineNotes: "Underlayment tomorrow, weather permitting.",
  tags: ["sample", "materials_needed", "change_order"],
};
