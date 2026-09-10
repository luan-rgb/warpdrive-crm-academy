"use client";
import { Info } from "lucide-react";
import type React from "react";
import { PopMenu } from "./PopMenu";

// Static explanatory popover next to the Source origin header (Pipedrive's source-popover-button).
export function SourceOriginInfo(): React.ReactNode {
  return (
    <PopMenu
      triggerLabel="Sobre origem"
      triggerClassName="ml-1 inline-flex text-muted-foreground hover:text-foreground"
      panelClassName="w-64 normal-case"
      trigger={<Info aria-hidden="true" className="h-3.5 w-3.5" />}
    >
      {() => (
        <p className="px-2 py-1 text-xs font-normal text-pretty text-muted-foreground">
          Origem registra como um lead entrou no warpdrive: criado manualmente, importado, capturado
          por um formulário web, ou sincronizado de outro canal. É definida quando o lead é criado e
          não pode ser editada.
        </p>
      )}
    </PopMenu>
  );
}
