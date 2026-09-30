export const PACKAGE_TYPES = [
  "Documents",
  "Food pack",
  "Groceries",
  "Clothes",
  "Small parcel",
  "Phone or gadget",
] as const;

export type PackageType = (typeof PACKAGE_TYPES)[number];

export const DEFAULT_SHOP_PACKAGE: PackageType = "Food pack";
