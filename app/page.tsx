"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type CaptionRow = {
    id: string;
    content: string | null;
    image_id: string | null;
    created_datetime_utc?: string | null;
};

type CaptionRowWithImage = CaptionRow & {
    image_url: string | null;
};

type LeaderboardCaptionRow = {
    id: string;
    content: string | null;
    image_id: string | null;
    created_datetime_utc: string | null;
    like_count: number | string | null;
};

type LeaderboardItem = LeaderboardCaptionRow & {
    image_url: string | null;
};

type CaptionRowJoined = {
    id: string;
    content: string | null;
    image_id: string | null;
    created_datetime_utc: string | null;
    images: { id: string; url: string | null } | { id: string; url: string | null }[] | null;
};

type ReactionParticle = {
    id: string;
    emoji: string;
    xOffset: number;
    driftX: number;
    durationMs: number;
    delayMs: number;
    sizePx: number;
    rotateDeg: number;
    floatY: number;
};

type ReactionBurst = {
    id: string;
    type: "like" | "dislike";
    createdAt: number;
    originX: number;
    originY: number;
    particles: ReactionParticle[];
};

type CSSVariableProperties = React.CSSProperties & {
    [key: `--${string}`]: string;
};

function getImageUrl(caption: CaptionRowWithImage | null | undefined) {
    return caption?.image_url?.trim() ?? "";
}

function hasValidImage(caption: CaptionRowWithImage | null | undefined) {
    const trimmed = getImageUrl(caption);
    return trimmed.length > 0;
}

function hasValidContent(caption: CaptionRowWithImage | null | undefined) {
    if (!caption?.content) return false;
    return caption.content.trim().length > 0;
}

function hasValidLeaderboardImage(item: LeaderboardItem | null | undefined) {
    const trimmed = item?.image_url?.trim() ?? "";
    return trimmed.length > 0;
}

function isCaptionVotable(caption: CaptionRowWithImage | null | undefined) {
    return hasValidContent(caption) && hasValidImage(caption);
}

function normalizeCaptions({
    captions,
    voteMap,
    isDev,
}: {
    captions: CaptionRowWithImage[];
    voteMap: Record<string, 1 | -1 | 0 | null>;
    isDev: boolean;
}) {
    let missingContent = 0;
    let missingUrl = 0;
    const skippedImageIds = new Set<string>();

    const validCaptions = captions.filter((caption) => {
        if (!hasValidContent(caption)) {
            missingContent += 1;
            if (caption.image_id) skippedImageIds.add(caption.image_id);
            return false;
        }

        const trimmedUrl = getImageUrl(caption);
        if (!trimmedUrl) {
            missingUrl += 1;
            if (caption.image_id) skippedImageIds.add(caption.image_id);
            return false;
        }

        return true;
    });

    if (isDev) {
        console.log("[vote] normalize:filter", {
            missingContent,
            missingUrl,
            skippedImageIds: Array.from(skippedImageIds),
        });
    }

    const eligibleCaptions = validCaptions.filter((caption) => voteMap[caption.id] == null);
    return { validCaptions, eligibleCaptions };
}

function reorderToAvoidConsecutiveImages(items: CaptionRowWithImage[]) {
    if (items.length <= 1) return items.slice();

    const groups = new Map<string, { imageId: string | null; items: CaptionRowWithImage[] }>();

    items.forEach((item) => {
        const key = item.image_id ?? "__null__";
        const existing = groups.get(key);
        if (existing) {
            existing.items.push(item);
        } else {
            groups.set(key, { imageId: item.image_id ?? null, items: [item] });
        }
    });

    const orderedGroups = Array.from(groups.values()).sort((a, b) => {
        const sizeDiff = b.items.length - a.items.length;
        if (sizeDiff !== 0) return sizeDiff;
        const aId = a.imageId ?? "";
        const bId = b.imageId ?? "";
        return aId.localeCompare(bId);
    });

    const result: CaptionRowWithImage[] = [];
    let lastImageId: string | null = null;

    while (orderedGroups.length > 0) {
        let groupIndex = orderedGroups.findIndex((group) => group.imageId !== lastImageId);
        if (groupIndex === -1) groupIndex = 0;

        const group = orderedGroups[groupIndex];
        const nextItem = group.items.shift();
        if (nextItem) {
            result.push(nextItem);
            lastImageId = nextItem.image_id ?? null;
        }

        if (group.items.length === 0) {
            orderedGroups.splice(groupIndex, 1);
            continue;
        }

        orderedGroups.splice(groupIndex, 1);

        let insertIndex = orderedGroups.length;
        for (let i = 0; i < orderedGroups.length; i += 1) {
            const sizeDiff = group.items.length - orderedGroups[i].items.length;
            if (sizeDiff > 0) {
                insertIndex = i;
                break;
            }
            if (sizeDiff === 0) {
                const groupId = group.imageId ?? "";
                const otherId = orderedGroups[i].imageId ?? "";
                if (groupId.localeCompare(otherId) < 0) {
                    insertIndex = i;
                    break;
                }
            }
        }

        orderedGroups.splice(insertIndex, 0, group);
    }

    return result;
}

