"use client";

import { HardDrive } from "lucide-react";
import { getBoardDriveProvider } from "@/app/actions/board-settings";
import { GoogleDriveIcon, OneDriveIcon } from "@/components/board/publication/BrandIcons";
import { useRememberedProvider } from "@/hooks/board/useRememberedProvider";

/** Icône du module Drive : logo du service du Drive du board (Google Drive, OneDrive), disque sinon. */
export function DriveBrandIcon({ size = 18, className }: { size?: number; className?: string; strokeWidth?: number }) {
  const provider = useRememberedProvider("board-lgef:drive-provider", getBoardDriveProvider);
  if (provider === "google") return <GoogleDriveIcon size={size} />;
  if (provider === "microsoft") return <OneDriveIcon size={size} />;
  return <HardDrive size={size} className={className} />;
}
