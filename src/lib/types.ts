export const categories = [
  'desk',
  'shelf',
  'keyboard',
  'light',
  'accessory',
] as const;
export type Category = (typeof categories)[number];
export type Style = 'warm' | 'minimal' | 'studio';

export interface Product {
  id: string;
  handle: string;
  name: string;
  subtitle: string;
  description: string;
  category: Category;
  priceCents: number;
  currency: 'CAD';
  color: string;
  finish: string;
  widthCm: number;
  depthCm: number;
  minDeskWidthCm: number;
  quiet: boolean;
  styles: Style[];
  available: boolean;
  shopifyVariantId?: string;
}

export interface Preferences {
  budgetCents: number;
  deskWidthCm: number;
  style: Style;
  quiet: boolean;
}

export interface Recommendation {
  products: Product[];
  totalCents: number;
  preferences: Preferences;
  reasons: string[];
  warnings: string[];
  feasible: boolean;
}

export interface CartLine {
  productId: string;
  quantity: number;
}
