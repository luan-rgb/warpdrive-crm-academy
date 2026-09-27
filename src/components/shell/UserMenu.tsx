"use client";
import { LogOut, Settings, User } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppearanceMenuSection } from "@/features/theme/AppearanceMenuSection";
import { APPEARANCE_DEFAULT, type Appearance } from "@/features/theme/appearance";
import { useAppearanceChoice } from "@/features/theme/useAppearanceChoice";
import { avatarColorClass, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { readCsrfToken } from "@/utils/csrfCookie";

// Top-right account menu (Pipedrive convention): an avatar button that opens a small dropdown
// with Settings and Log out. Built on the shadcn DropdownMenu primitive (focus trap, keyboard
// nav, portal). The actor carries no display name, so the avatar is a person glyph tinted
// deterministically by userId. Log out submits a hidden POST form carrying the CSRF token (a
// GET would let any link on any page sign the user out); Settings is a client-side Link.
export function UserMenu({
  userId,
  userName,
  avatarUrl,
  appearance = APPEARANCE_DEFAULT,
}: {
  userId: string;
  userName?: string;
  // The signed-in user's uploaded photo (users.avatar_url). When set, the button shows the photo
  // instead of the deterministic initials/glyph so a user actually sees the avatar they set.
  avatarUrl?: string | null;
  // The account's stored theme, so the menu opens on the choice already in effect.
  appearance?: Appearance;
}): React.ReactNode {
  const hasPhoto = avatarUrl !== undefined && avatarUrl !== null && avatarUrl !== "";
  // Held here rather than in the menu content, which Radix unmounts on close.
  const appearanceChoice = useAppearanceChoice(appearance);
  // Outside the menu content, which Radix unmounts on close.
  const logoutForm = useRef<HTMLFormElement>(null);
  const csrfInput = useRef<HTMLInputElement>(null);
  function logOut(): void {
    if (csrfInput.current !== null) csrfInput.current.value = readCsrfToken() ?? "";
    logoutForm.current?.requestSubmit();
  }
  return (
    <>
      <form ref={logoutForm} action="/auth/logout" method="post" hidden>
        <input ref={csrfInput} type="hidden" name="csrf" defaultValue="" />
      </form>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Menu da conta"
            className={cn(
              "flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-semibold transition-transform active:scale-[0.96]",
              // Skip the tinted background when a photo fills the circle.
              hasPhoto
                ? "outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                : avatarColorClass(userName !== undefined && userName !== "" ? userName : userId),
            )}
          >
            {hasPhoto ? (
              // biome-ignore lint/performance/noImgElement: tiny header avatar, next/image not warranted
              <img
                src={avatarUrl}
                alt={userName ?? "Conta"}
                className="h-full w-full rounded-full object-cover"
              />
            ) : userName !== undefined && userName !== "" ? (
              initials(userName)
            ) : (
              <User aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent aria-label="Conta" align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Minha conta
          </DropdownMenuLabel>
          <DropdownMenuItem asChild className="gap-2.5">
            <Link href="/settings/profile">
              <Settings aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              Configurações
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5" onSelect={logOut}>
            <LogOut aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            Sair
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <AppearanceMenuSection choice={appearanceChoice} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