type StoredQueue = {
    queue: CaptionRowWithImage[];
};

const STORAGE_PREFIX = "voteQueue:";
// Keep a short rolling history of recently shown images so we can avoid
// showing the same image again too soon (even if the caption changes).
const RECENT_IMAGE_WINDOW_SIZE = 8;
const POOL_SIZE = 300;
const FETCH_BATCH_SIZE = 500;

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

function pushRecentImageId(recent: string[], imageId: string | null, maxSize = RECENT_IMAGE_WINDOW_SIZE) {
    if (!imageId) return;
    // Avoid double-pushing if multiple effects record the same current image.
    if (recent[recent.length - 1] === imageId) return;
    recent.push(imageId);
    if (recent.length > maxSize) {
        recent.splice(0, recent.length - maxSize);
    }
}

function advanceQueueAvoidingRecentImages(
    prevQueue: CaptionRowWithImage[],
    recentImageIds: string[],
) {
    if (prevQueue.length <= 1) return [];

    const rest = prevQueue.slice(1);
    if (rest.length <= 1) return rest;

    // Prefer image diversity first: pick the earliest caption whose image is not
    // in the recent window. This prevents consecutive (or near-consecutive)
    // repeats when multiple captions share the same image.
    const recentSet = new Set(recentImageIds);
    const nextIndex = rest.findIndex((item) => {
        const imageId = item.image_id;
        if (!imageId) return true;
        return !recentSet.has(imageId);
    });

    if (nextIndex <= 0) {
        // nextIndex === 0 => already diverse; nextIndex === -1 => no alternatives available.
        return rest;
    }

    const [nextItem] = rest.splice(nextIndex, 1);
    return [nextItem, ...rest];
}

