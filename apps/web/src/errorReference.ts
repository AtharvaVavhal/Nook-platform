/**
 * The API puts a request id on every response (X-Request-Id) and the same id in its log. When a call fails on the
 * server (5xx) the message shown to the user carries that id, so a support request can quote it and the matching log
 * line can be found straight away. Nothing else from a server error is ever shown.
 */
export function serverFailureMessage(
  status: number,
  requestId: string | null | undefined,
): string | null {
  if (status < 500) return null;
  const reference =
    requestId && /^[0-9a-f-]{36}$/i.test(requestId) ? ` Reference: ${requestId}` : '';
  return `Something went wrong on our side. Please try again.${reference}`;
}
