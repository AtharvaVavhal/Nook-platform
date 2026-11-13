-- Transfer-only receipts: committed in the same transaction as the immutable transfer.
-- Bind the receipt to the exact organization, actor and key on the Transfer event.
ALTER TABLE transfers ADD CONSTRAINT transfers_receipt_identity_key
  UNIQUE (id, organization_id, actor_user_id, idempotency_key);

CREATE TABLE transfer_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  transfer_id uuid NOT NULL UNIQUE,
  request_check text NOT NULL CHECK (request_check ~ '^[0-9a-f]{64}$'),
  response_body jsonb NOT NULL,
  response_version integer NOT NULL DEFAULT 1 CHECK (response_version = 1),
  recorded_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT transfer_command_receipts_identity_key UNIQUE (transfer_id, organization_id, actor_id, idempotency_key),
  CONSTRAINT transfer_command_receipts_key UNIQUE (organization_id, actor_id, idempotency_key),
  CONSTRAINT transfer_command_receipts_event_fkey
    FOREIGN KEY (transfer_id, organization_id, actor_id, idempotency_key)
    REFERENCES transfers(id, organization_id, actor_user_id, idempotency_key)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transfer_command_receipts_response_check
    CHECK (jsonb_typeof(response_body) = 'object' AND
           COALESCE(response_body->>'id' = transfer_id::text, false))
);
CREATE FUNCTION transfer_command_receipts_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'transfer command receipts are append-only' USING ERRCODE = '23001';
END;
$$;
CREATE TRIGGER transfer_command_receipts_immutable
  BEFORE UPDATE OR DELETE ON transfer_command_receipts
  FOR EACH ROW EXECUTE FUNCTION transfer_command_receipts_immutable();
