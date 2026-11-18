// The sign-in page. Works without JavaScript: the form posts to /api/login.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authEnabled, readSession, safeNext, SESSION_COOKIE } from "../../lib/auth.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in - ClaimShield" };

const MESSAGES = {
  "1": "That username and password did not match. Check them and try again.",
  locked: "Too many attempts from this network. Wait 15 minutes, then try again.",
  config: "Sign-in is not set up on the server yet: STATE_SECRET is missing. Ask the project team to add it in Vercel.",
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = safeNext(params?.next);
  if (!authEnabled()) redirect("/");
  if (await readSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);
  const error = MESSAGES[params?.error];

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">CS</span>
          <div>
            <p className="brand-name">ClaimShield</p>
            <p className="brand-line">Your claim, argued by the rulebook</p>
          </div>
        </div>
        <h1>Sign in</h1>
        <p className="hint">This course project is open to invited reviewers. Ask the project team for the username and password.</p>
        {error && <p className="login-error" role="alert">{error}</p>}
        {params?.signed_out && !error && <p className="login-note" role="status">You have signed out.</p>}
        <form method="post" action="/api/login" className="login-form">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="username">Username</label>
          <input id="username" name="username" type="text" autoComplete="username" required autoFocus />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button type="submit" className="primary">Sign in</button>
        </form>
      </div>
    </main>
  );
}
