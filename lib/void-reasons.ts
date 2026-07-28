/**
 * Why a real, correctly mapped order line still should not count as a sale.
 *
 * Kept short on purpose: a long list means nobody picks the right one, and the
 * free-text note covers the rest. Shared by the imported orders list and the
 * individual order page so the two never drift apart.
 */
export const VOID_REASONS = [
  'Replacement sent',
  'Refund / cancelled',
  'Gift or sample',
  'Test order',
  'Wrong import',
  'Other',
]
