// Confirmation copy for a bulk stage move. The count and destination are stated because the
// selection lives in a toolbar the dialog covers, and there is no undo: reversing the move is a
// second bulk move.
export const BULK_MOVE_DESCRIPTION =
  "A etapa muda para todo o time. Não há como desfazer, então movê-los de volta é outra movimentação em massa.";

export function bulkMoveTitle(count: number, stageName: string): string {
  const unit = count === 1 ? "negócio" : "negócios";
  return `Mover ${count} ${unit} para ${stageName}?`;
}