function VoteButtons({
    onVote,
    disabled,
    submitting,
    selectedVote,
    dislikeButtonRef,
    likeButtonRef,
}: {
    onVote: (value: 1 | -1) => void;
    disabled: boolean;
    submitting: boolean;
    selectedVote?: 1 | -1 | null;
    dislikeButtonRef: React.RefObject<HTMLButtonElement | null>;
    likeButtonRef: React.RefObject<HTMLButtonElement | null>;
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
                ref={dislikeButtonRef}
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
                ref={likeButtonRef}
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
    const didInitQueueRef = useRef(false);
    const authInitializedRef = useRef(false);
    const lastSessionUserIdRef = useRef<string | null>(null);
    const lastSessionEmailRef = useRef<string | null>(null);
    const loadedForKeyRef = useRef<string | null>(null);
    const inFlightLoadKeyRef = useRef<string | null>(null);
    const isDev = process.env.NODE_ENV !== "production";

    const [loading, setLoading] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [authReady, setAuthReady] = useState(false);
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
    const [reactions, setReactions] = useState<ReactionBurst[]>([]);
    const [isShaking, setIsShaking] = useState(false);
    const [leaderboardOpen, setLeaderboardOpen] = useState(false);
    const [leaderboardLoading, setLeaderboardLoading] = useState(false);
    const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
    const [leaderboardData, setLeaderboardData] = useState<{
        mostLiked: LeaderboardItem[];
        topWeek: LeaderboardItem[];
    } | null>(null);

    const badImageIdsRef = useRef(new Set<string>());
    const queueRef = useRef<CaptionRowWithImage[]>([]);
    const recentImageIdsRef = useRef<string[]>([]);
    const leaderboardRequestRef = useRef(0);
    const reactionTimeoutsRef = useRef<Record<string, number>>({});
    const shakeTimeoutRef = useRef<number | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const dislikeButtonRef = useRef<HTMLButtonElement | null>(null);
    const likeButtonRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        queueRef.current = queue;
    }, [queue]);

    useEffect(() => {
        return () => {
            Object.values(reactionTimeoutsRef.current).forEach((timeoutId) => {
                window.clearTimeout(timeoutId);
            });
            if (shakeTimeoutRef.current) {
                window.clearTimeout(shakeTimeoutRef.current);
            }
        };
    }, []);

    function filterBadImages(list: CaptionRowWithImage[]) {
        if (badImageIdsRef.current.size === 0) return list;
        return list.filter(
            (caption) =>
                !caption.image_id || !badImageIdsRef.current.has(caption.image_id),
        );
    }

    async function fetchCaptionPool({
        voteMap,
    }: {
        voteMap: Record<string, 1 | -1 | 0 | null>;
    }) {
        const pool: CaptionRowWithImage[] = [];
        let offset = 0;
        let fetchedCount = 0;

        while (pool.length < POOL_SIZE) {
            const { data, error } = await supabase
                .from("captions")
                .select("id, content, image_id, created_datetime_utc, images ( id, url )")
                .not("content", "is", null)
                .neq("content", "")
                .not("image_id", "is", null)
                .order("created_datetime_utc", { ascending: false })
                .range(offset, offset + FETCH_BATCH_SIZE - 1);

            if (error) {
                return { pool: [], eligible: [], fetchedCount, error };
            }

            const rows = (data ?? []) as CaptionRowJoined[];
            if (rows.length === 0) break;

            fetchedCount += rows.length;
            offset += FETCH_BATCH_SIZE;

            const normalizedBatch: CaptionRowWithImage[] = rows.map((row) => {
                const images = row.images;
                const image = Array.isArray(images) ? images[0] : images;
                return {
                    id: row.id,
                    content: row.content,
                    image_id: row.image_id,
                    created_datetime_utc: row.created_datetime_utc,
                    image_url: image?.url ?? null,
                };
            });

            const { validCaptions } = normalizeCaptions({
                captions: normalizedBatch,
                voteMap,
                isDev,
            });

            pool.push(...validCaptions);
        }

        const trimmedPool = pool.slice(0, POOL_SIZE);
        const reorderedPool = reorderToAvoidConsecutiveImages(trimmedPool);
        const eligible = reorderedPool.filter((caption) => voteMap[caption.id] == null);

        return { pool: reorderedPool, eligible, fetchedCount, error: null };
    }

    async function fetchLeaderboardCaptions({
        sinceIso,
        limit = 20,
    }: {
        sinceIso?: string;
        limit?: number;
    }) {
        let query = supabase
            .from("captions")
            .select("id, content, image_id, created_datetime_utc, like_count")
            .not("image_id", "is", null)
            .order("like_count", { ascending: false })
            .limit(limit);

        if (sinceIso) {
            query = query.gte("created_datetime_utc", sinceIso);
        }

        const { data, error } = await query;
        if (error) {
            return { items: [] as LeaderboardItem[], error: error.message };
        }

        const rows = (data ?? []) as LeaderboardCaptionRow[];
        if (rows.length === 0) {
            return { items: [] as LeaderboardItem[], error: null };
        }

        const imageIds = Array.from(
            new Set(rows.map((row) => row.image_id).filter(Boolean)),
        ) as string[];

        if (imageIds.length === 0) {
            return { items: [] as LeaderboardItem[], error: null };
        }

        const { data: imageData, error: imageError } = await supabase
            .from("images")
            .select("id, url")
            .in("id", imageIds);

        if (imageError) {
            return { items: [] as LeaderboardItem[], error: imageError.message };
        }

        const imageMap = new Map<string, string | null>(
            (imageData ?? []).map((image) => [image.id, image.url ?? null]),
        );

        const items = rows
            .map((row) => ({
                ...row,
                image_url: row.image_id ? imageMap.get(row.image_id) ?? null : null,
            }))
            .filter((item) => hasValidLeaderboardImage(item));

        return { items, error: null };
    }

    function formatLikeCount(value: LeaderboardItem["like_count"]) {
        const numeric =
            typeof value === "number" ? value : Number(value ?? 0);
        if (!Number.isFinite(numeric)) return "0";
        return numeric.toLocaleString();
    }

    async function loadLeaderboard() {
        if (leaderboardLoading) return;
        leaderboardRequestRef.current += 1;
        const requestId = leaderboardRequestRef.current;
        setLeaderboardLoading(true);
        setLeaderboardError(null);

        const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const [mostLiked, topWeek] = await Promise.all([
            fetchLeaderboardCaptions({ limit: 20 }),
            fetchLeaderboardCaptions({ sinceIso, limit: 20 }),
        ]);

        if (leaderboardRequestRef.current !== requestId) return;

        if (mostLiked.error || topWeek.error) {
            setLeaderboardError(mostLiked.error ?? topWeek.error ?? "Unable to load leaderboard.");
            setLeaderboardData(null);
            setLeaderboardLoading(false);
            return;
        }

        setLeaderboardData({
            mostLiked: mostLiked.items,
            topWeek: topWeek.items,
        });
        setLeaderboardLoading(false);
    }

    function handleOpenLeaderboard() {
        setLeaderboardOpen(true);
        if (!leaderboardData && !leaderboardLoading) {
            void loadLeaderboard();
        }
    }

    async function load({ force }: { force?: boolean } = {}) {
        const loadKey = `${userId ?? "anon"}:${force ? "force" : "initial"}`;
        if (
            inFlightLoadKeyRef.current === loadKey ||
            loadedForKeyRef.current === loadKey
        ) {
            if (isDev) {
                console.log("[vote] load:skip", {
                    loadKey,
                    reason:
                        inFlightLoadKeyRef.current === loadKey ? "in-flight" : "already-loaded",
                });
            }
            return;
        }
        inFlightLoadKeyRef.current = loadKey;
        if (isDev) console.log("[vote] load:start", { loadKey, force });
        setLoading(true);
        setError(null);
        // Reset the recent-image window whenever we (re)load the queue so the
        // diversity logic stays aligned with what the user sees in this session.
        recentImageIdsRef.current = [];

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const session = sessionData.session;

            if (!session) {
                setQueue([]);
                setTotalCount(0);
                setDoneCount(0);
                setVoteByCaptionId({});
                loadedForKeyRef.current = loadKey;
                setLoading(false);
                return;
            }

            if (!force) {
                const stored = readStoredQueue(session.user.id);
                if (stored) {
                    setQueue(filterBadImages(stored.queue));
                    didInitQueueRef.current = true;
                }
            }

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

            const {
                pool,
                eligible,
                error: poolError,
            } = await fetchCaptionPool({
                voteMap,
            });

            if (poolError) {
                setError(poolError.message);
                setQueue([]);
                setTotalCount(0);
                setDoneCount(0);
                setVoteByCaptionId({});
                setLoading(false);
                return;
            }

            const totalCountValue = pool.length;
            const doneCountValue = pool.reduce(
                (acc, caption) => acc + (voteMap[caption.id] != null ? 1 : 0),
                0,
            );
            const eligibleCaptions = filterBadImages(eligible);

            setQueue(eligibleCaptions);
            didInitQueueRef.current = true;
            setTotalCount(totalCountValue);
            setDoneCount(doneCountValue);
            setVoteByCaptionId(voteMap);
            persistQueue(session.user.id, eligibleCaptions);
            loadedForKeyRef.current = loadKey;
            setLoading(false);
        } finally {
            inFlightLoadKeyRef.current = null;
        }
    }

    useEffect(() => {
        let isMounted = true;

        supabase.auth.getSession().then(({ data }) => {
            if (!isMounted) return;
            const session = data.session;
            const nextUserId = session?.user?.id ?? null;
            const nextEmail = nextUserId ? session?.user?.email ?? "Logged in" : null;

            if (nextUserId !== lastSessionUserIdRef.current) {
                lastSessionUserIdRef.current = nextUserId;
                setUserId(nextUserId);
            }

            if (nextEmail !== lastSessionEmailRef.current) {
                lastSessionEmailRef.current = nextEmail;
                setUserEmail(nextEmail);
            }

            if (!authInitializedRef.current) {
                authInitializedRef.current = true;
                if (isDev) console.log("[vote] auth:ready", { userId: nextUserId });
                setAuthReady(true);
            }
        });

        const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!authInitializedRef.current) {
                if (isDev) console.log("[vote] auth:skip-initial");
                return;
            }

            const nextUserId = nextSession?.user?.id ?? null;
            const nextEmail = nextUserId ? nextSession?.user?.email ?? "Logged in" : null;

            if (
                nextUserId === lastSessionUserIdRef.current &&
                nextEmail === lastSessionEmailRef.current
            ) {
                if (isDev) console.log("[vote] auth:noop");
                return;
            }

            if (isDev) console.log("[vote] auth:update", { userId: nextUserId });
            lastSessionUserIdRef.current = nextUserId;
            lastSessionEmailRef.current = nextEmail;
            setUserId(nextUserId);
            setUserEmail(nextEmail);
        });

        return () => {
            isMounted = false;
            sub.subscription.unsubscribe();
        };
    }, [supabase, isDev]);

    useEffect(() => {
        if (!authReady) return;
        const loadKey = `${userId ?? "anon"}:initial`;
        if (
            inFlightLoadKeyRef.current === loadKey ||
            loadedForKeyRef.current === loadKey
        ) {
            if (isDev) console.log("[vote] load:skip-effect", { loadKey });
            return;
        }

        if (!didInitRef.current) {
            didInitRef.current = true;
        }

        if (isDev) console.log("[vote] load:trigger", { loadKey });
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authReady, userId, isDev]);

    function handleImageError(imageId: string | null) {
        if (!imageId) return;
        badImageIdsRef.current.add(imageId);
        setQueue((prev) => {
            const nextQueue = prev.filter((caption) => caption.image_id !== imageId);
            queueRef.current = nextQueue;
            if (userId) persistQueue(userId, nextQueue);
            return nextQueue;
        });
        setTotalCount((prev) => Math.max(prev - 1, 0));
    }

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

        // Record the current image before advancing so the next selection can
        // avoid repeating it (or other recently shown images) when possible.
        const current = queueRef.current[0];
        pushRecentImageId(recentImageIdsRef.current, current?.image_id ?? null);

        setIsAnimating(true);
        setAnimDir(dir);
        setAnimAngle(randomAngle(dir));
        setAnimState("out");

        await new Promise((resolve) => setTimeout(resolve, 280));
        const hasNext = queueRef.current.length > 1;
        setQueue((prev) => {
            const nextQueue = advanceQueueAvoidingRecentImages(
                prev,
                recentImageIdsRef.current,
            );
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

    const likeEmojis = ["❤️", "💕", "💖", "💗"];
    const dislikeEmojis = ["💔", "😵", "👎", "💥"];
    const DEFAULT_PARTICLE_COUNT = 8;

    function randomInRange(min: number, max: number) {
        return min + Math.random() * (max - min);
    }

    function getBurstOrigin(type: ReactionBurst["type"]) {
        const card = cardRef.current;
        const button =
            type === "like" ? likeButtonRef.current : dislikeButtonRef.current;

        if (card && button) {
            const cardRect = card.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            return {
                originX:
                    buttonRect.left + buttonRect.width / 2 - cardRect.left,
                originY:
                    buttonRect.top + buttonRect.height / 2 - cardRect.top,
            };
        }

        if (card) {
            const cardRect = card.getBoundingClientRect();
            return {
                originX: cardRect.width / 2,
                originY: Math.max(cardRect.height - 120, cardRect.height * 0.7),
            };
        }

        return { originX: 0, originY: 0 };
    }

    function createParticles(type: ReactionBurst["type"], burstId: string) {
        const emojiPool = type === "like" ? likeEmojis : dislikeEmojis;

        return Array.from({ length: DEFAULT_PARTICLE_COUNT }, (_, index) => {
            const sizePx = Math.round(randomInRange(18, 34));
            const driftX = Math.round(randomInRange(-40, 40));
            const xOffset = Math.round(randomInRange(-14, 14));
            const floatY = Math.round(-randomInRange(80, 140));
            const durationMs = Math.round(randomInRange(650, 1050));
            const delayMs = Math.round(randomInRange(0, 120));
            const rotateDeg = Math.round(randomInRange(-18, 18));
            const emoji =
                emojiPool[Math.floor(Math.random() * emojiPool.length)];

            return {
                id: `${burstId}-${index}`,
                emoji,
                xOffset,
                driftX,
                durationMs,
                delayMs,
                sizePx,
                rotateDeg,
                floatY,
            };
        });
    }

    function addReaction(type: ReactionBurst["type"]) {
        const id =
            typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const createdAt = Date.now();
        const { originX, originY } = getBurstOrigin(type);
        const particles = createParticles(type, id);

        setReactions((prev) => [
            ...prev,
            { id, type, createdAt, originX, originY, particles },
        ]);

        const maxLifetime =
            Math.max(...particles.map((particle) => particle.durationMs + particle.delayMs)) +
            100;

        const timeoutId = window.setTimeout(() => {
            setReactions((prev) => prev.filter((reaction) => reaction.id !== id));
            delete reactionTimeoutsRef.current[id];
        }, maxLifetime);

        reactionTimeoutsRef.current[id] = timeoutId;
    }

    function triggerShake() {
        if (shakeTimeoutRef.current) {
            window.clearTimeout(shakeTimeoutRef.current);
        }
        setIsShaking(false);
        requestAnimationFrame(() => {
            setIsShaking(true);
            shakeTimeoutRef.current = window.setTimeout(() => {
                setIsShaking(false);
            }, 680);
        });
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

        const hasExistingVote = voteByCaptionId[captionId] != null;
        const payload: {
            profile_id: string;
            caption_id: string;
            vote_value: 1 | -1;
            created_by_user_id: string;
            modified_by_user_id: string;
        } = {
            profile_id: userId,
            caption_id: captionId,
            vote_value: value,
            created_by_user_id: userId,
            modified_by_user_id: userId,
        };

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
        if (!currentCaption) return;
        if (
            !isCaptionVotable(currentCaption) ||
            (currentCaption.image_id &&
                badImageIdsRef.current.has(currentCaption.image_id))
        ) {
            return;
        }
        // Maintain a small rolling window of recently shown images so we can
        // select a different image for the next voting round when available.
        pushRecentImageId(recentImageIdsRef.current, currentCaption.image_id);
    }, [currentCaptionId, currentCaption, isDev]);

    useLayoutEffect(() => {
        if (!currentCaption) return;
        if (
            isCaptionVotable(currentCaption) &&
            (!currentCaption.image_id ||
                !badImageIdsRef.current.has(currentCaption.image_id))
        ) {
            return;
        }

        if (isDev) {
            console.log("[vote] queue:skip-invalid", {
                captionId: currentCaption.id,
                imageId: currentCaption.image_id,
            });
        }

        setQueue((prev) => {
            const nextQueue = advanceQueueAvoidingRecentImages(
                prev,
                recentImageIdsRef.current,
            );
            if (userId) persistQueue(userId, nextQueue);
            return nextQueue;
        });

    }, [
        currentCaption,
        queue.length,
        userId,
        isDev,
    ]);

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

                    <div style={styles.headerActions}>
                        <button
                            onClick={handleOpenLeaderboard}
                            style={styles.secondaryButton}
                        >
                            Leaderboard
                        </button>
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
                    </div>
                </header>

                {error && <p style={{ ...styles.errorText, marginTop: 8 }}>{error}</p>}

                {remaining === 0 ? (
                    <div style={styles.emptyCard}>All done. Thanks for voting!</div>
                ) : (
                    <div
                        key={currentCaption?.id}
                        ref={cardRef}
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
                        <div style={styles.reactionOverlay} aria-hidden="true">
                            {reactions.map((burst) => (
                                <div key={burst.id}>
                                    {burst.particles.map((particle) => (
                                        <span
                                            key={particle.id}
	                                            style={{
	                                                ...styles.reactionItem,
	                                                ...(burst.type === "like"
	                                                    ? styles.reactionLike
	                                                    : styles.reactionDislike),
	                                                left: `${burst.originX + particle.xOffset}px`,
	                                                top: `${burst.originY}px`,
	                                                fontSize: `${particle.sizePx}px`,
	                                                animation: `reactionBurst ${particle.durationMs}ms ease-out ${particle.delayMs}ms forwards`,
	                                                ["--drift-x"]: `${particle.driftX}px`,
	                                                ["--float-y"]: `${particle.floatY}px`,
	                                                ["--rotate"]: `${particle.rotateDeg}deg`,
	                                            } as CSSVariableProperties}
	                                        >
	                                            {particle.emoji}
	                                        </span>
	                                    ))}
	                                </div>
                            ))}
                        </div>
                        <div style={styles.imageWrap}>
                            {hasValidImage(currentCaption) && (
                                <img
                                    src={currentCaption.image_url ?? ""}
                                    alt={currentCaption?.content ?? ""}
                                    style={styles.image}
                                    onError={() =>
                                        handleImageError(currentCaption?.image_id ?? null)
                                    }
                                />
                            )}
                        </div>

                        <div
                            style={{
                                ...styles.cardBody,
                                ...(isShaking ? styles.cardBodyShaking : {}),
                            }}
                        >
                            <div style={styles.captionText}>
                                {currentCaption?.content ?? "(no caption)"}
                            </div>

                            <div style={styles.voteActions}>
                                <VoteButtons
                                    onVote={(value) => {
                                        if (!currentCaption?.id) return;
                                        if (value === 1) {
                                            addReaction("like");
                                        } else {
                                            addReaction("dislike");
                                            triggerShake();
                                        }
                                        void handleVote(currentCaption.id, value);
                                    }}
                                    disabled={!userId || !currentCaption?.id || isAnimating}
                                    submitting={
                                        currentCaption?.id
                                            ? !!votingByCaptionId[currentCaption.id]
                                            : false
                                    }
                                    selectedVote={selectedVote}
                                    dislikeButtonRef={dislikeButtonRef}
                                    likeButtonRef={likeButtonRef}
                                />
                            </div>

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

            {leaderboardOpen && (
                <div
                    style={styles.leaderboardOverlay}
                    onClick={() => setLeaderboardOpen(false)}
                >
                    <div
                        style={styles.leaderboardPanel}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div style={styles.leaderboardHeader}>
                            <div>
                                <div style={styles.leaderboardTitle}>Caption Leaderboard</div>
                                <div style={styles.leaderboardSubtitle}>
                                    Top captions based on likes
                                </div>
                            </div>
                            <button
                                type="button"
                                style={styles.leaderboardClose}
                                onClick={() => setLeaderboardOpen(false)}
                            >
                                Close
                            </button>
                        </div>

                        {leaderboardLoading && (
                            <div style={styles.leaderboardState}>Loading leaderboard…</div>
                        )}
                        {!leaderboardLoading && leaderboardError && (
                            <div style={{ ...styles.leaderboardState, color: "#b42318" }}>
                                {leaderboardError}
                            </div>
                        )}
                        {!leaderboardLoading &&
                            !leaderboardError &&
                            (!leaderboardData ||
                                (leaderboardData.mostLiked.length === 0 &&
                                    leaderboardData.topWeek.length === 0)) && (
                                <div style={styles.leaderboardState}>No results yet.</div>
                            )}

                        {!leaderboardLoading && !leaderboardError && leaderboardData && (
                            <div style={styles.leaderboardSections}>
                                {[
                                    {
                                        title: "❤️ Most liked",
                                        items: leaderboardData.mostLiked,
                                    },
                                    {
                                        title: "🔥 Top this week",
                                        items: leaderboardData.topWeek,
                                    },
                                ].map((section) => (
                                    <div key={section.title} style={styles.leaderboardSection}>
                                        <div style={styles.leaderboardSectionTitle}>
                                            {section.title}
                                        </div>
                                        {section.items.length === 0 ? (
                                            <div style={styles.leaderboardEmpty}>
                                                No results.
                                            </div>
                                        ) : (
                                            <div style={styles.leaderboardList}>
                                                {section.items.map((item, index) => (
                                                    <div key={item.id} style={styles.leaderboardRow}>
                                                        <div style={styles.leaderboardRank}>
                                                            {index + 1}
                                                        </div>
                                                        <div style={styles.leaderboardThumbWrap}>
                                                            {item.image_url && (
                                                                <img
                                                                    src={item.image_url}
                                                                    alt={item.content ?? "Caption"}
                                                                    style={styles.leaderboardThumb}
                                                                />
                                                            )}
                                                        </div>
                                                        <div style={styles.leaderboardContent}>
                                                            <div style={styles.leaderboardCaption}>
                                                                {item.content ?? "(no caption)"}
                                                            </div>
                                                            <div style={styles.leaderboardLikes}>
                                                                ❤️ {formatLikeCount(item.like_count)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style jsx>{`
                @keyframes reactionBurst {
                    0% {
                        opacity: 1;
                        transform: translate(-50%, 0) scale(1) rotate(var(--rotate));
                    }
                    70% {
                        opacity: 0.9;
                    }
                    100% {
                        opacity: 0;
                        transform: translate(
                                calc(-50% + var(--drift-x)),
                                var(--float-y)
                            )
                            scale(0.85)
                            rotate(var(--rotate));
                    }
                }

                @keyframes shake {
                    0%,
                    100% {
                        transform: translateX(0);
                    }
                    20% {
                        transform: translateX(-6px);
                    }
                    40% {
                        transform: translateX(6px);
                    }
                    60% {
                        transform: translateX(-4px);
                    }
                    80% {
                        transform: translateX(4px);
                    }
                }
            `}</style>
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
    headerActions: {
        display: "flex",
        alignItems: "center",
        gap: 12,
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
        position: "relative",
    },
    imageWrap: {
        height: "min(52vh, 520px)",
        overflow: "hidden",
        background: "rgba(0,0,0,0.04)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
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
    cardBodyShaking: {
        animation: "shake 650ms ease",
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
    voteActions: {
        position: "relative",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
    },
    reactionOverlay: {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 2,
    },
    reactionItem: {
        position: "absolute",
        left: "50%",
        top: "50%",
        fontSize: 24,
        lineHeight: 1,
        opacity: 1,
        filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.18))",
        willChange: "transform, opacity",
    },
    reactionLike: {
        color: "#d7263d",
        textShadow:
            "0 0 14px rgba(255, 60, 90, 0.65), 0 0 28px rgba(255, 60, 90, 0.45)",
    },
    reactionDislike: {
        color: "#3b3b3b",
        textShadow: "0 0 10px rgba(0,0,0,0.25)",
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

    leaderboardOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15, 15, 15, 0.45)",
        display: "flex",
        justifyContent: "flex-end",
        padding: 24,
        zIndex: 40,
    },
    leaderboardPanel: {
        width: "min(480px, 100%)",
        maxHeight: "100%",
        background: "rgba(255,255,255,0.95)",
        borderRadius: 20,
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.2)",
        padding: "20px 20px 24px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
    },
    leaderboardHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    leaderboardTitle: {
        fontSize: 20,
        fontWeight: 700,
        color: "#1f1f1f",
    },
    leaderboardSubtitle: {
        marginTop: 6,
        fontSize: 13,
        color: "#5d5d5d",
    },
    leaderboardClose: {
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: 10,
        background: "rgba(255,255,255,0.9)",
        padding: "8px 12px",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
        color: "#2b2b2b",
    },
    leaderboardState: {
        padding: "10px 12px",
        background: "rgba(0,0,0,0.04)",
        borderRadius: 10,
        fontSize: 13.5,
        color: "#4a4a4a",
    },
    leaderboardSections: {
        display: "flex",
        flexDirection: "column",
        gap: 18,
    },
    leaderboardSection: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
    },
    leaderboardSectionTitle: {
        fontSize: 15,
        fontWeight: 700,
        color: "#2d2d2d",
    },
    leaderboardList: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
    },
    leaderboardRow: {
        display: "grid",
        gridTemplateColumns: "24px 52px 1fr",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.06)",
        background: "rgba(255,255,255,0.85)",
    },
    leaderboardRank: {
        fontSize: 13,
        fontWeight: 700,
        color: "#6a6a6a",
        textAlign: "center",
    },
    leaderboardThumbWrap: {
        width: 52,
        height: 52,
        borderRadius: 12,
        overflow: "hidden",
        background: "rgba(0,0,0,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    leaderboardThumb: {
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
    },
    leaderboardContent: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
    },
    leaderboardCaption: {
        fontSize: 14,
        color: "#2a2a2a",
        lineHeight: 1.4,
    },
    leaderboardLikes: {
        fontSize: 12.5,
        color: "#6a1f33",
        fontWeight: 600,
    },
    leaderboardEmpty: {
        fontSize: 13,
        color: "#6a6a6a",
        paddingLeft: 4,
    },
};
