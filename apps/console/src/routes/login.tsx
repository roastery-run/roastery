import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { z } from "zod";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { authClient } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  // `.catch()` rather than a strict parse: a truncated or hand-edited link must
  // land on a working sign-in page, not a validation error.
  validateSearch: z.object({ next: z.string().catch("/").default("/") }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  const run = async (name: string, action: () => Promise<unknown>) => {
    setLoading(name);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <AuthShell>
      <LoginForm
        email={email}
        onEmailChange={(value) => {
          setEmail(value);
          setSent(false);
        }}
        loading={loading}
        error={error}
        sent={sent}
        onGitHub={() =>
          run("github", () => authClient.signIn.social({ provider: "github", callbackURL: next }))
        }
        onGoogle={() =>
          run("google", () => authClient.signIn.social({ provider: "google", callbackURL: next }))
        }
        onMagicLink={() =>
          run("email", async () => {
            const result = await authClient.signIn.magicLink({
              email: email.trim(),
              callbackURL: next,
            });
            if (result.error) throw new Error(result.error.message ?? "Could not send the link");
            setSent(true);
          })
        }
      />
      {/* Signed in already? The guard sends people here with `next`, so honour
          it once the session lands rather than stranding them on /login. */}
      <SessionRedirect to={next} onRedirect={(to) => navigate({ to, replace: true })} />
    </AuthShell>
  );
}

function SessionRedirect({ to, onRedirect }: { to: string; onRedirect: (to: string) => void }) {
  const { data } = authClient.useSession();
  React.useEffect(() => {
    if (data?.user) onRedirect(to);
  }, [data?.user, to, onRedirect]);
  return null;
}
