import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createContext } from "@/server/trpc/context";

// Deliberately outside the (app) route group: a print page must not carry the LeftNav/TopBar
// chrome (recreating that fight in @media print CSS is more code than a second, chrome-less
// layout). Still auth-gated, same as (app).
export default async function InvoicePrintLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  return <div className="mx-auto max-w-3xl p-8 print:p-0">{children}</div>;
}
