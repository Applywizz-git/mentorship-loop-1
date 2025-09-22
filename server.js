
 
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
 
const app = express();
app.use(express.json({ limit: "5mb" })); // <- make sure large HTML is allowed
app.use(cors());
 
// ------------------ REPLACE WITH YOUR VALUES ------------------
const TENANT_ID = 'dd60b066-1b78-4515-84fb-a565c251cb5a';
const CLIENT_ID = '4116ded8-f37d-4a78-9134-25a39e91bb41';
const CLIENT_SECRET = 'R_c8Q~XSSWy2Tk5GkRbkSURzW1zgKIjI1mjVfcS8';
const SENDER_EMAIL = 'support@applywizz.com';
// -------------------------------------------------------------
 
// Get OAuth2 token from Microsoft
async function getAccessToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('client_id', CLIENT_ID);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('client_secret', CLIENT_SECRET);
  params.append('grant_type', 'client_credentials');
 
  const response = await fetch(url, { method: 'POST', body: params });
  const data = await response.json();
 
  if (!response.ok) {
    throw new Error(`Failed to get access token: ${JSON.stringify(data)}`);
  }
 
  return data.access_token;
}
 
// Function to send HTML email
async function sendEmail(to, subject, htmlBody) {
  const token = await getAccessToken();
 
  // Prepare the Graph API payload
  const payload = {
    message: {
      subject: subject,
      body: {
        contentType: "HTML", // must be string "HTML"
        content: htmlBody,   // HTML as a single string
      },
      toRecipients: [
        { emailAddress: { address: to } }
      ]
    }
  };
 
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER_EMAIL}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
 
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to send email: ${errorText}`);
  }
}
 
// Route to send email
app.post('/api/send-email', async (req, res) => {
  const { to, subject, htmlBody } = req.body;
 
  if (!to || !subject || !htmlBody) {
    return res.status(400).json({ error: "to, subject, and htmlBody are required" });
  }
 
  try {
    await sendEmail(to, subject, htmlBody);
    res.json({ message: 'Email sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
 
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
 
 