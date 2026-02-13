import Link from "next/link"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export default async function ProtectedPage() {
    const supabase = await createSupabaseServerClient()
    const {
        data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
        redirect("/login?next=/protected")
    }

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "grid",
                placeItems: "center",
                padding: 32,
                position: "relative",
                overflow: "hidden",
                background:
                    "linear-gradient(140deg, #f7f5f2, #f0f4ff 60%, #fff7f1 100%)",
                fontFamily: '"Helvetica Neue", "Nimbus Sans", Arial, sans-serif',
                color: "#1f2428",
            }}
        >
            <div
                style={{
                    width: "min(420px, 100%)",
                    padding: "32px 30px 28px",
                    borderRadius: 24,
                    background: "rgba(255, 255, 255, 0.8)",
                    border: "1px solid rgba(31, 36, 40, 0.12)",
                    boxShadow: "0 24px 60px rgba(31, 36, 40, 0.14)",
                    backdropFilter: "blur(8px)",
                }}
            >
                <div
                    style={{
                        textTransform: "uppercase",
                        letterSpacing: "0.16em",
                        fontSize: "0.7rem",
                        color: "#6b7280",
                        fontWeight: 700,
                        marginBottom: 10,
                    }}
                >
                    Protected Area
                </div>
                <h1 style={{ margin: "0 0 8px", fontSize: "1.9rem" }}>Gated UI</h1>
                <p style={{ margin: "0 0 20px", color: "#4a4f55" }}>
                    You are signed in and can access protected content.
                </p>
                <Link
                    href="/"
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "12px 18px",
                        borderRadius: 999,
                        border: "1px solid rgba(31, 36, 40, 0.2)",
                        background: "rgba(255, 255, 255, 0.85)",
                        fontWeight: 600,
                        textDecoration: "none",
                        color: "inherit",
                    }}
                >
                    Back to Gallery
                </Link>
            </div>
        </div>
    )
}
