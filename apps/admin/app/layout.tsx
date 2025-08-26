export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ padding: 20 }}>
          <h1>AI Voice Therapist — Admin</h1>
          <p style={{ color:"#666" }}>Simple dashboard (protect behind a reverse proxy basic auth).</p>
          <hr />
          {children}
        </div>
      </body>
    </html>
  );
}
