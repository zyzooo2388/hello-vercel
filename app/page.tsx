"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type CaptionRow = {
    id: string;
    content: string | null;
    image_id: string | null;
};

type CaptionRowWithImage = CaptionRow & {
    image_url: string | null;
};

type ImageRow = {
    id: string;
    url: string | null;
};

function hasValidImage(caption: CaptionRowWithImage | null | undefined) {
    return !!caption?.image_url && caption.image_url.length > 0;
}

function shuffleCaptions(list: CaptionRowWithImage[]) {
    const array = [...list];
    for (let i = array.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function avoidConsecutiveSameImage(list: CaptionRowWithImage[]) {
    const array = [...list];
    for (let i = 1; i < array.length; i += 1) {
        const currentImageId = array[i].image_id;
        const previousImageId = array[i - 1].image_id;
        if (!currentImageId || !previousImageId || currentImageId !== previousImageId) continue;

        let swapIndex = -1;
        for (let j = i + 1; j < array.length; j += 1) {
            if (array[j].image_id && array[j].image_id !== previousImageId) {
                swapIndex = j;
                break;
            }
        }

        if (swapIndex !== -1) {
            [array[i], array[swapIndex]] = [array[swapIndex], array[i]];
        }
    }
    return array;
}

type StoredQueue = {
    queue: CaptionRowWithImage[];
};

const STORAGE_PREFIX = "voteQueue:";

function getStorageKey(userId: string) {
    return `${STORAGE_PREFIX}${userId}`;
}

function readStoredQueue(userId: string): StoredQueue | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = sessionStorage.getItem(getStorageKey(userId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredQueue;
        if (!parsed || !Array.isArray(parsed.queue)) {
            return null;
        }
        return { queue: parsed.queue };
    } catch {
        return null;
    }
}

function persistQueue(userId: string, queue: CaptionRowWithImage[]) {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(getStorageKey(userId), JSON.stringify({ queue }));
}

function VoteButtons({
    onVote,
    disabled,
    submitting,
    selectedVote,
}: {
    onVote: (value: 1 | -1) => void;
    disabled: boolean;
    submitting: boolean;
    selectedVote?: 1 | -1 | null;
}) {
    const isDisabled = disabled || submitting;

    return (
        <div style={styles.voteButtonsRow}>
            <button
                type="button"
                onClick={() => onVote(-1)}
                disabled={isDisabled}
                aria-label="Not willing"
                aria-pressed={selectedVote === -1}
                className="vote-button"
                style={{
                    ...styles.voteButton,
                    ...(isDisabled ? styles.voteButtonDisabled : {}),
                }}
            >
                😵
            </button>
            <button
                type="button"
                onClick={() => onVote(1)}
                disabled={isDisabled}
                aria-label="Love"
                aria-pressed={selectedVote === 1}
                className="vote-button"
                style={{
                    ...styles.voteButton,
                    ...(isDisabled ? styles.voteButtonDisabled : {}),
                }}
            >
                🧡
            </button>
            <style jsx>{`
                .vote-button:hover:not(:disabled) {
                    transform: scale(1.06);
                }
            `}</style>
        </div>
    );
}

export default function HomePage() {
    const supabase = useMemo(() => createClient(), []);
    const didInitRef = useRef(false);

    const [loading, setLoading] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [queue, setQueue] = useState<CaptionRowWithImage[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [doneCount, setDoneCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [votingByCaptionId, setVotingByCaptionId] = useState<Record<string, boolean>>({});
    const [voteByCaptionId, setVoteByCaptionId] = useState<Record<string, 1 | -1 | 0 | null>>({});
    const [voteStatus, setVoteStatus] = useState<"success" | "error" | null>(null);
    const [voteError, setVoteError] = useState<string | null>(null);
    const [selectedVote, setSelectedVote] = useState<1 | -1 | null>(null);
    const [animDir, setAnimDir] = useState<"left" | "right" | null>(null);
    const [animAngle, setAnimAngle] = useState(0);
    const [animState, setAnimState] = useState<"idle" | "out" | "in-start" | "in">("idle");
    const [isAnimating, setIsAnimating] = useState(false);

    async function load({ force }: { force?: boolean } = {}) {
        setLoading(true);
        setError(null);

        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;

        if (!session) {
            setUserEmail(null);
            setUserId(null);
            setQueue([]);
            setTotalCount(0);
            setDoneCount(0);
            setVoteByCaptionId({});
            setLoading(false);
            return;
        }

        setUserEmail(session.user.email ?? "Logged in");
        setUserId(session.user.id);

        if (!force) {
            const stored = readStoredQueue(session.user.id);
            if (stored) {
                setQueue(stored.queue);
            }
        }

        const [
            { count: totalCountDb, error: totalCountError },
            { count: doneCountDb, error: doneCountError },
        ] = await Promise.all([
            supabase.from("captions").select("id", { count: "exact", head: true }),
            supabase
                .from("caption_votes")
                .select("id", { count: "exact", head: true })
                .eq("profile_id", session.user.id),
        ]);

        if (totalCountError || doneCountError) {
            setError(totalCountError?.message ?? doneCountError?.message ?? "Unable to load counts.");
            setQueue([]);
            setTotalCount(0);
            setDoneCount(0);
            setVoteByCaptionId({});
            setLoading(false);
            return;
        }

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
                setQueue([]);
                setTotalCount(0);
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
            setQueue([]);
            setTotalCount(0);
            setDoneCount(0);
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
            setQueue([]);
            setTotalCount(0);
            setDoneCount(0);
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

        const captionsWithImages = captionsData.map((caption) => ({
            ...caption,
            image_url: caption.image_id ? imageMap[caption.image_id] ?? null : null,
        }));
        const validCaptions = captionsWithImages.filter((caption) => hasValidImage(caption));
        const eligibleCaptions = validCaptions.filter((caption) => voteMap[caption.id] == null);
        const shuffledCaptions = avoidConsecutiveSameImage(shuffleCaptions(eligibleCaptions));

        setQueue(shuffledCaptions);
        setTotalCount(validCaptions.length || totalCountDb || 0);
        setDoneCount(doneCountDb ?? 0);
        setVoteByCaptionId(voteMap);
        persistQueue(session.user.id, shuffledCaptions);

        setLoading(false);
    }

    useEffect(() => {
        if (didInitRef.current) return;
        didInitRef.current = true;
        load();

        const { data: sub } = supabase.auth.onAuthStateChange(() => {
            load({ force: true });
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

    function randomAngle(dir: "left" | "right") {
        const magnitude = 6 + Math.random() * 10;
        return dir === "right" ? magnitude : -magnitude;
    }

    async function animateAndAdvance(dir: "left" | "right") {
        if (isAnimating) return;
        setIsAnimating(true);
        setAnimDir(dir);
        setAnimAngle(randomAngle(dir));
        setAnimState("out");

        await new Promise((resolve) => setTimeout(resolve, 280));
        const hasNext = queue.length > 1;
        setQueue((prev) => {
            const nextQueue = prev.slice(1);
            if (userId) persistQueue(userId, nextQueue);
            return nextQueue;
        });

        if (!hasNext) {
            setAnimState("idle");
            setAnimDir(null);
            setIsAnimating(false);
            return;
        }

        const enterDir = dir === "right" ? "left" : "right";
        setAnimDir(enterDir);
        setAnimAngle(randomAngle(enterDir));
        setAnimState("in-start");

        await new Promise((resolve) =>
            requestAnimationFrame(() => {
                resolve(true);
            }),
        );
        setAnimState("in");

        await new Promise((resolve) => setTimeout(resolve, 260));
        setAnimState("idle");
        setAnimDir(null);
        setIsAnimating(false);
    }

    async function handleVote(captionId: string, value: 1 | -1) {
        if (!userId) {
            setVoteStatus("error");
            setVoteError("Please sign in to vote.");
            return;
        }

        if (votingByCaptionId[captionId]) return;
        setVotingByCaptionId((prev) => ({ ...prev, [captionId]: true }));
        setVoteStatus(null);
        setVoteError(null);

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
            setVoteStatus("error");
            setVoteError("Unable to record vote. Please try again.");
            setVotingByCaptionId((prev) => ({ ...prev, [captionId]: false }));
            return;
        }

        setVoteByCaptionId((prev) => ({ ...prev, [captionId]: value }));
        if (!hasExistingVote) {
            setDoneCount((prev) => prev + 1);
        }
        setVoteStatus("success");
        setVoteError(null);
        setVotingByCaptionId((prev) => ({ ...prev, [captionId]: false }));
        await animateAndAdvance(value === 1 ? "right" : "left");
    }

    const currentCaption = queue[0];
    const currentCaptionId = currentCaption?.id ?? null;

    useEffect(() => {
        setSelectedVote(null);
        setVoteStatus(null);
        setVoteError(null);

        if (!currentCaptionId) {
            return;
        }

        const existingVote = voteByCaptionId[currentCaptionId];
        if (existingVote === 1 || existingVote === -1) {
            setSelectedVote(existingVote);
        } else {
            setSelectedVote(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCaptionId]);

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

    const remaining = Math.max(totalCount - doneCount, 0);
    const total = totalCount;
    const headerText =
        total === 0
            ? "CAPTION 0 / 0"
            : remaining === 0
              ? `DONE / ${total}`
              : `CAPTION ${doneCount + 1} / ${total}`;

    return (
        <div style={styles.page}>
            <div style={styles.raterShell}>
                <header style={styles.raterHeader}>
                    <div>
                        <div style={styles.progressLabel}>
                            {headerText}
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

                {remaining === 0 ? (
                    <div style={styles.emptyCard}>All done. Thanks for voting!</div>
                ) : (
                    <div
                        key={currentCaption?.id}
                        style={{
                            ...styles.card,
                            transform:
                                animState === "out" || animState === "in-start"
                                    ? `translateX(${animDir === "left" ? "-120%" : "120%"}) rotate(${animAngle}deg)`
                                    : "translateX(0) rotate(0deg)",
                            opacity: animState === "out" || animState === "in-start" ? 0 : 1,
                            transition:
                                animState === "out"
                                    ? "transform 280ms ease, opacity 280ms ease"
                                    : animState === "in"
                                      ? "transform 260ms ease, opacity 260ms ease"
                                      : "none",
                        }}
                    >
                        <div style={styles.imageWrap}>
                            {hasValidImage(currentCaption) && (
                                <img
                                    src={currentCaption.image_url ?? ""}
                                    alt={currentCaption?.content ?? ""}
                                    style={styles.image}
                                />
                            )}
                        </div>

                        <div style={styles.cardBody}>
                            <div style={styles.captionText}>
                                {currentCaption?.content ?? "(no caption)"}
                            </div>

                            <VoteButtons
                                onVote={(value) => currentCaption?.id && handleVote(currentCaption.id, value)}
                                disabled={!userId || !currentCaption?.id || isAnimating}
                                submitting={currentCaption?.id ? !!votingByCaptionId[currentCaption.id] : false}
                                selectedVote={selectedVote}
                            />

                            {voteStatus && (
                                <div
                                    style={
                                        voteStatus === "success"
                                            ? styles.voteConfirm
                                            : styles.voteError
                                    }
                                >
                                    {voteStatus === "success" ? "Vote recorded." : voteError}
                                </div>
                            )}

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
        height: "min(52vh, 520px)",
        overflow: "hidden",
        background: "rgba(0,0,0,0.04)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    image: { width: "100%", height: "100%", objectFit: "contain", display: "block" },
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
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        width: "100%",
    },
    voteButton: {
        padding: "8px 14px",
        borderRadius: 14,
        border: "1px solid #ddd",
        background: "#fff",
        cursor: "pointer",
        fontSize: 30,
        lineHeight: 1,
        transition: "transform 140ms ease",
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
