import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { resetPassword, confirmResetPassword } from "aws-amplify/auth";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const requestSchema = z.object({ email: z.string().email("Enter a valid email") });
const confirmSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
    newPassword: z
      .string()
      .min(8, "Min 8 characters")
      .regex(/[A-Z]/, "Must include an uppercase letter")
      .regex(/[0-9]/, "Must include a number")
      .regex(/[^A-Za-z0-9]/, "Must include a special character"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export function ForgotPasswordPage() {
  const nav = useNavigate();
  const [step, setStep] = useState<"email" | "confirm">("email");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqForm = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: "" },
  });
  const confForm = useForm<z.infer<typeof confirmSchema>>({
    resolver: zodResolver(confirmSchema),
    defaultValues: { code: "", newPassword: "", confirmPassword: "" },
  });

  async function onRequest(values: z.infer<typeof requestSchema>) {
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ username: values.email });
      setEmail(values.email);
      setStep("confirm");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function onConfirm(values: z.infer<typeof confirmSchema>) {
    setError(null);
    setSubmitting(true);
    try {
      await confirmResetPassword({
        username: email,
        confirmationCode: values.code,
        newPassword: values.newPassword,
      });
      nav("/sign-in", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Reset password</CardTitle>
          <CardDescription>
            {step === "email"
              ? "Enter the email on your account and we'll send a verification code."
              : `We emailed a code to ${email}. Enter it below with your new password.`}
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

          {step === "email" && (
            <form onSubmit={reqForm.handleSubmit(onRequest)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoFocus
                  autoComplete="email"
                  {...reqForm.register("email")}
                />
                {reqForm.formState.errors.email && (
                  <p className="text-xs text-destructive">
                    {reqForm.formState.errors.email.message}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send code
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <Link to="/sign-in" className="underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}

          {step === "confirm" && (
            <form onSubmit={confForm.handleSubmit(onConfirm)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  {...confForm.register("code")}
                />
                {confForm.formState.errors.code && (
                  <p className="text-xs text-destructive">
                    {confForm.formState.errors.code.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  {...confForm.register("newPassword")}
                />
                {confForm.formState.errors.newPassword && (
                  <p className="text-xs text-destructive">
                    {confForm.formState.errors.newPassword.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...confForm.register("confirmPassword")}
                />
                {confForm.formState.errors.confirmPassword && (
                  <p className="text-xs text-destructive">
                    {confForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Reset password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
