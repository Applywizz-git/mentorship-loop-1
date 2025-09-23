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
        
        const { data: mentorData, error } = await supabase
          .from("mentors")
          .select("id, applicant_email, name, application_status")
          .eq("id", mentorIdFromUrl)
          .single();

        console.log('🔍 DEBUG - Query result:', { mentorData, error });

        if (error) {
          console.error('❌ DEBUG - Mentor query error:', error);
          if (error.code === 'PGRST116') {
            throw new Error(`Mentor with ID "${mentorIdFromUrl}" not found in the database.`);
          }
          throw new Error(`Database error: ${error.message}`);
        }

        if (!mentorData) {
          throw new Error("Mentor record not found");
        }

        console.log('✅ DEBUG - Mentor found:', mentorData);

        if (mentorData.application_status !== "approved") {
          throw new Error(`Mentor account status is "${mentorData.application_status}" but needs to be "approved"`);
        }

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

  // UPDATED: Create profile with proper column names and role enforcement
  const createProfile = async (userId: string, userEmail: string, mentorName?: string) => {
    try {
      console.log('🔍 DEBUG - Creating/updating mentor profile for user:', userId);
      
      const profileData = {
        id: userId,
        user_id: userId,
        email: userEmail,
        name: mentorName || 'New Mentor',
        role: 'mentor', // ENSURED: This will always be 'mentor'
        verified: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      console.log('🔍 DEBUG - Profile data (ensuring mentor role):', profileData);

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(profileData, {
          onConflict: 'id',
          ignoreDuplicates: false
        });

      if (profileError) {
        console.error('❌ DEBUG - Profile creation error:', profileError);
        throw new Error(`Failed to create profile: ${profileError.message}`);
      }

      console.log('✅ DEBUG - Mentor profile created/updated successfully');
      return true;

    } catch (error) {
      console.error('❌ DEBUG - Profile creation failed:', error);
      throw error;
    }
  };

  // NEW: Add profile verification function
  const verifyProfileRole = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, name, email')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('❌ DEBUG - Profile verification error:', error);
        return false;
      }

      console.log('🔍 DEBUG - Profile verification result:', profile);
      
      if (profile.role !== 'mentor') {
        console.warn('⚠️ DEBUG - Profile has incorrect role, updating to mentor');
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ role: 'mentor', updated_at: new Date().toISOString() })
          .eq('id', userId);

        if (updateError) {
          console.error('❌ DEBUG - Role update error:', updateError);
          return false;
        }
        console.log('✅ DEBUG - Role updated to mentor successfully');
      }

      return true;
    } catch (error) {
      console.error('❌ DEBUG - Role verification failed:', error);
      return false;
    }
  };

  // Get mentor name for profile
  const getMentorName = async (mentorId: string) => {
    try {
      const { data, error } = await supabase
        .from('mentors')
        .select('name')
        .eq('id', mentorId)
        .single();
      
      if (error) {
        console.warn('⚠️ DEBUG - Could not fetch mentor name:', error);
        return '';
      }
      
      return data?.name || '';
    } catch (error) {
      console.warn('⚠️ DEBUG - Error fetching mentor name:', error);
      return '';
    }
  };

  // UPDATED: handleCreateAccount with role enforcement
