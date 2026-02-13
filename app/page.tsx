"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type ImageRow = {
    id: string | number;
    url: string;
    image_description: string | null;
};

export default function HomePage() {
    const supabase = useMemo(() => createClient(), []);

    const [loading, setLoading] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [images, setImages] = useState<ImageRow[]>([]);
    const [error, setError] = useState<string | null>(null);

    // ✅ NEW: filter + modal state
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<ImageRow | null>(null);

    async function load() {
        setLoading(true);
        setError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;

        if (!session) {
            setUserEmail(null);
            setImages([]);
            setLoading(false);
            return;
        }

        setUserEmail(session.user.email ?? "Logged in");

        const { data, error } = await supabase
            .from("images")
            .select("id,url,image_description")
            .order("id", { ascending: false });

        if (error) setError(error.message);
        setImages(data ?? []);
        setLoading(false);
    }

    useEffect(() => {
        load();

        const { data: sub } = supabase.auth.onAuthStateChange(() => {
            load();
        });

        return () => sub.subscription.unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function signInWithGoogle() {
        setError(null);
        setAuthLoading(true);

        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        if (error) setError(error.message);
        setAuthLoading(false);
    }

    async function signOut() {
        setAuthLoading(true);
        await supabase.auth.signOut();
        setAuthLoading(false);
    }

    // ✅ NEW: close modal on ESC
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setSelected(null);
        }
        if (selected) window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [selected]);

    // ✅ NEW: filtered images (by description)
    const filteredImages = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return images;
        return images.filter((img) =>
            (img.image_description ?? "").toLowerCase().includes(q)
        );
    }, [images, query]);

    if (loading) {
        return (
            <div style={styles.page}>
                <div style={styles.loading}>Loading…</div>
            </div>
        );
    }

    // Not logged in => show login card
    if (!userEmail) {
        return (
            <div style={styles.page}>
                <div style={styles.loginCard}>
                    <div style={styles.badge}>Protected Gallery</div>
                    <h1 style={styles.loginTitle}>Welcome</h1>
                    <p style={styles.loginSubtitle}>
                        Please sign in to view the image gallery from Supabase.
                    </p>

                    <button
                        onClick={signInWithGoogle}
                        disabled={authLoading}
                        style={{
                            ...styles.primaryButton,
                            ...(authLoading ? styles.primaryButtonDisabled : {}),
                        }}
                    >
                        <span style={styles.googleDot} />
                        {authLoading ? "Redirecting…" : "Sign in with Google"}
                    </button>

                    {error && <p style={styles.errorText}>{error}</p>}
                    <p style={styles.loginFootnote}>
                        You’ll be redirected to Google and then back to <code>/auth/callback</code>.
                    </p>
                </div>
            </div>
        );
    }

    // Logged in => show images
    return (
        <div style={styles.page}>
            <div style={styles.container}>
                <header style={styles.header}>
                    <div>
                        <h1 style={styles.title}>Images</h1>
                        <p style={styles.subtitle}>Signed in as {userEmail}</p>
                    </div>

                    <button
                        onClick={signOut}
                        disabled={authLoading}
                        style={{
                            ...styles.secondaryButton,
                            ...(authLoading ? styles.secondaryButtonDisabled : {}),
                        }}
                    >
                        {authLoading ? "Signing out…" : "Logout"}
                    </button>
                </header>

                {/* ✅ NEW: Filter bar */}
                <section style={styles.filterBar}>
                    <div style={styles.filterLeft}>
                        <div style={styles.filterLabel}>SEARCH</div>
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search descriptions"
                            style={styles.filterInput}
                        />
                        <div style={styles.resultsText}>
                            {filteredImages.length} results
                        </div>
                    </div>

                    <button
                        onClick={() => setQuery("")}
                        style={styles.resetButton}
                        disabled={!query.trim()}
                        title="Clear search"
                    >
                        Reset
                    </button>
                </section>

                {error && <p style={{ ...styles.errorText, marginTop: 8 }}>{error}</p>}

                <div style={styles.grid}>
                    {filteredImages.map((img) => (
                        <div
                            key={String(img.id)}
                            style={styles.card}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelected(img)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") setSelected(img);
                            }}
                        >
                            <div style={styles.imageWrap}>
                                <img
                                    src={img.url}
                                    alt={img.image_description ?? ""}
                                    style={styles.image}
                                    loading="lazy"
                                />
                            </div>

                            <div style={styles.cardBody}>
                                {/* ✅ NEW: only show partial description here */}
                                <div style={styles.descriptionClamped}>
                                    {img.image_description ?? "(no description)"}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ✅ NEW: Modal for image + scrollable description */}
            {selected && (
                <div
                    style={styles.modalOverlay}
                    onClick={() => setSelected(null)}
                    role="dialog"
                    aria-modal="true"
                >
                    <div
                        style={styles.modal}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={styles.modalTop}>
                            <div style={styles.modalTitle}>Image</div>
                            <button style={styles.closeButton} onClick={() => setSelected(null)}>
                                ✕
                            </button>
                        </div>

                        <div style={styles.modalImageWrap}>
                            <img
                                src={selected.url}
                                alt={selected.image_description ?? ""}
                                style={styles.modalImage}
                            />
                        </div>

                        <div style={styles.modalDescBox}>
                            <div style={styles.modalDescTitle}>Description</div>
                            <div style={styles.modalDescScrollable}>
                                {selected.image_description ?? "(no description)"}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    page: {
        minHeight: "100vh",
        background:
            "radial-gradient(1200px 600px at 20% 10%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 55%), linear-gradient(135deg, #f5efe6 0%, #e8dfd1 50%, #d9cfc3 100%)",
        padding: 24,
    },

    container: { maxWidth: 1100, margin: "0 auto" },

    loading: {
        maxWidth: 420,
        margin: "120px auto 0",
        background: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 18,
        padding: 18,
        textAlign: "center",
        color: "#2c2c2c",
        boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
    },

    // Login card (unchanged)
    loginCard: {
        width: "min(440px, 100%)",
        margin: "10vh auto 0",
        background: "rgba(255,255,255,0.88)",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 22,
        padding: "44px 36px",
        textAlign: "center",
        boxShadow: "0 26px 60px rgba(0,0,0,0.10)",
        backdropFilter: "blur(10px)",
    },
    badge: {
        display: "inline-block",
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        letterSpacing: "0.4px",
        color: "#3b3b3b",
        background: "rgba(0,0,0,0.04)",
        marginBottom: 14,
    },
    loginTitle: { margin: 0, fontSize: 34, fontWeight: 650, color: "#222" },
    loginSubtitle: {
        margin: "12px 0 26px",
        fontSize: 15,
        lineHeight: 1.6,
        color: "#5a5a5a",
    },
    loginFootnote: {
        marginTop: 16,
        fontSize: 12.5,
        color: "#6b6b6b",
        lineHeight: 1.5,
    },

    primaryButton: {
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
    primaryButtonDisabled: { opacity: 0.65, cursor: "not-allowed", boxShadow: "none" },
    googleDot: {
        width: 10,
        height: 10,
        borderRadius: 999,
        background:
            "conic-gradient(#4285F4 0 25%, #34A853 0 50%, #FBBC05 0 75%, #EA4335 0 100%)",
    },

    secondaryButton: {
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.75)",
        color: "#2c2c2c",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
    },
    secondaryButtonDisabled: { opacity: 0.6, cursor: "not-allowed" },

    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: 16,
        padding: "12px 0 18px",
    },
    title: {
        margin: 0,
        fontSize: 44,
        fontWeight: 700,
        letterSpacing: "-0.5px",
        color: "#1f1f1f",
    },
    subtitle: { margin: "8px 0 0", color: "#5f5f5f", fontSize: 14 },

    // ✅ NEW: Filter bar styles
    filterBar: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginTop: 10,
        marginBottom: 14,
        padding: 16,
        borderRadius: 18,
        background: "rgba(255,255,255,0.80)",
        border: "1px solid rgba(0,0,0,0.06)",
        boxShadow: "0 16px 34px rgba(0,0,0,0.08)",
        maxWidth: 900, // keep it from spanning full width too much
    },
    filterLeft: { flex: 1, minWidth: 240 },
    filterLabel: {
        fontSize: 12,
        letterSpacing: "0.6px",
        fontWeight: 700,
        color: "#4a4a4a",
        marginBottom: 8,
    },
    filterInput: {
        width: "100%",
        padding: "12px 14px",
        borderRadius: 16,
        border: "1px solid rgba(0,0,0,0.10)",
        outline: "none",
        fontSize: 15,
        background: "rgba(255,255,255,0.9)",
    },
    resultsText: {
        marginTop: 10,
        fontSize: 13,
        color: "#5f5f5f",
    },
    resetButton: {
        padding: "10px 14px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.85)",
        fontWeight: 600,
        cursor: "pointer",
        height: 42,
        alignSelf: "center",
    },

    // Grid + cards
    grid: {
        marginTop: 18,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 18,
    },
    card: {
        borderRadius: 18,
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,0.06)",
        background: "rgba(255,255,255,0.85)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.08)",
        cursor: "pointer",
    },
    imageWrap: {
        aspectRatio: "4 / 3",
        overflow: "hidden",
        background: "rgba(0,0,0,0.03)",
    },
    image: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
    cardBody: { padding: 14 },

    // ✅ NEW: clamp description to partial view (2 lines)
    descriptionClamped: {
        fontSize: 14,
        color: "#3b3b3b",
        lineHeight: 1.45,
        wordBreak: "break-word",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
    },

    errorText: {
        marginTop: 14,
        color: "#b42318",
        background: "rgba(180, 35, 24, 0.08)",
        border: "1px solid rgba(180, 35, 24, 0.18)",
        padding: "10px 12px",
        borderRadius: 12,
        fontSize: 13.5,
        lineHeight: 1.4,
        textAlign: "left",
    },

    // ✅ NEW: Modal styles
    modalOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 50,
    },
    modal: {
        width: "min(860px, 96vw)",
        maxHeight: "92vh",
        overflow: "hidden",
        borderRadius: 18,
        background: "rgba(255,255,255,0.96)",
        border: "1px solid rgba(0,0,0,0.10)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
    },
    modalTop: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 16px",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
    },
    modalTitle: { fontWeight: 700, color: "#222" },
    closeButton: {
        border: "1px solid rgba(0,0,0,0.12)",
        background: "rgba(255,255,255,0.9)",
        borderRadius: 12,
        padding: "6px 10px",
        cursor: "pointer",
        fontWeight: 700,
    },
    modalImageWrap: {
        background: "rgba(0,0,0,0.04)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 12,
    },
    modalImage: {
        width: "100%",
        height: "auto",
        maxHeight: "52vh",
        objectFit: "contain",
        borderRadius: 14,
    },
    modalDescBox: {
        padding: 16,
        borderTop: "1px solid rgba(0,0,0,0.08)",
    },
    modalDescTitle: {
        fontSize: 12,
        letterSpacing: "0.6px",
        fontWeight: 800,
        color: "#4a4a4a",
        marginBottom: 10,
    },
    modalDescScrollable: {
        maxHeight: "18vh",
        overflowY: "auto",
        padding: 12,
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.9)",
        color: "#333",
        lineHeight: 1.6,
        fontSize: 14,
        whiteSpace: "pre-wrap",
    },
};
