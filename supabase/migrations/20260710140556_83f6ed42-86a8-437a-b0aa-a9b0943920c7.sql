
-- Delete duplicate pending/overdue expected payments, keeping the oldest.
DELETE FROM public.expected_payments a
USING public.expected_payments b
WHERE a.status IN ('pending','overdue')
  AND b.status IN ('pending','overdue')
  AND a.user_id = b.user_id
  AND lower(a.client_name) = lower(b.client_name)
  AND a.expected_date = b.expected_date
  AND a.expected_amount = b.expected_amount
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS expected_payments_unique_pending
  ON public.expected_payments (user_id, lower(client_name), expected_date, expected_amount)
  WHERE status IN ('pending', 'overdue');
