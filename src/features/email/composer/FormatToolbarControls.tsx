"use client";
import {
  ALargeSmall,
  Bold,
  Image as ImageIcon,
  Indent,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
  Outdent,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Tip } from "@/components/ui/tooltip";

const COMPACT_TRIGGER_CLASSNAME =
  "h-10 w-auto justify-start gap-0.5 rounded-md border-0 bg-transparent px-2 py-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground";
const TOOL_BUTTON_CLASSNAME =
  "size-10 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground";
const FONT_FAMILY_OPTIONS: SelectOption[] = [
  { label: "Padrão", value: "" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
];
const FONT_SIZE_OPTIONS: SelectOption[] = [
  { label: "Padrão", value: "" },
  ...[10, 12, 14, 16, 18, 24, 32].map((size) => ({ label: String(size), value: `${size}px` })),
];

export interface FormatToolbarActions {
  undo: () => void;
  redo: () => void;
  bold: () => void;
  italic: () => void;
  underline: () => void;
  strike: () => void;
  bulletList: () => void;
  orderedList: () => void;
  outdent: () => void;
  indent: () => void;
  blockquote: () => void;
  link: () => void;
  image: () => void;
  clearFormat: () => void;
}

interface FormatToolbarControlsProps {
  fontFamily: string;
  fontSize: string;
  textColor: string;
  onFontFamilyChange: (value: string) => void;
  onFontSizeChange: (value: string) => void;
  onTextColorChange: (value: string) => void;
  actions: FormatToolbarActions;
}

function Divider(): React.ReactNode {
  return <span aria-hidden="true" className="mx-1 inline-block w-px self-stretch bg-border/60" />;
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}): React.ReactNode {
  return (
    <Tip label={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={onClick}
        className={TOOL_BUTTON_CLASSNAME}
      >
        <Icon aria-hidden="true" className="size-4" />
      </Button>
    </Tip>
  );
}

export function FormatToolbarControls({
  fontFamily,
  fontSize,
  textColor,
  onFontFamilyChange,
  onFontSizeChange,
  onTextColorChange,
  actions,
}: FormatToolbarControlsProps): React.ReactNode {
  return (
    <div
      role="toolbar"
      aria-label="Formatação de texto"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
    >
      <ToolButton label="Desfazer" icon={Undo2} onClick={actions.undo} />
      <ToolButton label="Refazer" icon={Redo2} onClick={actions.redo} />
      <Divider />
      <Select
        ariaLabel="Família da fonte"
        triggerContent={<Type aria-hidden="true" className="size-4" />}
        triggerClassName={COMPACT_TRIGGER_CLASSNAME}
        value={fontFamily}
        onChange={onFontFamilyChange}
        options={FONT_FAMILY_OPTIONS}
      />
      <Select
        ariaLabel="Tamanho da fonte"
        triggerContent={<ALargeSmall aria-hidden="true" className="size-4" />}
        triggerClassName={COMPACT_TRIGGER_CLASSNAME}
        value={fontSize}
        onChange={onFontSizeChange}
        options={FONT_SIZE_OPTIONS}
      />
      <ColorPicker
        value={textColor}
        onChange={onTextColorChange}
        ariaLabel="Cor do texto"
        triggerClassName={TOOL_BUTTON_CLASSNAME}
      />
      <Divider />
      <ToolButton label="Negrito" icon={Bold} onClick={actions.bold} />
      <ToolButton label="Itálico" icon={Italic} onClick={actions.italic} />
      <ToolButton label="Sublinhado" icon={Underline} onClick={actions.underline} />
      <ToolButton label="Tachado" icon={Strikethrough} onClick={actions.strike} />
      <Divider />
      <ToolButton label="Lista com marcadores" icon={List} onClick={actions.bulletList} />
      <ToolButton label="Lista numerada" icon={ListOrdered} onClick={actions.orderedList} />
      <ToolButton label="Diminuir recuo" icon={Outdent} onClick={actions.outdent} />
      <ToolButton label="Aumentar recuo" icon={Indent} onClick={actions.indent} />
      <ToolButton label="Citação" icon={Quote} onClick={actions.blockquote} />
      <Divider />
      <ToolButton label="Link" icon={LinkIcon} onClick={actions.link} />
      <ToolButton label="Imagem" icon={ImageIcon} onClick={actions.image} />
      <Divider />
      <ToolButton label="Limpar formatação" icon={RemoveFormatting} onClick={actions.clearFormat} />
    </div>
  );
}
