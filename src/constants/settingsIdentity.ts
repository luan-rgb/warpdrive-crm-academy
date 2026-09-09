// UI strings and the action-error mapper for the identity settings area
// (users, teams, permission sets, visibility groups). Kept separate from the
// large shared strings.ts to stay under the file-size limit and to co-locate
// the raw-error -> readable-message mapping these forms share.

export const IDENTITY_SETTINGS_STRINGS = {
  flagEditor: {
    global: "Global",
    ownership: "Propriedade",
    save: "Salvar permissões",
    saving: "Salvando...",
  },
  teamEditor: {
    createTitle: "Criar uma equipe",
    createDescription: "Agrupe usuários sob um gestor e mantenha a propriedade organizada.",
    nameLabel: "Nome da equipe",
    namePlaceholder: "Nome da nova equipe",
    create: "Criar",
    creating: "Criando...",
    manager: "Gestor",
    managerNone: "Sem gestor",
    members: "Membros",
    membersHelp: "Selecione os usuários que pertencem a esta equipe.",
    membersPlaceholder: "Buscar e adicionar membros",
  },
} as const;

// Readable, user-facing copy for each distinct failure. The identity actions
// return a plain `string` error (see Result<T, string>); we translate the known
// internal strings into friendly messages and fall back to a generic one so no
// raw internal wording ever leaks to the UI.
export const IDENTITY_ERROR_MESSAGES = {
  generic: "Algo deu errado. Tente novamente.",
  session: "Sua sessão parece expirada. Atualize a página e tente novamente.",
  permission: "Você não tem permissão para fazer isso.",
  selfPromote: "Você não pode se tornar administrador.",
  lastAdmin: "Você não pode remover o último administrador ativo.",
  selfDeactivate: "Você não pode desativar sua própria conta.",
  reactivateAdmin: "Somente um administrador pode reativar usuários.",
  selfPermissionSet: "Você não pode editar seu próprio conjunto de permissão.",
  notFound: "Esse registro não existe mais.",
  invalidInput: "Alguns dos dados informados são inválidos.",
} as const;

type ErrorKey = keyof typeof IDENTITY_ERROR_MESSAGES;

// Maps the raw error strings thrown by the identity guards/actions to a message key.
const RAW_ERROR_TO_KEY: Record<string, ErrorKey> = {
  unauthorized: "permission",
  "permissions.manage required": "permission",
  "admin required to change admin role": "permission",
  "admin required to deactivate users": "permission",
  "admin required to reactivate users": "reactivateAdmin",
  "missing csrf token": "session",
  "csrf token mismatch": "session",
  "origin mismatch": "session",
  "cross-site request rejected": "session",
  "cannot self-promote": "selfPromote",
  "cannot deactivate the last active admin": "lastAdmin",
  "cannot demote the last active admin": "lastAdmin",
  "cannot deactivate yourself": "selfDeactivate",
  "cannot edit your own permission set": "selfPermissionSet",
  "cannot reassign your own permission set": "selfPermissionSet",
  not_found: "notFound",
  "permission set not found": "notFound",
  "invalid input": "invalidInput",
};

// Translate an identity action error string into a readable inline-form message.
export function identityErrorMessage(error: string): string {
  const key = RAW_ERROR_TO_KEY[error];
  return key === undefined ? IDENTITY_ERROR_MESSAGES.generic : IDENTITY_ERROR_MESSAGES[key];
}
