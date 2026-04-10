"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";

const styles: Record<string, CSSProperties> = {
    page: {
        minHeight: "100vh",
        background:
            "radial-gradient(1200px 600px at 20% 10%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 55%), linear-gradient(135deg, #f5efe6 0%, #e8dfd1 50%, #d9cfc3 100%)",
        padding: 24,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
    },
    card: {
        width: "min(440px, 100%)",
        marginTop: "10vh",
        background: "rgba(255,255,255,0.88)",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 22,
        padding: "44px 36px",
        textAlign: "center",
        boxShadow: "0 26px 60px rgba(0,0,0,0.10)",
        backdropFilter: "blur(10px)",
    },
    title: {
        margin: 0,
        fontSize: 34,
        fontWeight: 650,
        color: "#222",
    },
    body: {
        margin: "12px 0 26px",
        fontSize: 15,
        lineHeight: 1.6,
        color: "#5a5a5a",
    },
    button: {
        width: "100%",
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "#2f2f2f",
        color: "#fff",
        fontSize: 16,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        boxShadow: "0 10px 22px rgba(0,0,0,0.15)",
    },
    buttonDisabled: {
        opacity: 0.7,
        cursor: "not-allowed",
        boxShadow: "none",
    },
    error: {
        marginTop: 14,
        color: "#8b3a3a",
        fontSize: 13,
    },
    googleDot: {
        width: 10,
        height: 10,
        borderRadius: 999,
        background:
            "conic-gradient(#4285F4 0 25%, #34A853 0 50%, #FBBC05 0 75%, #EA4335 0 100%)",
    },
};

export default function LoginRequiredScreen() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSignIn = async () => {
        if (loading) return;
        setLoading(true);
        setError(null);

        const supabase = createClient();
        const { error: signInError } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        if (signInError) {
            setError(signInError.message);
            setLoading(false);
        }
    };

    return (
        <div style={styles.page}>
            <div style={styles.card}>
                <h1 style={styles.title}>Sign in required</h1>
                <p style={styles.body}>
                    Please sign in to vote on captions or upload images.
                </p>
                <button
                    type="button"
                    onClick={handleSignIn}
                    disabled={loading}
                    style={{
                        ...styles.button,
                        ...(loading ? styles.buttonDisabled : {}),
                    }}
                >
                    <span style={styles.googleDot} />
                    Sign in with Google
                </button>
                {error && <p style={styles.error}>{error}</p>}
            </div>
        </div>
    );
}
