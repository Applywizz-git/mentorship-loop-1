// src/pages/SetPassword.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export default function SetPassword() {
  const location = useLocation();
  const navigate = useNavigate();

  const [email, setEmail] = useState<string>("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  // Parse helpers (support code param and hash tokens)
  function getQueryParam(name: string) {
    return new URLSearchParams(location.search).get(name);
  }

  // 1) Extract mentorId and validate it
  useEffect(() => {
    const mentorIdFromUrl = getQueryParam("mentorId");

    console.log("mentorId from URL:", mentorIdFromUrl);

    if (!mentorIdFromUrl) {
      toast({
        title: "Error",
        description: "Invalid link. Please request a new one.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // 2) Validate the mentorId by checking if it exists in the database and get the mentor's email
    const verifyMentorId = async () => {
      const { data, error } = await supabase
        .from("mentors")
        .select("id, applicant_email") // Select necessary fields for validation
        .eq("id", mentorIdFromUrl) // Match mentorId in the database
        .single();

      if (error || !data) {
        console.error(`Error fetching mentor: ${error?.message || "Mentor not found"}`);
        toast({
          title: "Error",
          description: "Mentor not found or invalid link.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Use mentor's email
      const mentorEmail = data.applicant_email;
      setEmail(mentorEmail); // Set the mentor's email for the form
      setLoading(false);
    };

    verifyMentorId();
  }, [location.search]);

  const canSubmit = useMemo(
    () => pw.length >= 8 && pw === confirm && !!email,
    [pw, confirm, email]
  );

  // 2) Handle password update after mentor authentication
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      setUpdating(true);

      // Check if user already exists
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: pw,
      });

      if (error) {
        console.error("Error creating user:", error.message);
        toast({
          title: "Error",
          description: "Could not create user.",
          variant: "destructive",
        });
        setUpdating(false);
        return;
      }

      // After creating the user, auto-login them
      const { data: signInData, error: signInError } = await supabase.auth.signIn({
        email: email,
        password: pw, // Use the password the mentor just created
      });

      if (signInError) {
        console.error("Error signing in mentor:", signInError.message);
        toast({
          title: "Error",
          description: signInError.message ?? "Could not log in.",
          variant: "destructive",
        });
        setUpdating(false);
        return;
      }

      toast({
        title: "Password created successfully",
        description: "Welcome! Taking you to your mentor dashboard.",
      });

      setTimeout(() => {
        navigate("/dashboard/mentor", { replace: true });
      }, 150);
    } catch (e: any) {
      toast({
        title: "Could not set password",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <>
      <div className="max-w-md mx-auto px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Set Your Password</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Preparing your account…</p>
            ) : (
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div>
                  <Label>Email</Label>
                  <Input value={email} readOnly />
                </div>
                <div>
                  <Label>Create Password</Label>
                  <Input
                    type="password"
                    placeholder="At least 8 characters"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={!canSubmit || updating}>
                  {updating ? "Saving…" : "Save & Continue"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  After saving, you’ll be redirected straight to your mentor dashboard.
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