async function handleCreateAccount(e: React.FormEvent) {
  e.preventDefault();
  if (!canSubmit || !email || !mentorId) return;

  try {
    setUpdating(true);
    console.log('🔍 DEBUG - Starting account creation for:', { email, mentorId });

    const mentorName = await getMentorName(mentorId);

    // Step 1: Sign up the user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email,
      password: pw,
      options: {
        data: {
          mentor_id: mentorId,
          user_type: 'mentor',
          full_name: mentorName
        },
        emailRedirectTo: `${window.location.origin}/dashboard/mentor`
      }
    });

    if (authError) {
      console.error('❌ DEBUG - Auth error:', authError);
      
      if (authError.message.includes('already registered')) {
        console.log('🔍 DEBUG - User exists, attempting sign in');
        
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: email,
          password: pw,
        });

        if (signInError) {
          throw new Error("An account with this email already exists. Please use the password reset feature if you forgot your password.");
        }

        if (signInData.user) {
          console.log('🔍 DEBUG - User signed in, ensuring mentor profile:', signInData.user.id);
          
          await createProfile(signInData.user.id, email, mentorName);
          await verifyProfileRole(signInData.user.id);
          
          // DEBUG: Check if mentor record already has a user_id
          const { data: existingMentor } = await supabase
            .from("mentors")
            .select("user_id, id, name, applicant_email")
            .eq("user_id", signInData.user.id)
            .maybeSingle();

          console.log('🔍 DEBUG - Existing mentor with this user_id:', existingMentor);

          if (existingMentor) {
            if (existingMentor.id !== mentorId) {
              throw new Error(`This account is already associated with mentor "${existingMentor.name}" (${existingMentor.applicant_email}). Please contact support.`);
            } else {
              console.log('✅ DEBUG - Mentor record already correctly linked');
            }
          } else {
            // Update mentor record with user_id (safe to do now)
            const { error: updateError } = await supabase
              .from("mentors")
              .update({ user_id: signInData.user.id })
              .eq("id", mentorId);

            if (updateError) {
              console.error('❌ DEBUG - Mentor update error:', updateError);
              if (updateError.code === '23505') {
                const { data: conflictingMentor } = await supabase
                  .from("mentors")
                  .select("id, name, applicant_email")
                  .eq("user_id", signInData.user.id)
                  .single();

                if (conflictingMentor) {
                  throw new Error(`This account is already linked to mentor "${conflictingMentor.name}". Please contact support.`);
                }
              }
              throw new Error(`Failed to link mentor account: ${updateError.message}`);
            }
            console.log('✅ DEBUG - Mentor record updated successfully');
          }
        }

        toast({
          title: "Welcome back!",
          description: "Successfully signed in to your mentor account.",
        });
        
        setTimeout(() => {
          navigate("/dashboard/mentor", { replace: true });
        }, 1500);
        return;
      }
      throw authError;
    }

    if (authData.user) {
      console.log('✅ DEBUG - Auth account created, user ID:', authData.user.id);
      
      await createProfile(authData.user.id, email, mentorName);
      await verifyProfileRole(authData.user.id);

      // FIXED: Properly check for existing mentor association
      const { data: existingMentor, error: existingMentorError } = await supabase
        .from("mentors")
        .select("id, name, applicant_email")
        .eq("user_id", authData.user.id)
        .maybeSingle();

      if (existingMentorError) {
        console.error('❌ DEBUG - Error checking existing mentor:', existingMentorError);
        // Continue with the update despite the query error
      } else if (existingMentor && existingMentor.id !== mentorId) {
        throw new Error(`This account is already associated with mentor "${existingMentor.name}" (${existingMentor.applicor_email}). Please contact support.`);
      }

      // Proceed with updating the mentor record
      const { error: updateError } = await supabase
        .from("mentors")
        .update({ 
          user_id: authData.user.id,
          application_status: 'approved'
        })
        .eq("id", mentorId);

      if (updateError) {
        console.error('❌ DEBUG - Mentor update error:', updateError);
        if (updateError.code === '23505') {
          const { data: conflictingMentor } = await supabase
            .from("mentors")
            .select("id, name, applicant_email")
            .eq("user_id", authData.user.id)
            .single();

          if (conflictingMentor) {
            throw new Error(`This account is already linked to mentor "${conflictingMentor.name}". Please contact support.`);
          }
        }
        throw new Error(`Failed to link mentor account: ${updateError.message}`);
      }

      console.log('✅ DEBUG - Mentor record updated successfully');

      toast({
        title: "Mentor account created successfully!",
        description: "Welcome to your mentor dashboard.",
      });

      setTimeout(() => {
        navigate("/dashboard/mentor", { replace: true });
      }, 2000);
    } else {
      throw new Error("Failed to create user account");
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
