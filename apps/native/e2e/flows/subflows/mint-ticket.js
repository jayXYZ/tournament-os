// Asks the runner (e2e/run.mjs) for a fresh single-use Clerk sign-in ticket.
const response = http.post(TICKET_URL, { body: "" });
if (!response.ok) {
  throw new Error(`Ticket server answered ${response.status}`);
}
output.ticket = json(response.body).ticket;
