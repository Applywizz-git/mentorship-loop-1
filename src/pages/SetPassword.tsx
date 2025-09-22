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

  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  // Parse helpers (for code and mentorId)
  function getQueryParam(name: string) {
    return new URLSearchParams(location.search).get(name);
  }

  // 1) Establish a session from the email link and CLAIM mentor row
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // Extract mentorId and code from query params
        const mentorId = getQueryParam("mentorId");
        const code = getQueryParam("code");
        const expiresAt = getQueryParam("expiresAt");

        if (!mentorId || !code) {
          toast({
            title: "Error",
            description: "Invalid link. Please request a new one.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }

        // Check if link has expired
        if (expiresAt && new Date() > new Date(expiresAt)) {
          toast({
            title: "Error",
            description: "This link has expired.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }

        // Use the code to establish the session with Supabase
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;

        // Validate mentorId
        const { data: mentorData, error: mentorError } = await supabase
          .from('mentors')
          .select('id')
          .eq('id', mentorId)
          .single();
        
        if (mentorError || !mentorData) {
          toast({
            title: "Error",
            description: "Mentor not found or invalid link.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }

        setLoading(false);
      } catch (e: any) {
        toast({
          title: "Session error",
          description: e?.message ?? "Could not verify your link. Please click the email link again.",
          variant: "destructive",
        });
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = useMemo(
    () => pw.length >= 8 && pw === confirm,
    [pw, confirm]
  );

  // 2) Update password, then go DIRECTLY to Mentor Dashboard
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      setUpdating(true);

      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;

      toast({
        title: "Password created successfully",
        description: "Welcome! Taking you to your mentor dashboard.",
      });

      // Optional: small wait so toast appears before route change
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
