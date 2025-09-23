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
      .select("id, applicant_email, name, application_status, user_id")
      .eq("id", mentorIdFromUrl)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error(`Mentor invitation not found or already used.`);
      }
      throw new Error(`Database error: ${error.message}`);
    }

    if (!mentorData) {
      throw new Error("Mentor record not found");
    }

    // Check if already linked to a user
    if (mentorData.user_id) {
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("email")
        .eq("user_id", mentorData.user_id)
        .single();

      if (existingProfile) {
        throw new Error(`This mentor invitation has already been used by ${existingProfile.email}. Please contact support if this is an error.`);
      }
    }

    if (mentorData.application_status !== "approved") {
      throw new Error("Mentor application has not been approved yet.");
    }

    if (mentorData.applicant_email !== emailFromUrl) {
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

    // Step 1: Verify mentor record is still valid and get details
    const { data: mentorData, error: mentorError } = await supabase
      .from("mentors")
      .select("id, name, applicant_email, user_id, application_status")
      .eq("id", mentorId)
      .single();

    if (mentorError || !mentorData) {
      throw new Error("Mentor record not found or invalid");
    }

    if (mentorData.application_status !== "approved") {
      throw new Error("Mentor application is not approved");
    }

    if (mentorData.applicant_email !== email) {
      throw new Error("Email does not match mentor record");
    }

    // Step 2: Check if this user_id is already associated with another mentor
    if (mentorData.user_id) {
      const { data: existingUserMentor } = await supabase
        .from("mentors")
        .select("id, name, applicant_email")
        .eq("user_id", mentorData.user_id)
        .neq("id", mentorId)
        .maybeSingle();

      if (existingUserMentor) {
        throw new Error(
          `This user account is already associated with mentor "${existingUserMentor.name || existingUserMentor.applicant_email}". Please contact support.`
        );
      }
    }

    const mentorName = mentorData.name || 'New Mentor';

    // Step 3: Check if user already exists with this email
    const { data: existingUsers } = await supabase
      .from("profiles")
      .select("id, user_id, email, role")
      .eq("email", email)
      .maybeSingle();

    let userId: string;

    if (existingUsers) {
      console.log('🔍 DEBUG - User profile already exists:', existingUsers);
      
      // User exists, check if they're already a mentor
      if (existingUsers.role === 'mentor') {
        // Check if this mentor record is already linked to another user
        if (mentorData.user_id && mentorData.user_id !== existingUsers.user_id) {
          throw new Error(
            `This mentor record is already associated with a different user account. Please contact support.`
          );
        }
        
        // Check if user is already linked to another mentor
        const { data: userMentor } = await supabase
          .from("mentors")
          .select("id, name")
          .eq("user_id", existingUsers.user_id)
          .neq("id", mentorId)
          .maybeSingle();

        if (userMentor) {
          throw new Error(
            `Your account is already associated with mentor "${userMentor.name || 'another mentor'}". Please contact support.`
          );
        }
      }

      userId = existingUsers.user_id;
      
      // Sign in the existing user
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email,
        password: pw,
      });

      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          throw new Error("An account with this email already exists. Please use the correct password or reset it.");
        }
        throw signInError;
      }

      // Update profile to ensure mentor role
      const { error: profileUpdateError } = await supabase
        .from('profiles')
        .update({ 
          role: 'mentor',
          updated_at: new Date().toISOString()
        })
        .eq('id', existingUsers.id);

      if (profileUpdateError) {
        console.error('❌ DEBUG - Profile update error:', profileUpdateError);
      }

    } else {
      // Create new user account
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

      if (authError) throw authError;
      if (!authData.user) throw new Error("Failed to create user account");

      userId = authData.user.id;

      // Create mentor profile
      await createProfile(userId, email, mentorName);
    }

    // Step 4: Safely update mentor record with user_id
    const { error: updateMentorError } = await supabase
      .from("mentors")
      .update({ 
        user_id: userId,
        profile_id: userId, // Ensure profile_id is also set
        updated_at: new Date().toISOString()
      })
      .eq("id", mentorId)
      .is('user_id', null); // Only update if user_id is currently null

    if (updateMentorError) {
      if (updateMentorError.code === '23505') {
        // Unique constraint violation - user_id already exists elsewhere
        const { data: conflictingMentor } = await supabase
          .from("mentors")
          .select("id, name, applicant_email")
          .eq("user_id", userId)
          .single();

        throw new Error(
          `This user account is already associated with mentor "${conflictingMentor?.name || conflictingMentor?.applicant_email || 'another mentor'}". Please contact support.`
        );
      }
      console.warn('⚠️ DEBUG - Mentor update warning (may be already linked):', updateMentorError);
    }

    toast({
      title: "Success!",
      description: existingUsers ? "Welcome back to your mentor account!" : "Mentor account created successfully!",
    });

    setTimeout(() => {
      navigate("/dashboard/mentor", { replace: true });
    }, 1500);

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
