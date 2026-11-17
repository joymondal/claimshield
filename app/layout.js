import "./globals.css";

export const metadata = {
  title: "ClaimShield - your claim, argued by the rulebook",
  description: "An AI-assisted drafting tool that checks a rejected health-insurance claim against the policy wording and IRDAI rules, then drafts a grievance letter for the policyholder to approve and send. Course project; synthetic data only.",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
