import type { OrderStatus, PaymentStatus } from './types';

/**
 * The single source of truth for how each status looks and reads. Both the
 * customer tracking page and the admin board pull from here, so a status can
 * never be worded one way for staff and another way for the customer.
 */
export const ORDER_STATUS_META: Record<
  OrderStatus,
  {
    label: string;
    customerLabel: string;
    tone: 'amber' | 'green' | 'blue' | 'slate' | 'red';
    step: number;
  }
> = {
  pending_payment: {
    label: 'Pending payment',
    // Neutral wording now that an order might be waiting on either an
    // e-Transfer or a USDC transfer. The payment panel says which.
    customerLabel: 'Waiting for your payment',
    tone: 'amber',
    step: 1,
  },
  payment_received: {
    label: 'Payment received',
    customerLabel: 'Payment received',
    tone: 'green',
    step: 2,
  },
  preparing: { label: 'Preparing', customerLabel: 'Packing your order', tone: 'blue', step: 3 },
  out_for_delivery: {
    label: 'Out for delivery',
    customerLabel: 'On the way to you',
    tone: 'blue',
    step: 4,
  },
  delivered: { label: 'Delivered', customerLabel: 'Delivered', tone: 'green', step: 5 },
  cancelled: { label: 'Cancelled', customerLabel: 'Cancelled', tone: 'slate', step: 0 },
  refunded: { label: 'Refunded', customerLabel: 'Refunded', tone: 'red', step: 0 },
};

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'pending_payment',
  'payment_received',
  'preparing',
  'out_for_delivery',
  'delivered',
];

export const PAYMENT_STATUS_META: Record<
  PaymentStatus,
  { label: string; tone: 'amber' | 'green' | 'red' }
> = {
  unpaid: { label: 'Unpaid', tone: 'amber' },
  partially_paid: { label: 'Part paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  refunded: { label: 'Refunded', tone: 'red' },
};

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  receiving: 'Received',
  sale: 'Sold',
  adjustment: 'Adjusted',
  return: 'Returned',
  damaged: 'Damaged',
  expired: 'Expired',
  transfer: 'Transferred',
  cycle_count: 'Cycle count',
  reservation: 'Held for order',
  reservation_release: 'Hold released',
};

export const ROLE_LABELS: Record<string, string> = {
  administrator: 'Administrator',
  manager: 'Manager',
  employee: 'Employee',
  read_only: 'Read only',
};

/** Cart lives here between visits. Deliberately not a cookie — never sent to the server. */
export const CART_STORAGE_KEY = 'futurelite.cart.v1';
export const CHECKOUT_DETAILS_KEY = 'futurelite.checkout.v1';

export const PAYMENT_METHOD_META = {
  interac: {
    label: 'Interac e-Transfer',
    hint: 'Pay from your Canadian bank account',
  },
  usdc_solana: {
    label: 'USDC on Solana',
    hint: 'Pay with any Solana wallet',
  },
} as const;
