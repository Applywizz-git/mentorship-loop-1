import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

// Create a service role client for admin operations
const supabaseAdmin = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY // Make sure this is in your .env
);

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

    console.log('🔍 DEBUG - URL Params:', { mentorIdFromUrl, emailFromUrl });

    if (!mentorIdFromUrl || !emailFromUrl) {
      toast({
        title: "Invalid Link",
        description: "Missing required parameters in the invitation link.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setMentorId(mentorIdFromUrl);
    setEmail(emailFromUrl);

    const verifyMentor = async () => {
      try {
        console.log('🔍 DEBUG - Verifying mentor with ID:', mentorIdFromUrl);
        
        // Use the service role client for database access
        const { data: mentorData, error } = await supabaseAdmin
          .from("mentors")
          .select("id, applicant_email, name, applicant_status") // Use correct column names
          .eq("id", mentorIdFromUrl)
          .single();

        console.log('🔍 DEBUG - Query result:', { mentorData, error });

        if (error) {
          console.error('❌ DEBUG - Database error:', error);
          
          // Try with regular client as fallback
          const { data: fallbackData, error: fallbackError } = await supabase
            .from("mentors")
            .select("id, applicant_email, applicant_status")
            .eq("id", mentorIdFromUrl)
            .single();
            
          if (fallbackError || !fallbackData) {
            throw new Error(`Mentor with ID "${mentorIdFromUrl}" not found. Please contact support.`);
          }
          
          // Use fallback data
          if (fallbackData.applicant_status !== "approved") {
            throw new Error("Your mentor account is not approved yet.");
          }
          
          if (fallbackData.applicant_email !== emailFromUrl) {
            throw new Error("Email does not match mentor records.");
          }
          
          setLoading(false);
          return;
        }

        if (!mentorData) {
          throw new Error("Mentor record not found in the database.");
        }

        // Check if mentor is approved - use applicant_status
        if (mentorData.applicant_status !== "approved") {
          throw new Error(`Your mentor account status is "${mentorData.applicant_status}" but needs to be "approved".`);
        }

        // Verify email matches - use applicant_email
        if (mentorData.applicant_email !== emailFromUrl) {
          throw new Error("The email in this link does not match the mentor's registered email.");
        }

        console.log('✅ DEBUG - Mentor verification successful');
        setLoading(false);

      } catch (error: any) {
        console.error('❌ DEBUG - Verification failed:', error);
        toast({
          title: "Invalid Invitation Link",
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
      console.log('🔍 DEBUG - Creating account for:', email);

      // Use the regular client for auth operations (sign up)
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: pw,
        options: {
          data: {
            mentor_id: mentorId,
            user_type: 'mentor'
          }
        }
      });

      if (error) {
        console.error('❌ DEBUG - Auth error:', error);
        
        if (error.message.includes('already registered')) {
          // Try to sign in
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: email,
            password: pw,
          });

          if (signInError) {
            throw new Error("An account with this email already exists. Please sign in or use password reset.");
          }

          // Sign in successful - update mentor record with user_id
          const { data: userData } = await supabase.auth.getUser();
          if (userData.user) {
            await supabaseAdmin
              .from("mentors")
              .update({ user_id: userData.user.id })
              .eq("id", mentorId);
          }

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
        console.log('✅ DEBUG - Account created, user ID:', data.user.id);
        
        // Update mentor record with user_id using admin client
        const { error: updateError } = await supabaseAdmin
          .from("mentors")
          .update({ user_id: data.user.id })
          .eq("id", mentorId);

        if (updateError) {
          console.error('⚠️ DEBUG - Failed to update mentor record:', updateError);
        }

        toast({
          title: "Account created successfully!",
          description: "Welcome to your mentor dashboard.",
        });

        setTimeout(() => {
          navigate("/dashboard/mentor", { replace: true });
        }, 1500);
      }

    } catch (error: any) {
      console.error('❌ DEBUG - Account creation failed:', error);
      toast({
        title: "Error creating account",
        description: error.message || "Please try again or contact support.",
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
              <p className="text-sm text-muted-foreground">Verifying your invitation link...</p>
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
          <CardTitle>Create Your Mentor Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <div>
              <Label>Email Address</Label>
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
                onChange={(e) => setConfirm(e.target.value)}
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
              {updating ? "Creating Account..." : "Create Account & Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
