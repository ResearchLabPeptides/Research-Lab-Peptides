'use client';

import * as React from 'react';
import { CART_STORAGE_KEY } from '@/lib/constants';
import type { CartLine } from '@/lib/types';

interface CartState {
  lines: CartLine[];
  hydrated: boolean;
}

type CartAction =
  | { type: 'hydrate'; lines: CartLine[] }
  | { type: 'set'; line: Omit<CartLine, 'quantity'>; quantity: number; max: number }
  | { type: 'remove'; productId: string }
  | { type: 'clear' };

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'hydrate':
      return { lines: action.lines, hydrated: true };

    case 'set': {
      const quantity = Math.max(0, Math.min(action.quantity, action.max));
      const without = state.lines.filter((l) => l.productId !== action.line.productId);
      if (quantity === 0) return { ...state, lines: without };

      const existingIndex = state.lines.findIndex((l) => l.productId === action.line.productId);
      const next: CartLine = { ...action.line, quantity };

      // Keep the original position so the ticket does not reshuffle under the
      // shopper's cursor while they are still adjusting quantities.
      if (existingIndex === -1) return { ...state, lines: [...state.lines, next] };
      const lines = [...state.lines];
      lines[existingIndex] = next;
      return { ...state, lines };
    }

    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.productId !== action.productId) };

    case 'clear':
      return { ...state, lines: [] };
  }
}

interface CartContextValue {
  lines: CartLine[];
  hydrated: boolean;
  itemCount: number;
  subtotalCents: number;
  quantityOf: (productId: string) => number;
  setQuantity: (line: Omit<CartLine, 'quantity'>, quantity: number, max: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

const CartContext = React.createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, { lines: [], hydrated: false });

  // Restore on mount. The cart never touches a cookie, so it is never sent to
  // the server and never needs a consent banner.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const lines = Array.isArray(parsed) ? (parsed as CartLine[]).filter(isCartLine) : [];
      dispatch({ type: 'hydrate', lines });
    } catch {
      dispatch({ type: 'hydrate', lines: [] });
    }
  }, []);

  React.useEffect(() => {
    if (!state.hydrated) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.lines));
    } catch {
      // Private browsing with storage disabled. The cart still works for this
      // session; it just will not survive a reload.
    }
  }, [state.lines, state.hydrated]);

  const value = React.useMemo<CartContextValue>(() => {
    const itemCount = state.lines.reduce((sum, l) => sum + l.quantity, 0);
    const subtotalCents = state.lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);

    return {
      lines: state.lines,
      hydrated: state.hydrated,
      itemCount,
      subtotalCents,
      quantityOf: (productId) => state.lines.find((l) => l.productId === productId)?.quantity ?? 0,
      setQuantity: (line, quantity, max) => dispatch({ type: 'set', line, quantity, max }),
      remove: (productId) => dispatch({ type: 'remove', productId }),
      clear: () => dispatch({ type: 'clear' }),
    };
  }, [state.lines, state.hydrated]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.productId === 'string' &&
    typeof l.name === 'string' &&
    typeof l.priceCents === 'number' &&
    typeof l.quantity === 'number' &&
    l.quantity > 0
  );
}
