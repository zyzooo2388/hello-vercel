"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type CaptionRow = {
    id: string;
    content: string | null;
    image_id: string | null;
};

type ImageRow = {
    id: string;
    url: string | null;
};

type VoteFeedback = {
    type: "success" | "error";
    message: string;
};

function VoteButtons({
    onVote,
    disabled,
    submitting,
    currentVote,
}: {
    onVote: (value: 1 | -1) => void;
    disabled: boolean;
    submitting: boolean;
    currentVote?: 1 | -1 | 0 | null;
}) {
    const isDisabled = disabled || submitting;

    return (
        <div style={styles.voteButtonsRow}>
            <button
                type="button"
                onClick={() => onVote(1)}
                disabled={isDisabled}
                aria-label="Upvote caption"
                style={{
                    ...styles.voteButton,
                    ...(currentVote === 1 ? styles.voteButtonActiveUp : {}),
                    ...(isDisabled ? styles.voteButtonDisabled : {}),
                }}
            >
                👍
            </button>
            <button
                type="button"
                onClick={() => onVote(-1)}
                disabled={isDisabled}
                aria-label="Downvote caption"
                style={{
                    ...styles.voteButton,
                    ...(currentVote === -1 ? styles.voteButtonActiveDown : {}),
                    ...(isDisabled ? styles.voteButtonDisabled : {}),
                }}
            >
                👎
            </button>
        </div>
    );
}

