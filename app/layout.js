import './globals.css';

export const metadata = {
  title: 'Nmyt — Ops & Finance',
  description: 'Invoicing, ledger, CRM, team and reports for Nmyt.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
