import { Badge } from '@/components/ui/badge';
import { ORDER_STATUS_META, PAYMENT_STATUS_META } from '@/lib/constants';
import type { OrderStatus, PaymentStatus } from '@/lib/types';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const meta = PAYMENT_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
