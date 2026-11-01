# agentsbackoffice.com

The public website of Agents Back Office, a transaction-coordination service for
Oklahoma real-estate agents. Static HTML served by GitHub Pages on the custom
domain `agentsbackoffice.com` (the `CNAME` file). Everything in this repository
is public: no credentials, no client data, no form contents beyond what the
site shows.

Deploy: push to `main`; Pages publishes the root. DNS at the registrar points
the apex A records at GitHub Pages and `www` CNAME at `zygiel.github.io`.

Working notes and the product itself live in a separate, private repository.

## drafts/

Pages not yet published. `drafts/index_full.html` is the full first draft of the landing page, held until pricing and contact details are settled.

## Pages (2026-11-01)

- `/` coming-soon page with a sign-in button only (owner: nothing explained to the public yet); the descriptive version is served at `/preview.html` to signed-in accounts only (a client-side guard; the HTML itself is public like everything in this repo) and kept in `drafts/index_portal_preview.html`.
- `/login/` sign in, invite and reset links land here (Supabase site_url); sets the password, enrols the authenticator app, verifies the code.
- `/app/` the agent portal: Transactions (Open/All, detail with packet versions), Clients (Active / 6 months / 1 year / All, CSV export behind a fresh authenticator code), Profile (fills packets; change history kept server-side), Feedback.
- `/admin/` back office: packet queue, all transactions, users (invite, role, two-factor override, disable, reset link, change history), feedback, audit log.
- `assets/abo.js` holds the Supabase project URL and publishable key (public by design; row-level security protects the data) and the shared helpers.
