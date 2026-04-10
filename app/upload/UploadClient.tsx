"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";

type GenerateUrlResponse = {
    presignedUrl?: string;
    cdnUrl?: string;
};

type UploadImageResponse = {
    imageId?: string;
};

type CaptionRecord = {
    id: string;
    content: string;
    image_id: string;
    created_datetime_utc?: string | null;
};

type CaptionsResponse = {
    captions?: CaptionRecord[];
};

const supportedTypes = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
]);

export default function UploadClient() {
    const supabase = useMemo(() => createClient(), []);

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [localObjectUrl, setLocalObjectUrl] = useState<string | null>(null);
    const [uploadedCdnUrl, setUploadedCdnUrl] = useState<string | null>(null);
    const [progress, setProgress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
    const [captions, setCaptions] = useState<CaptionRecord[]>([]);
    const [captionStatus, setCaptionStatus] = useState<
        "idle" | "loading" | "done" | "error"
    >("idle");
    const [copyNotice, setCopyNotice] = useState<{
        text: string;
        visible: boolean;
    } | null>(null);
    const copyTimeoutRef = useRef<number | null>(null);
    const copyCleanupRef = useRef<number | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const captionTexts = useMemo(
        () => captions.map((caption) => caption.content),
        [captions],
    );

    useEffect(() => {
        return () => {
            if (localObjectUrl) {
                URL.revokeObjectURL(localObjectUrl);
            }
        };
    }, [localObjectUrl]);

    useEffect(() => {
        return () => {
            if (copyTimeoutRef.current !== null) {
                window.clearTimeout(copyTimeoutRef.current);
            }
            if (copyCleanupRef.current !== null) {
                window.clearTimeout(copyCleanupRef.current);
            }
        };
    }, []);

    async function ensureAuthenticated() {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw new Error(sessionError.message);
        if (!data.session?.access_token) {
            throw new Error("Please sign in to upload images.");
        }
    }

    async function handleUpload() {
        setError(null);
        setPresignedUrl(null);
        setUploadedCdnUrl(null);
        setCaptions([]);
        setCaptionStatus("idle");
        setLogs([]);

        if (!selectedFile) {
            setError("Please choose an image to upload.");
            return;
        }

        if (!supportedTypes.has(selectedFile.type)) {
            setError(
                "Unsupported file type. Please upload jpeg, jpg, png, webp, gif, or heic images.",
            );
            return;
        }

        setIsLoading(true);

        try {
            await ensureAuthenticated();
            const log = (message: string) =>
                setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} ${message}`]);
            const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

            setProgress("Step 1/4: Requesting upload URL…");
            const step1 = await fetch("/api/pipeline/generate-presigned-url", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ contentType: selectedFile.type }),
            });

            if (!step1.ok) {
                const text = await step1.text();
                throw new Error(
                    `Step 1 failed (${step1.status}): ${text || "No response text"}`,
                );
            }

            const step1Data = (await step1.json()) as GenerateUrlResponse;
            if (!step1Data.presignedUrl || !step1Data.cdnUrl) {
                throw new Error("Step 1 failed (missing upload URLs).");
            }
            setPresignedUrl(step1Data.presignedUrl);
            setUploadedCdnUrl(step1Data.cdnUrl);
            log("Presigned URL stored.");
            log(`cdnUrl stored: ${step1Data.cdnUrl}`);

            setProgress("Step 2/4: Uploading image…");
            const step2 = await fetch(step1Data.presignedUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": selectedFile.type,
                },
                body: selectedFile,
            });

            if (!step2.ok) {
                const text = await step2.text();
                throw new Error(
                    `Step 2 failed (${step2.status}): ${text || "No response text"}`,
                );
            }
            log(`PUT status: ${step2.status}`);
            setPreviewSrc(step1Data.cdnUrl);

            let verified = false;
            try {
                const verifyResponse = await fetch(step1Data.cdnUrl, { method: "HEAD" });
                if (verifyResponse.ok) {
                    log(`cdnUrl HEAD status: ${verifyResponse.status}`);
                    verified = true;
                } else {
                    log(`cdnUrl HEAD status: ${verifyResponse.status}`);
                }
            } catch (headError) {
                log(
                    `cdnUrl HEAD failed: ${
                        headError instanceof Error ? headError.message : "Unknown error"
                    }`,
                );
            }

            if (!verified) {
                const verifyGet = await fetch(step1Data.cdnUrl, { method: "GET" });
                if (!verifyGet.ok) {
                    log(`cdnUrl GET status: ${verifyGet.status}`);
                    throw new Error("cdnUrl not accessible; upload failed.");
                }
                log(`cdnUrl GET status: ${verifyGet.status}`);
            }

            setProgress("Step 3/4: Registering image…");
            const step3 = await fetch("/api/pipeline/upload-image-from-url", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ imageUrl: step1Data.cdnUrl, isCommonUse: false }),
            });

            if (!step3.ok) {
                const text = await step3.text();
                throw new Error(
                    `Step 3 failed (${step3.status}): ${text || "No response text"}`,
                );
            }

            const step3Data = (await step3.json()) as UploadImageResponse;
            if (!step3Data.imageId) {
                throw new Error("Step 3 failed (missing image id).");
            }
            log(`imageId: ${step3Data.imageId}`);

            setProgress("Step 4/4: Generating captions…");
            setCaptionStatus("loading");
            await sleep(2000);
            const retryDelays = [1000, 1500, 2500, 4000, 6000, 8000, 10000, 12000];
            let returnedCaptions: CaptionRecord[] = [];
            let attempt = 0;
            let lastRawResponse = "";
            let lastStatus: number | null = null;
            let receivedArrayResponse = false;
            const maxAttempts = retryDelays.length + 1;

            while (attempt < maxAttempts) {
                if (attempt > 0) await sleep(retryDelays[attempt - 1]);
                attempt += 1;

                const step4 = await fetch("/api/pipeline/generate-captions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ imageId: step3Data.imageId }),
                });

                const rawText = await step4.text();
                lastRawResponse = rawText;
                lastStatus = step4.status;
                log(`generate-captions status: ${step4.status}`);
                log(`generate-captions raw: ${rawText || "No response text"}`);

                let parsed: unknown = null;
                try {
                    parsed = rawText ? JSON.parse(rawText) : null;
                } catch (parseError) {
                    log(
                        `generate-captions parse error: ${
                            parseError instanceof Error ? parseError.message : "Unknown error"
                        }`,
                    );
                }

                const data = Array.isArray(parsed)
                    ? parsed
                    : parsed &&
                      typeof parsed === "object" &&
                      Array.isArray((parsed as CaptionsResponse).captions)
                    ? (parsed as CaptionsResponse).captions
                    : parsed &&
                      typeof parsed === "object" &&
                      Array.isArray((parsed as { data?: CaptionRecord[] }).data)
                    ? (parsed as { data?: CaptionRecord[] }).data ?? []
                    : [];

                receivedArrayResponse = receivedArrayResponse || Array.isArray(data);
                returnedCaptions = Array.isArray(data)
                    ? data.flatMap((item) => {
                          if (!item || typeof item !== "object") return [];
                          const record = item as Partial<CaptionRecord> & {
                              caption?: string;
                              text?: string;
                          };
                          const content =
                              typeof record.content === "string"
                                  ? record.content
                                  : typeof record.caption === "string"
                                  ? record.caption
                                  : typeof record.text === "string"
                                  ? record.text
                                  : "";
                          if (!content) return [];
                          return [
                              {
                                  id: typeof record.id === "string" ? record.id : "",
                                  content,
                                  image_id:
                                      typeof record.image_id === "string" ? record.image_id : "",
                                  created_datetime_utc:
                                      typeof record.created_datetime_utc === "string"
                                          ? record.created_datetime_utc
                                          : record.created_datetime_utc ?? null,
                              },
                          ];
                      })
                    : [];

                log(
                    `Caption attempt ${attempt}: status ${step4.status}, captions ${returnedCaptions.length}`,
                );

                if (returnedCaptions.length > 0) break;
            }

            if (returnedCaptions.length === 0) {
                setCaptions([]);
                setProgress(null);
                if (receivedArrayResponse) {
                    setCaptionStatus("done");
                } else {
                    setCaptionStatus("error");
                    setError(
                        `No captions returned after retries (status ${
                            lastStatus ?? "unknown"
                        }). Raw response: ${
                            lastRawResponse || "No response text"
                        }`,
                    );
                }
                return;
            }

            setCaptions(returnedCaptions);
            setCaptionStatus("done");
            setProgress("Done.");
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Something went wrong. Please try again.";
            setError(message);
            setProgress(null);
            setCaptionStatus("error");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div style={styles.page}>
            <div style={styles.shell}>
                <header style={styles.header}>
                    <div>
                        <h1 style={styles.title}>Upload an Image</h1>
                        <p style={styles.subtitle}>
                            Upload an image to generate captions.
                        </p>
                    </div>
                </header>

                <section style={styles.card}>
                    <div style={styles.helperText}>
                        Upload an image to generate captions you can copy and share.
                    </div>
                    <label style={styles.label}>
                        Select image
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                                setError(null);
                                setProgress(null);
                                setPresignedUrl(null);
                                setUploadedCdnUrl(null);
                                setCaptions([]);
                                setCaptionStatus("idle");
                                setLogs([]);
                                const selected = event.target.files?.[0];
                                if (!selected) return;
                                if (localObjectUrl) {
                                    URL.revokeObjectURL(localObjectUrl);
                                }
                                const objUrl = URL.createObjectURL(selected);
                                setSelectedFile(selected);
                                setLocalObjectUrl(objUrl);
                                setPreviewSrc(objUrl);
                            }}
                            style={styles.input}
                        />
                    </label>

                    <button
                        type="button"
                        onClick={handleUpload}
                        disabled={isLoading || !selectedFile}
                        style={{
                            ...styles.button,
                            ...(isLoading || !selectedFile ? styles.buttonDisabled : {}),
                        }}
                    >
                        {isLoading ? "Working…" : "Upload & Generate Captions"}
                    </button>

                    {progress && <div style={styles.progress}>{progress}</div>}
                    {error && <div style={styles.error}>{error}</div>}
                    <div style={styles.footerHint}>
                        Want to help rank captions?{" "}
                        <Link href="/" style={styles.inlineLink}>
                            Go to voting
                        </Link>
                        .
                    </div>
                </section>

                {(previewSrc || uploadedCdnUrl) && (
                    <section style={styles.resultCard}>
                        <div style={styles.selectedHeader}>Selected upload</div>
                        <div style={styles.imageWrap}>
                            {previewSrc && (
                                <img
                                    src={previewSrc ?? ""}
                                    alt="Selected upload"
                                    style={styles.image}
                                />
                            )}
                        </div>
                        {captionStatus !== "idle" && (
                            <div style={styles.captionBlock}>
                                <div style={styles.captionHeader}>
                                    <h2 style={styles.captionTitle}>Generated Captions</h2>
                                    <div style={styles.captionHeaderActions}>
                                        <span style={styles.captionChip}>
                                            {captionTexts.length}{" "}
                                            {captionTexts.length === 1
                                                ? "caption"
                                                : "captions"}
                                        </span>
                                        {copyNotice && (
                                            <span
                                                style={{
                                                    ...styles.copyNotice,
                                                    opacity: copyNotice.visible ? 1 : 0,
                                                }}
                                            >
                                                {copyNotice.text}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                const all = captionTexts.join("\n");
                                                if (!all) return;
                                                try {
                                                    await navigator.clipboard.writeText(all);
                                                    if (copyTimeoutRef.current !== null) {
                                                        window.clearTimeout(copyTimeoutRef.current);
                                                    }
                                                    if (copyCleanupRef.current !== null) {
                                                        window.clearTimeout(copyCleanupRef.current);
                                                    }
                                                    setCopyNotice({
                                                        text: "Copied all captions.",
                                                        visible: true,
                                                    });
                                                    copyTimeoutRef.current = window.setTimeout(() => {
                                                        setCopyNotice((current) =>
                                                            current
                                                                ? { ...current, visible: false }
                                                                : null,
                                                        );
                                                    }, 1000);
                                                    copyCleanupRef.current = window.setTimeout(() => {
                                                        setCopyNotice(null);
                                                    }, 1500);
                                                } catch (copyError) {
                                                    setError(
                                                        copyError instanceof Error
                                                            ? copyError.message
                                                            : "Copy failed.",
                                                    );
                                                }
                                            }}
                                            disabled={captionTexts.length === 0}
                                            style={{
                                                ...styles.copyButton,
                                                ...(captionTexts.length === 0
                                                    ? styles.copyButtonDisabled
                                                    : {}),
                                            }}
                                        >
                                            Copy all
                                        </button>
                                    </div>
                                </div>
                                {captionStatus === "loading" ? (
                                    <p style={styles.captionEmpty}>Generating captions…</p>
                                ) : captionTexts.length === 0 ? (
                                    <p style={styles.captionEmpty}>
                                        No captions returned.
                                    </p>
                                ) : (
                                    <ul style={styles.captionList}>
                                        {captionTexts.map((captionText, index) => (
                                            <li
                                                key={`${captionText}-${index}`}
                                                style={styles.captionCard}
                                            >
                                                <div style={styles.captionText}>
                                                    {captionText}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        try {
                                                            await navigator.clipboard.writeText(
                                                                captionText,
                                                            );
                                                            if (copyTimeoutRef.current !== null) {
                                                                window.clearTimeout(
                                                                    copyTimeoutRef.current,
                                                                );
                                                            }
                                                            if (copyCleanupRef.current !== null) {
                                                                window.clearTimeout(
                                                                    copyCleanupRef.current,
                                                                );
                                                            }
                                                            setCopyNotice({
                                                                text: "Copied caption.",
                                                                visible: true,
                                                            });
                                                            copyTimeoutRef.current =
                                                                window.setTimeout(() => {
                                                                    setCopyNotice((current) =>
                                                                        current
                                                                            ? {
                                                                                  ...current,
                                                                                  visible: false,
                                                                              }
                                                                            : null,
                                                                    );
                                                                }, 900);
                                                            copyCleanupRef.current =
                                                                window.setTimeout(() => {
                                                                    setCopyNotice(null);
                                                                }, 1300);
                                                        } catch (copyError) {
                                                            setError(
                                                                copyError instanceof Error
                                                                    ? copyError.message
                                                                    : "Copy failed.",
                                                            );
                                                        }
                                                    }}
                                                    style={styles.copyButton}
                                                >
                                                    Copy
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    page: {
        minHeight: "100vh",
        background:
            "radial-gradient(900px 600px at 10% 0%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 60%), linear-gradient(120deg, #f7f3eb 0%, #efe7d7 55%, #e2d6c7 100%)",
        padding: "24px 20px 48px",
    },
    shell: {
        maxWidth: 900,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
    },
    header: {
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
    },
    title: {
        margin: 0,
        fontSize: 32,
        fontWeight: 700,
        color: "#1f1f1f",
    },
    subtitle: {
        margin: "10px 0 0",
        fontSize: 15,
        color: "#5a5550",
    },
    helperText: {
        fontSize: 13,
        lineHeight: 1.45,
        color: "#6b6b6b",
    },
    card: {
        padding: 22,
        borderRadius: 18,
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.9)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxShadow: "0 18px 40px rgba(0,0,0,0.08)",
    },
    label: {
        fontSize: 14,
        fontWeight: 600,
        color: "#2f2b27",
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    input: {
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "#fff",
        fontSize: 14,
    },
    button: {
        padding: "12px 16px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "#2f2f2f",
        color: "#fff",
        fontSize: 15,
        fontWeight: 600,
        cursor: "pointer",
    },
    buttonDisabled: {
        opacity: 0.6,
        cursor: "not-allowed",
    },
    progress: {
        fontSize: 13,
        color: "#2f2b27",
        background: "rgba(0,0,0,0.04)",
        padding: "8px 10px",
        borderRadius: 10,
        width: "fit-content",
    },
    error: {
        fontSize: 13,
        color: "#b42318",
        background: "rgba(180, 35, 24, 0.08)",
        border: "1px solid rgba(180, 35, 24, 0.18)",
        padding: "10px 12px",
        borderRadius: 10,
    },
    footerHint: {
        fontSize: 13,
        color: "#6b6b6b",
        lineHeight: 1.35,
    },
    inlineLink: {
        color: "#2c2c2c",
        fontWeight: 650,
        textDecoration: "underline",
        textUnderlineOffset: 3,
    },
    resultCard: {
        borderRadius: 18,
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.92)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.08)",
    },
    selectedHeader: {
        padding: "14px 18px",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.3px",
        textTransform: "uppercase",
        color: "#6b5f55",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.96)",
    },
    imageWrap: {
        height: "min(52vh, 520px)",
        background: "rgba(0,0,0,0.04)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    image: {
        width: "100%",
        height: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
        objectFit: "contain",
        display: "block",
    },
    captionBlock: {
        padding: "18px 20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
    },
    captionTitle: {
        margin: 0,
        fontSize: 18,
        fontWeight: 700,
        color: "#2c2c2c",
    },
    captionHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
    },
    captionHeaderActions: {
        display: "flex",
        alignItems: "center",
        gap: 10,
    },
    copyNotice: {
        fontSize: 12,
        fontWeight: 600,
        color: "#0f5132",
        background: "rgba(15, 81, 50, 0.12)",
        border: "1px solid rgba(15, 81, 50, 0.2)",
        padding: "4px 10px",
        borderRadius: 999,
        transition: "opacity 240ms ease",
    },
    captionChip: {
        fontSize: 12,
        fontWeight: 600,
        color: "#3f3a35",
        background: "rgba(0,0,0,0.06)",
        border: "1px solid rgba(0,0,0,0.08)",
        padding: "4px 10px",
        borderRadius: 999,
    },
    captionEmpty: {
        margin: 0,
        fontSize: 14,
        color: "#6b5f55",
    },
    captionList: {
        margin: 0,
        padding: 0,
        listStyle: "none",
        display: "grid",
        gap: 8,
    },
    captionCard: {
        padding: "12px 14px",
        borderRadius: 14,
        background: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(0,0,0,0.08)",
        fontSize: 14,
        color: "#2f2b27",
        lineHeight: 1.5,
        display: "grid",
        gap: 6,
        boxShadow: "0 8px 18px rgba(0,0,0,0.05)",
    },
    captionText: {
        fontSize: 15,
        fontWeight: 600,
        color: "#2f2b27",
        textAlign: "center",
        wordBreak: "break-word",
    },
    copyButton: {
        width: "fit-content",
        padding: "6px 10px",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "rgba(0,0,0,0.04)",
        color: "#2f2b27",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
    },
    copyButtonDisabled: {
        opacity: 0.6,
        cursor: "not-allowed",
    },
};