export default function HomePage() {
    const supabase = useMemo(() => createClient(), []);

    const [loading, setLoading] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [captions, setCaptions] = useState<CaptionRow[]>([]);
    const [imagesById, setImagesById] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [votingByCaptionId, setVotingByCaptionId] = useState<Record<string, boolean>>({});
    const [voteByCaptionId, setVoteByCaptionId] = useState<Record<string, 1 | -1 | 0 | null>>({});
    const [voteFeedback, setVoteFeedback] = useState<VoteFeedback | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);

    async function load() {
        setLoading(true);
        setError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;

        if (!session) {
            setUserEmail(null);
            setUserId(null);
            setCaptions([]);
            setImagesById({});
            setVoteByCaptionId({});
            setCurrentIndex(0);
            setLoading(false);
            return;
        }

        setUserEmail(session.user.email ?? "Logged in");
        setUserId(session.user.id);

        let captionsData: CaptionRow[] = [];
        const { data: createdOrder, error: createdOrderError } = await supabase
            .from("captions")
            .select("id, content, image_id")
            .order("created_datetime_utc", { ascending: false });

        if (createdOrderError) {
            const { data: fallbackData, error: fallbackError } = await supabase
                .from("captions")
                .select("id, content, image_id")
                .order("id", { ascending: false });

            if (fallbackError) {
                setError(fallbackError.message);
                setCaptions([]);
                setImagesById({});
                setVoteByCaptionId({});
                setLoading(false);
                return;
            }

            captionsData = (fallbackData ?? []) as CaptionRow[];
        } else {
            captionsData = (createdOrder ?? []) as CaptionRow[];
        }

        const { data: imagesData, error: imagesError } = await supabase
            .from("images")
            .select("id, url");

        if (imagesError) {
            setError(imagesError.message);
            setCaptions([]);
            setImagesById({});
            setVoteByCaptionId({});
            setLoading(false);
            return;
        }

        const imageMap: Record<string, string> = {};
        (imagesData as ImageRow[] | null)?.forEach((row) => {
            if (row.id && row.url) imageMap[row.id] = row.url;
        });

        const { data: votesData, error: votesError } = await supabase
            .from("caption_votes")
            .select("caption_id, vote_value")
            .eq("profile_id", session.user.id);

        if (votesError) {
            setError(votesError.message);
            setCaptions([]);
            setImagesById({});
            setVoteByCaptionId({});
            setLoading(false);
            return;
        }

        const voteMap: Record<string, 1 | -1 | 0 | null> = {};
        (votesData ?? []).forEach((row) => {
            if (row.caption_id) {
                voteMap[row.caption_id] = row.vote_value as 1 | -1 | 0 | null;
            }
        });

        setCaptions(captionsData);
        setImagesById(imageMap);
        setVoteByCaptionId(voteMap);

        const firstUnvotedIndex = captionsData.findIndex((caption) => !voteMap[caption.id]);
        setCurrentIndex(firstUnvotedIndex === -1 ? 0 : firstUnvotedIndex);

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

    async function handleVote(captionId: string, value: 1 | -1) {
        if (!userId) {
            setVoteFeedback({ type: "error", message: "Please sign in to vote." });
            return;
        }

        if (votingByCaptionId[captionId]) return;
        setVotingByCaptionId((prev) => ({ ...prev, [captionId]: true }));
        setVoteFeedback(null);

        const now = new Date().toISOString();
        const hasExistingVote = voteByCaptionId[captionId] != null;
        const payload: {
            profile_id: string;
            caption_id: string;
            vote_value: 1 | -1;
            created_datetime_utc: string;
            modified_datetime_utc?: string;
        } = {
            profile_id: userId,
            caption_id: captionId,
            vote_value: value,
            created_datetime_utc: now,
        };

        if (hasExistingVote) {
            payload.modified_datetime_utc = now;
        }

        const { error } = await supabase
            .from("caption_votes")
            .upsert(payload, { onConflict: "profile_id,caption_id" });

        if (error) {
            console.error("Vote error:", error);
            setVoteFeedback({ type: "error", message: "Unable to record vote. Please try again." });
            setVotingByCaptionId((prev) => ({ ...prev, [captionId]: false }));
            return;
        }

        setVoteByCaptionId((prev) => ({ ...prev, [captionId]: value }));
        setVoteFeedback({ type: "success", message: "Vote recorded." });
        setVotingByCaptionId((prev) => ({ ...prev, [captionId]: false }));
    }

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "ArrowLeft") {
                setCurrentIndex((prev) => Math.max(0, prev - 1));
            }
            if (e.key === "ArrowRight") {
                setCurrentIndex((prev) => Math.min(captions.length - 1, prev + 1));
            }
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [captions.length]);

    if (loading) {
        return (
            <div style={styles.page}>
                <div style={styles.loading}>Loading…</div>
            </div>
        );
    }

    if (!userEmail) {
        return (
            <div style={styles.page}>
                <div style={styles.loginCard}>
                    <div style={styles.badge}>Protected Rater</div>
                    <h1 style={styles.loginTitle}>Welcome</h1>
                    <p style={styles.loginSubtitle}>Please sign in to rate captions.</p>

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

    const total = captions.length;
    const currentCaption = captions[currentIndex];
    const currentVote = currentCaption?.id ? voteByCaptionId[currentCaption.id] : null;
    const hasVoteForCurrent = currentCaption?.id ? voteByCaptionId[currentCaption.id] != null : false;
    const votedCount = captions.reduce((count, caption) => {
        if (voteByCaptionId[caption.id] != null) return count + 1;
        return count;
    }, 0);
    const remaining = Math.max(0, total - votedCount);

    return (
        <div style={styles.page}>
            <div style={styles.raterShell}>
                <header style={styles.raterHeader}>
                    <div>
                        <div style={styles.progressLabel}>
                            {total === 0
                                ? "CAPTION 0 / 0"
                                : `CAPTION ${currentIndex + 1} / ${total}`}
                        </div>
                        <div style={styles.subtitle}>Signed in as {userEmail}</div>
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

                {error && <p style={{ ...styles.errorText, marginTop: 8 }}>{error}</p>}

                {total === 0 ? (
                    <div style={styles.emptyCard}>No captions available.</div>
                ) : (
                    <div style={styles.card}>
                        <div style={styles.imageWrap}>
                            {currentCaption?.image_id && imagesById[currentCaption.image_id] ? (
                                <img
                                    src={imagesById[currentCaption.image_id]}
                                    alt={currentCaption.content ?? ""}
                                    style={styles.image}
                                />
                            ) : (
                                <div style={styles.imageMissing}>
                                    No image row for this image_id
                                </div>
                            )}
                        </div>

                        <div style={styles.cardBody}>
                            <div style={styles.captionText}>
                                {currentCaption?.content ?? "(no caption)"}
                            </div>

                            <VoteButtons
                                onVote={(value) => currentCaption?.id && handleVote(currentCaption.id, value)}
                                disabled={!userId || !currentCaption?.id}
                                submitting={currentCaption?.id ? !!votingByCaptionId[currentCaption.id] : false}
                                currentVote={currentVote}
                            />

                            {voteFeedback && (
                                <div
                                    style={
                                        voteFeedback.type === "success"
                                            ? styles.voteConfirm
                                            : styles.voteError
                                    }
                                >
                                    {voteFeedback.message}
                                </div>
                            )}

                            <div style={styles.navigationRow}>
                                <button
                                    type="button"
                                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                                    disabled={currentIndex === 0}
                                    style={{
                                        ...styles.navButton,
                                        ...(currentIndex === 0 ? styles.navButtonDisabled : {}),
                                    }}
                                >
                                    Prev
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setCurrentIndex((prev) => Math.min(total - 1, prev + 1))
                                    }
                                    disabled={!hasVoteForCurrent || currentIndex === total - 1}
                                    style={{
                                        ...styles.navButtonPrimary,
                                        ...(!hasVoteForCurrent || currentIndex === total - 1
                                            ? styles.navButtonDisabled
                                            : {}),
                                    }}
                                >
                                    Next
                                </button>
                            </div>

                            <div style={styles.remainingText}>
                                {remaining} captions left to vote
                            </div>
                        </div>
                    </div>
                )}
            </div>
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

    // Login card
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

    raterShell: {
        maxWidth: 900,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 18,
    },
    raterHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: "12px 0 6px",
    },
    progressLabel: {
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.4px",
        color: "#3b3b3b",
    },
    subtitle: { marginTop: 6, color: "#5f5f5f", fontSize: 14 },

    card: {
        borderRadius: 22,
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,0.06)",
        background: "rgba(255,255,255,0.88)",
        boxShadow: "0 22px 50px rgba(0,0,0,0.10)",
        display: "flex",
        flexDirection: "column",
    },
    imageWrap: {
        aspectRatio: "16 / 9",
        overflow: "hidden",
        background: "rgba(0,0,0,0.04)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    image: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
    imageMissing: {
        padding: 24,
        color: "#6b6b6b",
        fontSize: 14,
        textAlign: "center",
    },
    cardBody: {
        padding: "20px 22px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
    },
    captionText: {
        fontSize: 18,
        lineHeight: 1.6,
        color: "#2c2c2c",
        wordBreak: "break-word",
    },

    voteButtonsRow: {
        display: "flex",
        gap: 12,
        alignItems: "center",
    },
    voteButton: {
        padding: "8px 14px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "rgba(255,255,255,0.95)",
        cursor: "pointer",
        fontSize: 18,
        lineHeight: 1,
        boxShadow: "0 8px 16px rgba(0,0,0,0.08)",
        transition: "transform 120ms ease, background 140ms ease, border 140ms ease, box-shadow 140ms ease",
    },
    voteButtonActiveUp: {
        background: "#DCFCE7",
        border: "1px solid #86EFAC",
    },
    voteButtonActiveDown: {
        background: "#FEE2E2",
        border: "1px solid #FCA5A5",
    },
    voteButtonDisabled: {
        opacity: 0.5,
        cursor: "not-allowed",
        boxShadow: "none",
    },

    voteConfirm: {
        fontSize: 12.5,
        color: "#1f7a3f",
        background: "rgba(34, 197, 94, 0.12)",
        border: "1px solid rgba(34, 197, 94, 0.2)",
        padding: "6px 8px",
        borderRadius: 10,
        width: "fit-content",
    },
    voteError: {
        fontSize: 12.5,
        color: "#b42318",
        background: "rgba(180, 35, 24, 0.08)",
        border: "1px solid rgba(180, 35, 24, 0.18)",
        padding: "6px 8px",
        borderRadius: 10,
        width: "fit-content",
    },

    navigationRow: {
        display: "flex",
        gap: 12,
        alignItems: "center",
    },
    navButton: {
        padding: "10px 16px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "rgba(255,255,255,0.9)",
        fontWeight: 600,
        cursor: "pointer",
    },
    navButtonPrimary: {
        padding: "10px 16px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "#2f2f2f",
        color: "#fff",
        fontWeight: 600,
        cursor: "pointer",
    },
    navButtonDisabled: {
        opacity: 0.5,
        cursor: "not-allowed",
    },

    remainingText: {
        fontSize: 13,
        color: "#5f5f5f",
        marginTop: 4,
    },

    emptyCard: {
        borderRadius: 18,
        background: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(0,0,0,0.06)",
        padding: "24px",
        textAlign: "center",
        color: "#5f5f5f",
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
};
