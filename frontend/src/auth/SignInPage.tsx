import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn, confirmSignIn } from "aws-amplify/auth";
import { AlertCircle, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth-store";
import { env } from "@/lib/env";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

const mfaSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

/**
 * Sign-in flow. Supports the three Cognito outcomes:
 *   1. Direct sign-in success → redirect to the originally-requested URL.
 *   2. SMS / TOTP MFA challenge → show the code entry step.
 *   3. NEW_PASSWORD_REQUIRED → show a reset step (first-time admin invite).
 *
 * On success, we call `useAuthStore.refresh()` so groups + role land in the
 * store before the redirect fires.
 */
export function SignInPage() {
  const nav = useNavigate();
  const location = useLocation();
  const refresh = useAuthStore((s) => s.refresh);
  const [step, setStep] = useState<"credentials" | "mfa" | "new-password">("credentials");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const mfaForm = useForm<z.infer<typeof mfaSchema>>({
    resolver: zodResolver(mfaSchema),
    defaultValues: { code: "" },
  });

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";

  async function onCredentials(values: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await signIn({ username: values.email, password: values.password });
      switch (res.nextStep.signInStep) {
        case "DONE":
          await refresh();
          nav(from, { replace: true });
          break;
        case "CONFIRM_SIGN_IN_WITH_SMS_CODE":
        case "CONFIRM_SIGN_IN_WITH_TOTP_CODE":
          setStep("mfa");
          break;
        case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
          setStep("new-password");
          break;
        default:
          setError(`Unsupported sign-in step: ${res.nextStep.signInStep}`);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onMfa({ code }: { code: string }) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await confirmSignIn({ challengeResponse: code });
      if (res.nextStep.signInStep === "DONE") {
        await refresh();
        nav(from, { replace: true });
      } else {
        setError(`Unexpected MFA step: ${res.nextStep.signInStep}`);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            {env.companyLogoUrl ? (
              <img src={env.companyLogoUrl} alt="" className="h-6 w-6 rounded" />
            ) : null}
            <span>{env.companyName}</span>
          </div>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            {step === "credentials"
              ? "Enter your work email and password to continue."
              : step === "mfa"
                ? "Enter the 6-digit code from your authenticator app or SMS."
                : "Your account requires a new password on first sign-in."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div
              role="alert"
              className="mb-4 flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : null}

          {step === "credentials" && (
            <form onSubmit={form.handleSubmit(onCredentials)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  {...form.register("email")}
                  aria-invalid={Boolean(form.formState.errors.email)}
                />
                {form.formState.errors.email && (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...form.register("password")}
                  aria-invalid={Boolean(form.formState.errors.password)}
                />
                {form.formState.errors.password && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.password.message}
                  </p>
                )}
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn />}
                {submitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          )}

          {step === "mfa" && (
            <form onSubmit={mfaForm.handleSubmit(onMfa)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  placeholder="123456"
                  {...mfaForm.register("code")}
                />
                {mfaForm.formState.errors.code && (
                  <p className="text-xs text-destructive">
                    {mfaForm.formState.errors.code.message}
                  </p>
                )}
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Verify code
              </Button>
            </form>
          )}

          {step === "new-password" && (
            <p className="text-sm text-muted-foreground">
              Your administrator has invited you. Sign out of any old sessions and use the
              temporary password from the invitation email, then you&apos;ll be prompted for a new
              one on the next step. (Full reset flow:{" "}
              <Link to="/forgot-password" className="underline">
                forgot password
              </Link>
              .)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/NotAuthorizedException|Incorrect username/i.test(msg)) {
    return "Incorrect email or password.";
  }
  if (/UserNotFoundException/i.test(msg)) {
    return "No account found for this email.";
  }
  if (/CodeMismatchException/i.test(msg)) {
    return "Invalid verification code.";
  }
  if (/PasswordResetRequiredException/i.test(msg)) {
    return "Password reset required. Please use “Forgot password”.";
  }
  if (/UserNotConfirmedException/i.test(msg)) {
    return "Account is not yet verified. Check your email for the verification code.";
  }
  return msg.replace(/^[A-Z][a-zA-Z]+Exception:\s*/, "");
}
