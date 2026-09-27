import type { ReactNode } from "react";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import { can } from "@/features/permissions/can";
import { listProducts } from "@/features/products/productsRepo";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { ProductsClient } from "./ProductsClient";

export const metadata = { title: SETTINGS_STRINGS.products };

export default async function ProductsSettingsPage(): Promise<ReactNode> {
  const { actor, db } = await createContext();
  if (actor === null || !can(actor, "product.manage")) {
    return <p className="text-sm text-red-600">{SETTINGS_STRINGS.requiresAdmin}</p>;
  }
  const products = await listProducts(db, { includeArchived: true }, AbortSignal.timeout(5000));

  return (
    <SettingsPage>
      <SettingsHeading
        help="product.catalog"
        title={SETTINGS_STRINGS.products}
        description={SETTINGS_STRINGS.productsDescription}
      />
      <ProductsClient products={products} />
    </SettingsPage>
  );
}
