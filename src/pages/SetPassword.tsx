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
  const [mentorId, setMentorId] = useState<string>("");

  function getQueryParam(name: string) {
    return new URLSearchParams(location.search).get(name);
  }

  useEffect(() => {
    const mentorIdFromUrl = getQueryParam("mentorId");
    const emailFromUrl = getQueryParam("email");

    console.log('Params from URL:', { mentorIdFromUrl, emailFromUrl });

    if (!mentorIdFromUrl || !emailFromUrl) {
      toast({
        title: "Error",
        description: "Invalid invitation link. Please request a new one.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setMentorId(mentorIdFromUrl);
    setEmail(emailFromUrl);
    
    // Verify the mentor exists and is approved
    const verifyMentor = async () => {
      try {
        const { data: mentorData, error } = await supabase
          .from("mentors")
          .select("id, applicant_email, status")
          .eq("id", mentorIdFromUrl)
          .single();

        if (error || !mentorData) {
          throw new Error("Mentor not found");
        }

        if (mentorData.status !== "approved") {
          throw new Error("Mentor account is not approved yet");
        }

        // Verify email matches
        if (mentorData.applicant_email !== emailFromUrl) {
          throw new Error("Email does not match mentor records");
        }

        setLoading(false);
      } catch (error: any) {
        console.error('Error verifying mentor:', error);
        toast({
          title: "Invalid Link",
          description: error.message || "This invitation link is invalid or expired.",
          variant: "destructive",
        });
        setLoading(false);
      }
    };

    verifyMentor();
  }, [location.search]);

  const canSubmit = useMemo(
    () => pw.length >= 8 && pw === confirm && !!email,
    [pw, confirm, email]
  );

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !email || !mentorId) return;

    try {
      setUpdating(true);

      // SIMPLE APPROACH: Just create the account using Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: pw,
        options: {
          data: {
            mentor_id: mentorId,
            user_type: 'mentor'
          },
          // Optional: Redirect after email confirmation
          emailRedirectTo: `${window.location.origin}/dashboard/mentor`
        }
      });

      if (error) {
        // If user already exists, try signing them in
        if (error.message.includes('already registered')) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: email,
            password: pw,
          });

          if (signInError) {
            // If sign in fails, guide user to reset password
            toast({
              title: "Account Exists",
              description: "An account with this email already exists. Please sign in or reset your password.",
              variant: "destructive",
            });
            return;
          }

          // Sign in successful - redirect to dashboard
          toast({
            title: "Welcome back!",
            description: "Taking you to your dashboard.",
          });
          
          setTimeout(() => {
            navigate("/dashboard/mentor", { replace: true });
          }, 1500);
          return;
        }
        throw error;
      }

      if (data.user) {
        // Update mentor record with the user_id
        const { error: updateError } = await supabase
          .from("mentors")
          .update({ user_id: data.user.id })
          .eq("id", mentorId);

        if (updateError) {
          console.error("Failed to update mentor with user_id:", updateError);
        }

        toast({
          title: "Account created successfully!",
          description: "Welcome to your mentor dashboard.",
        });

        // Redirect to dashboard
        setTimeout(() => {
          navigate("/dashboard/mentor", { replace: true });
        }, 1500);
      } else {
        // Email confirmation required
        toast({
          title: "Check your email",
          description: "We've sent you a confirmation link. Please check your email.",
        });
      }

    } catch (error: any) {
      console.error('Account creation error:', error);
      toast({
        title: "Error creating account",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-6 py-10">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Verifying your invitation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Create Your Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input value={email} readOnly className="bg-muted" />
            </div>
            
            <div>
              <Label>Create Password</Label>
              <Input
                type="password"
                placeholder="At least 8 characters"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                minLength={8}
                required
              />
            </div>
            
            <div>
              <Label>Confirm Password</Label>
              <Input
                type="password"
                placeholder="Confirm your password"
                value={confirm}
                onChange={(e) => setConfirm(e.value)}
                minLength={8}
                required
              />
            </div>
            
            {pw && confirm && pw !== confirm && (
              <p className="text-sm text-destructive">Passwords do not match</p>
            )}
            
            <Button 
              type="submit" 
              className="w-full" 
              disabled={!canSubmit || updating}
            >
              {updating ? "Creating your account..." : "Create Account & Continue"}
            </Button>
            
            <p className="text-xs text-muted-foreground text-center">
              You'll be redirected to your mentor dashboard after account creation.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
