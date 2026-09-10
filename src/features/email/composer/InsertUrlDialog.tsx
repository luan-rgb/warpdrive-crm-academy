"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";

export type InsertUrlKind = "link" | "image";

const LINK_ALLOWED_SCHEMES = /^(https?:|mailto:)/i;
const IMAGE_ALLOWED_SCHEMES = /^(https?:|data:image\/)/i;

const COPY = {
  link: {
    title: "Inserir link",
    description: "Adicione um link HTTP, HTTPS ou de e-mail.",
    label: "URL do link",
    placeholder: "https://example.com…",
    action: "Inserir link",
    error: "Informe uma URL HTTP, HTTPS ou mailto.",
  },
  image: {
    title: "Inserir imagem",
    description: "Adicione uma URL de imagem HTTP, HTTPS ou data.",
    label: "URL da imagem",
    placeholder: "https://example.com/image.png…",
    action: "Inserir imagem",
    error: "Informe uma URL de imagem HTTP, HTTPS ou data.",
  },
} as const;

interface InsertUrlDialogProps {
  kind: InsertUrlKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (url: string) => void;
}

export function InsertUrlDialog({
  kind,
  open,
  onOpenChange,
  onInsert,
}: InsertUrlDialogProps): React.ReactNode {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[kind];

  function submit(): void {
    const trimmed = value.trim();
    const allowed = kind === "link" ? LINK_ALLOWED_SCHEMES : IMAGE_ALLOWED_SCHEMES;
    if (!allowed.test(trimmed)) {
      setError(copy.error);
      return;
    }
    onInsert(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div>
            <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
              {copy.label}
            </label>
            <Input
              id={inputId}
              name={`${kind}Url`}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error !== null) setError(null);
              }}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={copy.placeholder}
            />
            {error !== null ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button type="submit">{copy.action}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
