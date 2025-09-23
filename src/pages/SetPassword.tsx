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



    console.log('🔍 DEBUG - URL Params:', { 
      mentorIdFromUrl, 
      emailFromUrl,
      fullUrl: window.location.href,
      search: location.search 
    });



    if (!mentorIdFromUrl) {
      console.error('❌ DEBUG - Missing mentorId from URL');
      toast({
        title: "Invalid Link",
        description: "Missing mentor ID in the invitation link.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }



    if (!emailFromUrl) {
      console.error('❌ DEBUG - Missing email from URL');
      toast({
        title: "Invalid Link",
        description: "Missing email in the invitation link.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }



    setMentorId(mentorIdFromUrl);
    setEmail(emailFromUrl);



    const verifyMentor = async () => {
      try {
        console.log('🔍 DEBUG - Starting mentor verification for ID:', mentorIdFromUrl);
        
        // First, let's check if the mentors table exists and is accessible
        const { data: tableCheck, error: tableError } = await supabase
          .from("mentors")
          .select("count")
          .limit(1);



        if (tableError) {
          console.error('❌ DEBUG - Table access error:', tableError);
          throw new Error(`Cannot access mentors table: ${tableError.message}`);
        }



        console.log('✅ DEBUG - Mentors table is accessible');



        // Now query the specific mentor
        const { data: mentorData, error } = await supabase
          .from("mentors")
          .select("id, applicant_email, name, application_status")
          .eq("id", mentorIdFromUrl)
          .single();



        console.log('🔍 DEBUG - Query result:', { mentorData, error });



        if (error) {
          console.error('❌ DEBUG - Mentor query error:', error);
          if (error.code === 'PGRST116') { // No rows returned
            throw new Error(`Mentor with ID "${mentorIdFromUrl}" not found in the database.`);
          }
          throw new Error(`Database error: ${error.message}`);
        }



        if (!mentorData) {
          throw new Error("Mentor record not found");
        }



        console.log('✅ DEBUG - Mentor found:', mentorData);



        // Check if mentor is approved
        if (mentorData.application_status !== "approved") {
          throw new Error(`Mentor account status is "${mentorData.application_status}" but needs to be "approved"`);
        }



        // Verify email matches
        if (mentorData.applicant_email !== emailFromUrl) {
          console.warn('⚠️ DEBUG - Email mismatch:', {
            dbEmail: mentorData.applicant_email,
            urlEmail: emailFromUrl
          });
          throw new Error("Email in the link does not match the mentor's registered email.");
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
      console.log('🔍 DEBUG - Starting account creation for:', { email, mentorId });



      // Simple signup flow
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
        console.error('❌ DEBUG - Signup error:', error);
        
        if (error.message.includes('already registered')) {
          // Try to sign in instead
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: email,
            password: pw,
          });



          if (signInError) {
            throw new Error("An account with this email already exists. Please use the password reset feature if you forgot your password.");
          }



          // Sign in successful
          toast({
            title: "Welcome back!",
            description: "Successfully signed in to your account.",
          });
          
          setTimeout(() => {
            navigate("/dashboard/mentor", { replace: true });
          }, 1500);
          return;
        }
        throw error;
      }



      if (data.user) {
        console.log('✅ DEBUG - Account created successfully, user:', data.user.id);
        
        // Update mentor record with user_id
        const { error: updateError } = await supabase
          .from("mentors")
          .update({ user_id: data.user.id })
          .eq("id", mentorId);



        if (updateError) {
          console.error('⚠️ DEBUG - Failed to update mentor record:', updateError);
          // Don't throw error - this is non-critical
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
              <Label htmlFor="email">Email Address</Label>
              <Input 
                id="email"
                type="email" 
                value={email} 
                readOnly 
                className="bg-muted" 
              />
              <p className="text-xs text-muted-foreground mt-1">
                This is the email associated with your mentor application
              </p>
            </div>
            
            <div>
              <Label htmlFor="password">Create Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                minLength={8}
                required
              />
            </div>
            
            <div>
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
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
            
            <p className="text-xs text-muted-foreground text-center">
              By creating an account, you'll gain access to your mentor dashboard.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
