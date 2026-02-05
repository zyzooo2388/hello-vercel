export default function Home() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(135deg, #f7d6e0 0%, #dbe7ff 45%, #e7f7e9 100%)",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: "#111827",
        padding: "24px",
      }}
    >
      <main
        style={{
          width: "min(680px, 100%)",
          background: "#ffffff",
          borderRadius: "20px",
          padding: "56px 48px",
          boxShadow:
            "0 20px 50px rgba(17, 24, 39, 0.12), 0 6px 16px rgba(17, 24, 39, 0.08)",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "40px",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Hello World
        </h1>
        <p
          style={{
            margin: "16px 0 0",
            fontSize: "18px",
            color: "#4b5563",
          }}
        >
          Week 1 – Deployed on Vercel
        </p>
      </main>
    </div>
  );
}
