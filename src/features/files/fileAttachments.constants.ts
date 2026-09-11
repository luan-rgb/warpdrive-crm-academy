// UI copy + limits for the reusable FileAttachments component. No magic strings
// in the component tree.

// Client-side size guard, mirrors the composer's ATTACH_MAX_FILE_BYTES (server
// re-validates against env.MAX_FILE_BYTES). A fast gate that avoids a round-trip
// for obviously oversized files.
export const ATTACH_MAX_FILE_BYTES = 26_214_400;

export const FILE_ATTACHMENTS_STRINGS = {
  uploadLabel: "Enviar arquivo",
  emptyLabel: "Ainda não há arquivos anexados.",
  downloadLabel: (filename: string): string => `Baixar ${filename}`,
  tooLarge: (name: string, maxMb: number): string =>
    `"${name}" é muito grande (máx. ${maxMb} MB).`,
  unsupportedType: (name: string): string => `"${name}" tem um tipo de arquivo não suportado.`,
  uploadFailed: (name: string): string => `Falha ao enviar "${name}".`,
  downloadFailed: "Não foi possível abrir esse arquivo.",
} as const;
