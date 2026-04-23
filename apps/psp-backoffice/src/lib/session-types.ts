export type LayoutSession =
  | { role: "admin" }
  | { role: "merchant"; merchantId: string };
